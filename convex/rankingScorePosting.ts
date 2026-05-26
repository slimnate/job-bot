import { v } from 'convex/values';
import {
  buildRankingPrompt,
  parseAppSettingValue,
  rankingJsonSchema,
  RANKING_SYSTEM_MESSAGE,
  validateIndividualScores,
  validateRankingResults,
  type RankingCandidateInput,
  type RankingEvaluatorInput,
  type RankingPromptOptions,
  type RankingResult,
} from '@job-bot/shared';
import { action, internalQuery } from './_generated/server.js';
import { api, internal } from './_generated/api.js';
import type { Doc } from './_generated/dataModel.js';

/** Convex actions expose env at runtime; avoid `process` so the web app’s `tsc` can typecheck this file via `api` imports. */
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

/** `getEffective` applies env-over-Convex precedence; requires seeded settings. */
function resolveHttpRankingSettings(effective: Record<string, string>) {
  const descriptionMaxChars = parseAppSettingValue(
    'LLM_RANKING_DESCRIPTION_MAX_CHARS',
    requireEffectiveKey(effective, 'LLM_RANKING_DESCRIPTION_MAX_CHARS')
  ) as number;
  const baseUrl = requireEffectiveKey(effective, 'LLM_API_BASE_URL').replace(/\/$/, '');
  const temperature = parseAppSettingValue(
    'LLM_RANKING_TEMPERATURE',
    requireEffectiveKey(effective, 'LLM_RANKING_TEMPERATURE')
  ) as number;
  const defaultModel = requireEffectiveKey(effective, 'LLM_RANKING_MODEL');
  const promptOptions: RankingPromptOptions = {
    descriptionMaxChars,
    omitUrl: true,
  };
  return { baseUrl, temperature, defaultModel, promptOptions };
}

function toRankingEvaluator(evaluator: Doc<'job_evaluators'>): RankingEvaluatorInput {
  return {
    name: evaluator.name,
    rankingPrompt: evaluator.rankingPrompt,
    resumeMarkdown: evaluator.resumeMarkdown,
  };
}

function toRankingCandidates(postings: Doc<'job_postings'>[]): RankingCandidateInput[] {
  return postings.map((posting) => ({
    _id: posting._id as string,
    title: posting.title,
    company: posting.company,
    location: posting.location,
    salaryText: posting.salaryText,
    descriptionSnippet: posting.descriptionSnippet,
    postedAt: posting.postedAt != null ? String(posting.postedAt) : undefined,
    url: posting.url,
    source: posting.source,
  }));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

type HttpScorePostingParams = {
  apiKey: string;
  baseUrl: string;
  resolvedModel: string;
  temperature: number;
  evaluator: RankingEvaluatorInput;
  candidate: RankingCandidateInput;
  promptOptions: RankingPromptOptions;
};

/**
 * Scores one posting via OpenAI-compatible Chat Completions (with retries).
 */
async function scoreOnePostingHttp(params: HttpScorePostingParams): Promise<
  | { ok: true; rankings: RankingResult[] }
  | { ok: false; message: string }
> {
  const { apiKey, baseUrl, resolvedModel, temperature, evaluator, candidate, promptOptions } =
    params;

  const userContent = buildRankingPrompt(evaluator, [candidate], promptOptions);

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
          { role: 'system', content: RANKING_SYSTEM_MESSAGE },
          { role: 'user', content: userContent },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: rankingJsonSchema,
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return {
        ok: false,
        message: `LLM request failed (${response.status}): ${errorBody.slice(0, 500)}`,
      };
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      if (attempt < 2) {
        await sleep(600);
        continue;
      }
      return { ok: false, message: 'LLM returned an empty response.' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content) as unknown;
    } catch {
      if (attempt < 2) {
        await sleep(600);
        continue;
      }
      return { ok: false, message: 'LLM response was not valid JSON.' };
    }

    const rankings = validateRankingResults(parsed);
    if (!rankings) {
      if (attempt < 2) {
        await sleep(600);
        continue;
      }
      return { ok: false, message: 'LLM output did not match the expected scoring schema.' };
    }

    const checked = validateIndividualScores([candidate], rankings);
    if (!checked) {
      if (attempt < 2) {
        await sleep(600);
        continue;
      }
      return {
        ok: false,
        message:
          'LLM output did not include exactly one result for this posting, or postingId mismatched.',
      };
    }

    return { ok: true, rankings: checked };
  }

  return { ok: false, message: 'Scoring failed after retries.' };
}

export const loadScoreContext = internalQuery({
  args: {
    postingId: v.id('job_postings'),
    evaluatorId: v.id('job_evaluators'),
  },
  handler: async (ctx, args) => {
    const posting = await ctx.db.get(args.postingId);
    const evaluator = await ctx.db.get(args.evaluatorId);
    if (!posting || !evaluator) {
      return null;
    }
    return { posting, evaluator };
  },
});

export const loadBatchScoreContext = internalQuery({
  args: {
    postingIds: v.array(v.id('job_postings')),
    evaluatorId: v.id('job_evaluators'),
  },
  handler: async (ctx, args) => {
    const evaluator = await ctx.db.get(args.evaluatorId);
    if (!evaluator) {
      return null;
    }

    const dedupedPostingIds = Array.from(new Set(args.postingIds));
    const postings: Doc<'job_postings'>[] = [];
    for (const postingId of dedupedPostingIds) {
      const posting = await ctx.db.get(postingId);
      if (posting) {
        postings.push(posting);
      }
    }

    if (postings.length === 0) {
      return null;
    }

    return { postings, evaluator };
  },
});

export type ScoreOnePostingResult =
  | { kind: 'success'; scoreOverall: number; model: string }
  | { kind: 'error'; message: string };

export type ScorePostingsBatchResult =
  | { kind: 'success'; model: string; saved: number }
  | { kind: 'error'; message: string };

/**
 * Scores a single posting with the OpenAI-compatible Chat Completions API and saves a row in `job_rankings`.
 */
export const scoreOnePosting = action({
  args: {
    postingId: v.id('job_postings'),
    evaluatorId: v.id('job_evaluators'),
    apiModelId: v.string(),
  },
  handler: async (ctx, args): Promise<ScoreOnePostingResult> => {
    const context = await ctx.runQuery(internal.rankingScorePosting.loadScoreContext, {
      postingId: args.postingId,
      evaluatorId: args.evaluatorId,
    });

    if (!context) {
      return { kind: 'error', message: 'Posting or evaluator profile was not found.' };
    }

    const apiKey = readEnv('OPENAI_API_KEY')?.trim();
    if (!apiKey) {
      return {
        kind: 'error',
        message:
          'OPENAI_API_KEY is not set for Convex. Add it in the Convex dashboard (Settings → Environment Variables) to score from the web app.',
      };
    }

    await ctx.runMutation(api.appSettings.seedMissingSettings, {});
    const effective = await ctx.runQuery(internal.appSettings.getEffective, {});
    const httpSettings = resolveHttpRankingSettings(effective);
    const resolvedModel = (args.apiModelId.trim() || httpSettings.defaultModel).trim();
    const evaluator = toRankingEvaluator(context.evaluator);
    const candidate = toRankingCandidates([context.posting])[0]!;

    const scored = await scoreOnePostingHttp({
      apiKey,
      baseUrl: httpSettings.baseUrl,
      resolvedModel,
      temperature: httpSettings.temperature,
      evaluator,
      candidate,
      promptOptions: httpSettings.promptOptions,
    });

    if (!scored.ok) {
      return { kind: 'error', message: scored.message };
    }

    const row = scored.rankings[0]!;

    await ctx.runMutation(api.ranking.upsertResults, {
      evaluatorId: args.evaluatorId,
      model: resolvedModel,
      rankings: [
        {
          postingId: args.postingId,
          scoreOverall: row.scoreOverall,
          reasoningSummary: row.reasoningSummary,
          criteriaMatch: row.criteriaMatch,
          dimensionScores: row.dimensionScores,
          redFlags: row.redFlags,
        },
      ],
    });

    return { kind: 'success', scoreOverall: row.scoreOverall, model: resolvedModel };
  },
});

/**
 * Scores multiple postings with one HTTP request per posting; saves one ranking row each.
 */
export const scorePostingsBatch = action({
  args: {
    postingIds: v.array(v.id('job_postings')),
    evaluatorId: v.id('job_evaluators'),
    apiModelId: v.string(),
  },
  handler: async (ctx, args): Promise<ScorePostingsBatchResult> => {
    const postingIds = Array.from(new Set(args.postingIds));
    if (postingIds.length === 0) {
      return { kind: 'error', message: 'No postings were selected.' };
    }

    const context = await ctx.runQuery(internal.rankingScorePosting.loadBatchScoreContext, {
      postingIds,
      evaluatorId: args.evaluatorId,
    });
    if (!context) {
      return { kind: 'error', message: 'Evaluator profile or selected postings were not found.' };
    }

    const apiKey = readEnv('OPENAI_API_KEY')?.trim();
    if (!apiKey) {
      return {
        kind: 'error',
        message:
          'OPENAI_API_KEY is not set for Convex. Add it in the Convex dashboard (Settings → Environment Variables) to score from the web app.',
      };
    }

    await ctx.runMutation(api.appSettings.seedMissingSettings, {});
    const effective = await ctx.runQuery(internal.appSettings.getEffective, {});
    const httpSettings = resolveHttpRankingSettings(effective);
    const resolvedModel = (args.apiModelId.trim() || httpSettings.defaultModel).trim();

    const evaluator = toRankingEvaluator(context.evaluator);
    const candidates = toRankingCandidates(context.postings);

    const allRankings: RankingResult[] = [];

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index]!;
      const scored = await scoreOnePostingHttp({
        apiKey,
        baseUrl: httpSettings.baseUrl,
        resolvedModel,
        temperature: httpSettings.temperature,
        evaluator,
        candidate,
        promptOptions: httpSettings.promptOptions,
      });

      if (!scored.ok) {
        return {
          kind: 'error',
          message: `Batch scoring failed for posting ${index + 1}/${candidates.length} (${candidate._id}): ${scored.message}`,
        };
      }

      allRankings.push(...scored.rankings);
    }

    await ctx.runMutation(api.ranking.upsertResults, {
      evaluatorId: args.evaluatorId,
      model: resolvedModel,
      rankings: allRankings.map((row) => ({
        postingId: row.postingId as Doc<'job_postings'>['_id'],
        scoreOverall: row.scoreOverall,
        reasoningSummary: row.reasoningSummary,
        criteriaMatch: row.criteriaMatch,
        dimensionScores: row.dimensionScores,
        redFlags: row.redFlags,
      })),
    });

    return { kind: 'success', model: resolvedModel, saved: allRankings.length };
  },
});
