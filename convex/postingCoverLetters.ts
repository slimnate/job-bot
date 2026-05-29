import { v } from 'convex/values';
import {
  APP_SETTING_KEYS,
  buildCoverLetterOutlinePrompt,
  COVER_LETTER_OUTLINE_SYSTEM_MESSAGE,
  normalizeCoverLetterUserMessage,
  parseAppSettingValue,
  resolveAllSettingsRaw,
  type CoverLetterPriorTurn,
  type RankingCandidateInput,
  type RankingEvaluatorInput,
} from '@job-bot/shared';
import { action, internalQuery, mutation, query } from './_generated/server.js';
import { api, internal } from './_generated/api.js';
import type { Doc, Id } from './_generated/dataModel.js';
import type { QueryCtx } from './_generated/server.js';
import { getLatestRankingForPosting } from './postingsListHelpers.js';

const coverLetterTurnRowValidator = v.object({
  _id: v.id('posting_cover_letter_outlines'),
  postingId: v.id('job_postings'),
  userMessage: v.string(),
  outline: v.string(),
  providerKey: v.string(),
  model: v.string(),
  status: v.union(v.literal('completed'), v.literal('failed')),
  errorMessage: v.optional(v.string()),
  revisedFromId: v.union(v.id('posting_cover_letter_outlines'), v.null()),
  createdAt: v.number(),
});

/** Convex actions expose env at runtime; avoid `process` for web `tsc` via `api` imports. */
const GLOBAL_SCOPE = 'global' as const;

function readProcessEnv(key: string): string | undefined {
  const proc = (globalThis as Record<string, unknown>)['process'] as
    | { env?: Record<string, string | undefined> }
    | undefined;
  const raw = proc?.env?.[key];
  return typeof raw === 'string' ? raw : undefined;
}

async function getEffectiveSettings(ctx: QueryCtx): Promise<Record<string, string>> {
  const row = await ctx.db
    .query('app_settings')
    .withIndex('by_scope', (q) => q.eq('scope', GLOBAL_SCOPE))
    .unique();
  const stored = row?.values ?? {};
  const env: Record<string, string | undefined> = {};
  for (const key of APP_SETTING_KEYS) {
    env[key] = readProcessEnv(key);
  }
  return resolveAllSettingsRaw({ env, stored });
}

function readEnv(key: string): string | undefined {
  const proc = (globalThis as Record<string, unknown>)['process'] as
    | { env?: Record<string, string | undefined> }
    | undefined;
  const raw = proc?.env?.[key];
  return typeof raw === 'string' ? raw : undefined;
}

function requireEffectiveKey(effective: Record<string, string>, key: string): string {
  const raw = effective[key];
  if (raw === undefined || raw.trim() === '') {
    throw new Error(`Missing effective setting '${key}'; run seedMissingSettings first.`);
  }
  return raw.trim();
}

function toRankingCandidate(posting: Doc<'job_postings'>): RankingCandidateInput {
  return {
    _id: posting._id as string,
    title: posting.title,
    company: posting.company,
    location: posting.location,
    salaryText: posting.salaryText,
    descriptionSnippet: posting.descriptionSnippet,
    postedAt: posting.postedAt != null ? String(posting.postedAt) : undefined,
    url: posting.url,
    source: posting.source,
  };
}

function toRankingEvaluator(evaluator: Doc<'job_evaluators'> | null): RankingEvaluatorInput {
  if (!evaluator) {
    return null;
  }
  return {
    name: evaluator.name,
    rankingPrompt: evaluator.rankingPrompt,
    resumeMarkdown: evaluator.resumeMarkdown,
  };
}

/**
 * Resolves evaluator for cover letter prompts: source default → WORKER_DEFAULT_EVALUATOR_ID.
 */
async function resolveEvaluatorForPosting(
  ctx: QueryCtx,
  posting: Doc<'job_postings'>,
  effective: Record<string, string>
): Promise<Doc<'job_evaluators'> | null> {
  const sourceRow = await ctx.db
    .query('job_sources')
    .withIndex('by_source', (q) => q.eq('source', posting.source.trim().toLowerCase()))
    .unique();

  let evaluatorId: Id<'job_evaluators'> | undefined = sourceRow?.defaultEvaluatorId;
  if (!evaluatorId) {
    const fromSettings = effective.WORKER_DEFAULT_EVALUATOR_ID?.trim();
    if (fromSettings) {
      evaluatorId = fromSettings as Id<'job_evaluators'>;
    }
  }

  if (!evaluatorId) {
    return null;
  }

  const evaluator = await ctx.db.get(evaluatorId);
  return evaluator ?? null;
}

/**
 * Walks the revision chain from root to `revisedFromId` for prompt context.
 */
async function loadAncestryPriorTurns(
  ctx: QueryCtx,
  revisedFromId: Id<'posting_cover_letter_outlines'>
): Promise<CoverLetterPriorTurn[]> {
  const chain: CoverLetterPriorTurn[] = [];
  let currentId: Id<'posting_cover_letter_outlines'> | undefined = revisedFromId;
  const visited = new Set<string>();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const row: Doc<'posting_cover_letter_outlines'> | null = await ctx.db.get(currentId);
    if (!row || row.status !== 'completed') {
      break;
    }
    chain.unshift({
      userMessage: row.userMessage,
      outline: row.outline,
    });
    currentId = row.revisedFromId;
  }

  return chain;
}

/**
 * Validates provider + model against the ranking LLM catalog for the expected surface.
 */
async function assertCatalogModel(
  ctx: QueryCtx,
  providerKey: string,
  apiModelId: string,
  expectedSurface: 'convex_http' | 'worker_cursor'
): Promise<void> {
  const pk = providerKey.trim().toLowerCase();
  const modelId = apiModelId.trim();
  if (!pk || !modelId) {
    throw new Error('Provider and model are required.');
  }

  const provider = await ctx.db
    .query('ranking_llm_providers')
    .withIndex('by_key', (q) => q.eq('key', pk))
    .unique();
  if (!provider || provider.surface !== expectedSurface) {
    throw new Error(
      `Unknown or incompatible provider '${providerKey}' for this execution path (expected ${expectedSurface}).`
    );
  }

  const modelRow = await ctx.db
    .query('ranking_llm_models')
    .withIndex('by_provider_key', (q) => q.eq('providerKey', pk))
    .collect();

  if (!modelRow.some((m) => m.apiModelId === modelId)) {
    throw new Error(`Model '${apiModelId}' is not in the catalog for provider '${providerKey}'.`);
  }
}

function mapCoverLetterRow(row: Doc<'posting_cover_letter_outlines'>) {
  return {
    _id: row._id,
    postingId: row.postingId,
    userMessage: row.userMessage,
    outline: row.outline,
    providerKey: row.providerKey,
    model: row.model,
    status: row.status,
    errorMessage: row.errorMessage,
    revisedFromId: row.revisedFromId ?? null,
    createdAt: row.createdAt,
  };
}

export const listForPosting = query({
  args: {
    postingId: v.id('job_postings'),
  },
  returns: v.array(coverLetterTurnRowValidator),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('posting_cover_letter_outlines')
      .withIndex('by_posting_created_at', (q) => q.eq('postingId', args.postingId))
      .order('asc')
      .collect();

    return rows.map(mapCoverLetterRow);
  },
});

/**
 * Returns cover letter version counts for a batch of posting ids (current list page).
 */
export const countForPostings = query({
  args: {
    postingIds: v.array(v.id('job_postings')),
  },
  returns: v.record(v.string(), v.number()),
  handler: async (ctx, args) => {
    const counts: Record<string, number> = {};
    for (const postingId of args.postingIds) {
      const rows = await ctx.db
        .query('posting_cover_letter_outlines')
        .withIndex('by_posting_created_at', (q) => q.eq('postingId', postingId))
        .collect();
      counts[postingId as string] = rows.length;
    }
    return counts;
  },
});

/** Persists one cover letter outline version (HTTP action or worker). */
export const saveTurn = mutation({
  args: {
    postingId: v.id('job_postings'),
    userMessage: v.string(),
    outline: v.string(),
    providerKey: v.string(),
    model: v.string(),
    status: v.union(v.literal('completed'), v.literal('failed')),
    errorMessage: v.optional(v.string()),
    revisedFromId: v.optional(v.id('posting_cover_letter_outlines')),
  },
  returns: v.id('posting_cover_letter_outlines'),
  handler: async (ctx, args) => {
    const posting = await ctx.db.get(args.postingId);
    if (!posting) {
      throw new Error('Posting not found.');
    }

    const isRevision = args.revisedFromId != null;
    const userMessage = isRevision
      ? args.userMessage.trim()
      : normalizeCoverLetterUserMessage(args.userMessage);

    if (isRevision && !userMessage) {
      throw new Error('Revision instructions cannot be empty.');
    }

    if (args.revisedFromId) {
      const parent = await ctx.db.get(args.revisedFromId);
      if (!parent || parent.postingId !== args.postingId) {
        throw new Error('Parent outline not found for this posting.');
      }
    }

    return await ctx.db.insert('posting_cover_letter_outlines', {
      postingId: args.postingId,
      userMessage,
      outline: args.outline,
      providerKey: args.providerKey.trim().toLowerCase(),
      model: args.model.trim(),
      status: args.status,
      errorMessage: args.errorMessage,
      revisedFromId: args.revisedFromId,
      createdAt: Date.now(),
    });
  },
});

const coverLetterContextValidator = v.object({
  posting: v.any(),
  evaluator: v.union(v.any(), v.null()),
  priorTurns: v.array(
    v.object({
      userMessage: v.string(),
      outline: v.string(),
    })
  ),
  latestRankingSummary: v.union(v.string(), v.null()),
  descriptionMaxChars: v.number(),
  userPrompt: v.string(),
  normalizedUserMessage: v.string(),
  revisedFromId: v.union(v.id('posting_cover_letter_outlines'), v.null()),
});

type BuildCoverLetterContextArgs = {
  postingId: Id<'job_postings'>;
  userMessage: string;
  revisedFromId?: Id<'posting_cover_letter_outlines'>;
};

async function buildCoverLetterContext(ctx: QueryCtx, args: BuildCoverLetterContextArgs) {
  const posting = await ctx.db.get(args.postingId);
  if (!posting) {
    return null;
  }

  const isRevision = args.revisedFromId != null;
  const normalizedUserMessage = isRevision
    ? args.userMessage.trim()
    : normalizeCoverLetterUserMessage(args.userMessage);

  if (isRevision && !normalizedUserMessage) {
    throw new Error('Revision instructions cannot be empty.');
  }

  if (args.revisedFromId) {
    const parent = await ctx.db.get(args.revisedFromId);
    if (!parent || parent.postingId !== args.postingId) {
      throw new Error('Parent outline not found for this posting.');
    }
    if (parent.status !== 'completed') {
      throw new Error('Only completed outlines can be revised.');
    }
  }

  const effective = await getEffectiveSettings(ctx);
  const evaluator = await resolveEvaluatorForPosting(ctx, posting, effective);
  const priorTurns = args.revisedFromId
    ? await loadAncestryPriorTurns(ctx, args.revisedFromId)
    : [];
  const latestRanking = await getLatestRankingForPosting(ctx, args.postingId);

  const descriptionMaxChars = parseAppSettingValue(
    'LLM_RANKING_DESCRIPTION_MAX_CHARS',
    requireEffectiveKey(effective, 'LLM_RANKING_DESCRIPTION_MAX_CHARS')
  ) as number;

  const userPrompt = buildCoverLetterOutlinePrompt({
    posting: toRankingCandidate(posting),
    evaluator: toRankingEvaluator(evaluator),
    latestRankingSummary: latestRanking?.reasoningSummary ?? null,
    priorTurns,
    userMessage: normalizedUserMessage,
    descriptionMaxChars,
  });

  return {
    posting,
    evaluator,
    priorTurns,
    latestRankingSummary: latestRanking?.reasoningSummary ?? null,
    descriptionMaxChars,
    userPrompt,
    normalizedUserMessage,
    revisedFromId: args.revisedFromId ?? null,
  };
}

/**
 * Loads posting, evaluator, revision ancestry, and the built user prompt (worker + internal use).
 */
export const loadCoverLetterContext = internalQuery({
  args: {
    postingId: v.id('job_postings'),
    userMessage: v.string(),
    revisedFromId: v.optional(v.id('posting_cover_letter_outlines')),
  },
  returns: v.union(coverLetterContextValidator, v.null()),
  handler: async (ctx, args) => {
    try {
      return await buildCoverLetterContext(ctx, args);
    } catch {
      return null;
    }
  },
});

/**
 * Public query for the worker to load the same cover letter prompt context as Convex HTTP.
 */
export const getCoverLetterContext = query({
  args: {
    postingId: v.id('job_postings'),
    userMessage: v.string(),
    revisedFromId: v.optional(v.id('posting_cover_letter_outlines')),
  },
  returns: v.union(coverLetterContextValidator, v.null()),
  handler: async (ctx, args) => {
    try {
      return await buildCoverLetterContext(ctx, args);
    } catch {
      return null;
    }
  },
});

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export type GenerateHttpResult =
  | { kind: 'success'; turnId: Id<'posting_cover_letter_outlines'> }
  | { kind: 'error'; message: string };

/**
 * Generates or revises a cover letter outline via OpenAI-compatible Chat Completions.
 */
export const generateHttp = action({
  args: {
    postingId: v.id('job_postings'),
    userMessage: v.string(),
    providerKey: v.string(),
    apiModelId: v.string(),
    revisedFromId: v.optional(v.id('posting_cover_letter_outlines')),
  },
  handler: async (ctx, args): Promise<GenerateHttpResult> => {
    const apiKey = readEnv('OPENAI_API_KEY')?.trim();
    if (!apiKey) {
      return {
        kind: 'error',
        message:
          'OPENAI_API_KEY is not set for Convex. Add it in the Convex dashboard to use the HTTP provider for cover letter outlines.',
      };
    }

    await ctx.runMutation(api.appSettings.seedMissingSettings, {});
    const effective = await ctx.runQuery(internal.appSettings.getEffective, {});

    try {
      await ctx.runQuery(internal.postingCoverLetters.validateCatalogForCoverLetter, {
        providerKey: args.providerKey,
        apiModelId: args.apiModelId,
        expectedSurface: 'convex_http',
      });
    } catch (err) {
      return {
        kind: 'error',
        message: err instanceof Error ? err.message : 'Invalid provider or model.',
      };
    }

    let context;
    try {
      context = await ctx.runQuery(internal.postingCoverLetters.loadCoverLetterContext, {
        postingId: args.postingId,
        userMessage: args.userMessage,
        revisedFromId: args.revisedFromId,
      });
    } catch (err) {
      return {
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to load cover letter context.',
      };
    }

    if (!context) {
      return { kind: 'error', message: 'Posting or parent outline not found.' };
    }

    const baseUrl = requireEffectiveKey(effective, 'LLM_API_BASE_URL').replace(/\/$/, '');
    const temperature = parseAppSettingValue(
      'LLM_RANKING_TEMPERATURE',
      requireEffectiveKey(effective, 'LLM_RANKING_TEMPERATURE')
    ) as number;
    const resolvedModel = args.apiModelId.trim();

    let outlineText = '';
    let lastError = 'LLM returned an empty response.';

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: resolvedModel,
          temperature,
          messages: [
            { role: 'system', content: COVER_LETTER_OUTLINE_SYSTEM_MESSAGE },
            { role: 'user', content: context.userPrompt },
          ],
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        lastError = `LLM request failed (${response.status}): ${errorBody.slice(0, 500)}`;
        break;
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };
      const content = data.choices?.[0]?.message?.content?.trim();
      if (content) {
        outlineText = content;
        break;
      }
      if (attempt < 2) {
        await sleep(600);
      }
    }

    const providerKey = args.providerKey.trim().toLowerCase();
    const saveArgs = {
      postingId: args.postingId,
      userMessage: context.normalizedUserMessage,
      providerKey,
      model: resolvedModel,
      revisedFromId: args.revisedFromId,
    };

    if (!outlineText) {
      await ctx.runMutation(api.postingCoverLetters.saveTurn, {
        ...saveArgs,
        outline: '',
        status: 'failed' as const,
        errorMessage: lastError,
      });
      return { kind: 'error', message: lastError };
    }

    const turnId = await ctx.runMutation(api.postingCoverLetters.saveTurn, {
      ...saveArgs,
      outline: outlineText,
      status: 'completed' as const,
    });

    return { kind: 'success', turnId };
  },
});

export const validateCatalogForCoverLetter = internalQuery({
  args: {
    providerKey: v.string(),
    apiModelId: v.string(),
    expectedSurface: v.union(v.literal('convex_http'), v.literal('worker_cursor')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertCatalogModel(ctx, args.providerKey, args.apiModelId, args.expectedSurface);
    return null;
  },
});
