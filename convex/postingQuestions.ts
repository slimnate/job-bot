import { v } from 'convex/values';
import {
  APP_SETTING_KEYS,
  buildPostingQaPrompt,
  parseAppSettingValue,
  POSTING_QA_SYSTEM_MESSAGE,
  resolveAllSettingsRaw,
  type PostingQaPriorTurn,
  type RankingCandidateInput,
  type RankingEvaluatorInput,
} from '@job-bot/shared';
import { action, internalQuery, mutation, query } from './_generated/server.js';
import { api, internal } from './_generated/api.js';
import type { Doc, Id } from './_generated/dataModel.js';
import type { QueryCtx } from './_generated/server.js';
import { getLatestRankingForPosting } from './postingsListHelpers.js';

const postingQuestionRowValidator = v.object({
  _id: v.id('posting_questions'),
  postingId: v.id('job_postings'),
  question: v.string(),
  answer: v.string(),
  providerKey: v.string(),
  model: v.string(),
  status: v.union(v.literal('completed'), v.literal('failed')),
  errorMessage: v.optional(v.string()),
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
 * Resolves evaluator for Q&A: source default → WORKER_DEFAULT_EVALUATOR_ID from settings.
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

async function loadPriorTurns(
  ctx: QueryCtx,
  postingId: Id<'job_postings'>
): Promise<PostingQaPriorTurn[]> {
  const rows = await ctx.db
    .query('posting_questions')
    .withIndex('by_posting_created_at', (q) => q.eq('postingId', postingId))
    .order('asc')
    .collect();

  return rows
    .filter((row) => row.status === 'completed')
    .map((row) => ({
      question: row.question,
      answer: row.answer,
    }));
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

export const listForPosting = query({
  args: {
    postingId: v.id('job_postings'),
  },
  returns: v.array(postingQuestionRowValidator),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('posting_questions')
      .withIndex('by_posting_created_at', (q) => q.eq('postingId', args.postingId))
      .order('asc')
      .collect();

    return rows.map((row) => ({
      _id: row._id,
      postingId: row.postingId,
      question: row.question,
      answer: row.answer,
      providerKey: row.providerKey,
      model: row.model,
      status: row.status,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt,
    }));
  },
});

/**
 * Returns question counts for a batch of posting ids (current list page).
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
        .query('posting_questions')
        .withIndex('by_posting_created_at', (q) => q.eq('postingId', postingId))
        .collect();
      counts[postingId as string] = rows.length;
    }
    return counts;
  },
});

export const saveAnswer = mutation({
  args: {
    postingId: v.id('job_postings'),
    question: v.string(),
    answer: v.string(),
    providerKey: v.string(),
    model: v.string(),
    status: v.union(v.literal('completed'), v.literal('failed')),
    errorMessage: v.optional(v.string()),
  },
  returns: v.id('posting_questions'),
  handler: async (ctx, args) => {
    const posting = await ctx.db.get(args.postingId);
    if (!posting) {
      throw new Error('Posting not found.');
    }

    const question = args.question.trim();
    if (!question) {
      throw new Error('Question cannot be empty.');
    }

    return await ctx.db.insert('posting_questions', {
      postingId: args.postingId,
      question,
      answer: args.answer,
      providerKey: args.providerKey.trim().toLowerCase(),
      model: args.model.trim(),
      status: args.status,
      errorMessage: args.errorMessage,
      createdAt: Date.now(),
    });
  },
});

const askContextValidator = v.object({
  posting: v.any(),
  evaluator: v.union(v.any(), v.null()),
  priorTurns: v.array(
    v.object({
      question: v.string(),
      answer: v.string(),
    })
  ),
  latestRankingSummary: v.union(v.string(), v.null()),
  descriptionMaxChars: v.number(),
  userPrompt: v.string(),
});

/**
 * Loads posting, evaluator, prior Q&A, and the built user prompt (worker + internal use).
 */
export const loadAskContext = internalQuery({
  args: {
    postingId: v.id('job_postings'),
    question: v.string(),
  },
  returns: v.union(askContextValidator, v.null()),
  handler: async (ctx, args) => {
    const posting = await ctx.db.get(args.postingId);
    if (!posting) {
      return null;
    }

    const effective = await getEffectiveSettings(ctx);
    const evaluator = await resolveEvaluatorForPosting(ctx, posting, effective);
    const priorTurns = await loadPriorTurns(ctx, args.postingId);
    const latestRanking = await getLatestRankingForPosting(ctx, args.postingId);

    const descriptionMaxChars = parseAppSettingValue(
      'LLM_RANKING_DESCRIPTION_MAX_CHARS',
      requireEffectiveKey(effective, 'LLM_RANKING_DESCRIPTION_MAX_CHARS')
    ) as number;

    const userPrompt = buildPostingQaPrompt({
      posting: toRankingCandidate(posting),
      evaluator: toRankingEvaluator(evaluator),
      latestRankingSummary: latestRanking?.reasoningSummary ?? null,
      priorTurns,
      question: args.question,
      descriptionMaxChars,
    });

    return {
      posting,
      evaluator,
      priorTurns,
      latestRankingSummary: latestRanking?.reasoningSummary ?? null,
      descriptionMaxChars,
      userPrompt,
    };
  },
});

/**
 * Public query for the worker to load the same Q&A prompt context as Convex HTTP.
 */
export const getAskContext = query({
  args: {
    postingId: v.id('job_postings'),
    question: v.string(),
  },
  returns: v.union(askContextValidator, v.null()),
  handler: async (ctx, args) => {
    const posting = await ctx.db.get(args.postingId);
    if (!posting) {
      return null;
    }

    const effective = await getEffectiveSettings(ctx);
    const evaluator = await resolveEvaluatorForPosting(ctx, posting, effective);
    const priorTurns = await loadPriorTurns(ctx, args.postingId);
    const latestRanking = await getLatestRankingForPosting(ctx, args.postingId);

    const descriptionMaxChars = parseAppSettingValue(
      'LLM_RANKING_DESCRIPTION_MAX_CHARS',
      requireEffectiveKey(effective, 'LLM_RANKING_DESCRIPTION_MAX_CHARS')
    ) as number;

    const userPrompt = buildPostingQaPrompt({
      posting: toRankingCandidate(posting),
      evaluator: toRankingEvaluator(evaluator),
      latestRankingSummary: latestRanking?.reasoningSummary ?? null,
      priorTurns,
      question: args.question,
      descriptionMaxChars,
    });

    return {
      posting,
      evaluator,
      priorTurns,
      latestRankingSummary: latestRanking?.reasoningSummary ?? null,
      descriptionMaxChars,
      userPrompt,
    };
  },
});

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export type AskHttpResult =
  | { kind: 'success'; answerId: Id<'posting_questions'> }
  | { kind: 'error'; message: string };

/**
 * Answers a question via OpenAI-compatible Chat Completions and persists the result.
 */
export const askHttp = action({
  args: {
    postingId: v.id('job_postings'),
    question: v.string(),
    providerKey: v.string(),
    apiModelId: v.string(),
  },
  handler: async (ctx, args): Promise<AskHttpResult> => {
    const question = args.question.trim();
    if (!question) {
      return { kind: 'error', message: 'Question cannot be empty.' };
    }

    const apiKey = readEnv('OPENAI_API_KEY')?.trim();
    if (!apiKey) {
      return {
        kind: 'error',
        message:
          'OPENAI_API_KEY is not set for Convex. Add it in the Convex dashboard to use the HTTP provider for Ask.',
      };
    }

    await ctx.runMutation(api.appSettings.seedMissingSettings, {});
    const effective = await ctx.runQuery(internal.appSettings.getEffective, {});

    try {
      await ctx.runQuery(internal.postingQuestions.validateCatalogForAsk, {
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

    const context = await ctx.runQuery(internal.postingQuestions.loadAskContext, {
      postingId: args.postingId,
      question,
    });
    if (!context) {
      return { kind: 'error', message: 'Posting not found.' };
    }

    const baseUrl = requireEffectiveKey(effective, 'LLM_API_BASE_URL').replace(/\/$/, '');
    const temperature = parseAppSettingValue(
      'LLM_RANKING_TEMPERATURE',
      requireEffectiveKey(effective, 'LLM_RANKING_TEMPERATURE')
    ) as number;
    const resolvedModel = args.apiModelId.trim();

    let answerText = '';
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
            { role: 'system', content: POSTING_QA_SYSTEM_MESSAGE },
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
        answerText = content;
        break;
      }
      if (attempt < 2) {
        await sleep(600);
      }
    }

    const providerKey = args.providerKey.trim().toLowerCase();

    if (!answerText) {
      await ctx.runMutation(api.postingQuestions.saveAnswer, {
        postingId: args.postingId,
        question,
        answer: '',
        providerKey,
        model: resolvedModel,
        status: 'failed',
        errorMessage: lastError,
      });
      return { kind: 'error', message: lastError };
    }

    const answerId = await ctx.runMutation(api.postingQuestions.saveAnswer, {
      postingId: args.postingId,
      question,
      answer: answerText,
      providerKey,
      model: resolvedModel,
      status: 'completed',
    });

    return { kind: 'success', answerId };
  },
});

export const validateCatalogForAsk = internalQuery({
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
