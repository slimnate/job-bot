import { v } from 'convex/values';
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

type LlmCandidate = Pick<
  Doc<'job_postings'>,
  '_id' | 'title' | 'company' | 'location' | 'salaryText' | 'descriptionSnippet' | 'postedAt' | 'url' | 'source'
>;

type RankingResult = {
  postingId: string;
  rank: number;
  scoreOverall: number;
  reasoningSummary: string;
  criteriaMatch: Record<string, unknown>;
  redFlags: string[];
};

const rankingJsonSchema = {
  name: 'job_ranking_results',
  schema: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['postingId', 'rank', 'scoreOverall', 'reasoningSummary', 'criteriaMatch', 'redFlags'],
      properties: {
        postingId: { type: 'string' },
        rank: { type: 'integer', minimum: 1 },
        scoreOverall: { type: 'number', minimum: 0, maximum: 100 },
        reasoningSummary: { type: 'string' },
        criteriaMatch: { type: 'object', additionalProperties: true },
        redFlags: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    },
  },
  strict: true,
} as const;

function strTrim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildRankingPrompt(evaluator: Doc<'job_evaluators'> | null, candidates: LlmCandidate[]): string {
  const c = evaluator;
  const profileName = strTrim(c?.name);
  const rankingPrompt = strTrim(c?.rankingPrompt);
  const resumeMarkdown = strTrim(c?.resumeMarkdown);

  const sections: string[] = [
    'Evaluator context:',
    profileName.length > 0 ? `- Profile name: ${profileName}` : '- Profile name: (not provided)',
    rankingPrompt.length > 0 ? `- User ranking instructions: ${rankingPrompt}` : '- User ranking instructions: (not provided)',
    resumeMarkdown.length > 0 ? `- Resume markdown:\n${resumeMarkdown}` : '- Resume markdown: (not provided)',
    '',
    'You rank job postings for this single user profile.',
    'Return JSON only. Do not include markdown.',
    'Output requirements:',
    '- Return one object per input posting, with no omissions and no extras.',
    '- Use the exact postingId values from input.',
    '- rank must be 1..N with no duplicates (1 is best fit).',
    '- scoreOverall is 0..100.',
    '- reasoningSummary is concise and specific.',
    '- criteriaMatch is an object describing matched and unmet criteria.',
    '- redFlags is an array of strings and can be empty.',
    '',
  ];

  sections.push('Postings to rank:');
  for (const [index, candidate] of candidates.entries()) {
    sections.push(
      `Posting ${index + 1}:`,
      JSON.stringify({
        postingId: candidate._id,
        title: candidate.title,
        company: candidate.company,
        location: candidate.location ?? null,
        salaryText: candidate.salaryText ?? null,
        postedAt: candidate.postedAt ?? null,
        source: candidate.source,
        url: candidate.url,
        descriptionSnippet: candidate.descriptionSnippet ?? null,
      }),
      ''
    );
  }
  sections.push('Rank each posting and return one JSON list containing all results.');

  return sections.join('\n');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function validateRankingResult(value: unknown): RankingResult | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const postingId = record.postingId;
  const rank = record.rank;
  const scoreOverall = record.scoreOverall;
  const reasoningSummary = record.reasoningSummary;
  const criteriaMatch = record.criteriaMatch;
  const redFlags = record.redFlags;

  if (typeof postingId !== 'string' || postingId.length === 0) {
    return null;
  }
  if (typeof rank !== 'number' || !Number.isInteger(rank) || rank < 1) {
    return null;
  }
  if (typeof scoreOverall !== 'number' || scoreOverall < 0 || scoreOverall > 100) {
    return null;
  }
  if (typeof reasoningSummary !== 'string' || reasoningSummary.trim().length === 0) {
    return null;
  }
  if (!criteriaMatch || typeof criteriaMatch !== 'object' || Array.isArray(criteriaMatch)) {
    return null;
  }
  if (!Array.isArray(redFlags) || redFlags.some((entry) => typeof entry !== 'string')) {
    return null;
  }

  return {
    postingId,
    rank,
    scoreOverall,
    reasoningSummary: reasoningSummary.trim(),
    criteriaMatch: criteriaMatch as Record<string, unknown>,
    redFlags,
  };
}

function validateRankingResults(value: unknown): RankingResult[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const parsed: RankingResult[] = [];
  for (const item of value) {
    const result = validateRankingResult(item);
    if (!result) {
      return null;
    }
    parsed.push(result);
  }

  return parsed;
}

function ensureAllCandidatesRanked(
  candidates: LlmCandidate[],
  rankings: RankingResult[]
): RankingResult[] | null {
  const candidateIds = new Set(candidates.map((candidate) => candidate._id as string));
  const seen = new Set<string>();
  for (const ranking of rankings) {
    if (!candidateIds.has(ranking.postingId)) {
      return null;
    }
    seen.add(ranking.postingId);
  }
  if (seen.size !== candidates.length) {
    return null;
  }

  return [...rankings]
    .sort((a, b) => a.rank - b.rank)
    .map((ranking, index) => ({
      ...ranking,
      rank: index + 1,
    }));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Loads posting and evaluator documents for the dashboard “score one posting” action.
 * Internal so resume and ranking prompt are not exposed through a public query.
 */
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

/**
 * Loads an evaluator profile and a deduped list of postings for batched scoring.
 * Returns null when evaluator is missing or no postings exist after filtering.
 */
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
 * Requires `OPENAI_API_KEY` (and optionally `LLM_API_BASE_URL`, `LLM_RANKING_TEMPERATURE`)
 * on the Convex deployment. For Cursor CLI, the web app calls the worker `POST /rank-posting` instead.
 */
export const scoreOnePosting = action({
  args: {
    postingId: v.id('job_postings'),
    evaluatorId: v.id('job_evaluators'),
    /** OpenAI (or compatible) model id, e.g. `gpt-4.1-mini`. */
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

    const baseUrl = (readEnv('LLM_API_BASE_URL') ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    const temperatureRaw = Number(readEnv('LLM_RANKING_TEMPERATURE') ?? '0.1');
    const temperature = Number.isFinite(temperatureRaw) ? temperatureRaw : 0.1;
    const resolvedModel = (args.apiModelId.trim() || readEnv('LLM_RANKING_MODEL') || 'gpt-4.1-mini').trim();

    const candidates: LlmCandidate[] = [
      {
        _id: context.posting._id,
        title: context.posting.title,
        company: context.posting.company,
        location: context.posting.location,
        salaryText: context.posting.salaryText,
        descriptionSnippet: context.posting.descriptionSnippet,
        postedAt: context.posting.postedAt,
        url: context.posting.url,
        source: context.posting.source,
      },
    ];

    const userContent = buildRankingPrompt(context.evaluator, candidates);

    let normalized: RankingResult[] | null = null;

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
            {
              role: 'system',
              content:
                'You are a strict ranking engine that only returns valid JSON matching the provided schema.',
            },
            {
              role: 'user',
              content: userContent,
            },
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
          kind: 'error',
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
        return { kind: 'error', message: 'LLM returned an empty response.' };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(content) as unknown;
      } catch {
        if (attempt < 2) {
          await sleep(600);
          continue;
        }
        return { kind: 'error', message: 'LLM response was not valid JSON.' };
      }

      const rankings = validateRankingResults(parsed);
      if (!rankings) {
        if (attempt < 2) {
          await sleep(600);
          continue;
        }
        return { kind: 'error', message: 'LLM output did not match the expected ranking schema.' };
      }

      const checked = ensureAllCandidatesRanked(candidates, rankings);
      if (!checked) {
        if (attempt < 2) {
          await sleep(600);
          continue;
        }
        return {
          kind: 'error',
          message: 'LLM output did not include exactly one result for this posting, or postingId mismatched.',
        };
      }

      normalized = checked;
      break;
    }

    if (!normalized || normalized.length !== 1) {
      return { kind: 'error', message: 'Ranking failed after retries.' };
    }

    const row = normalized[0]!;

    await ctx.runMutation(api.ranking.upsertResults, {
      evaluatorId: args.evaluatorId,
      model: resolvedModel,
      rankings: [
        {
          postingId: args.postingId,
          rank: row.rank,
          scoreOverall: row.scoreOverall,
          reasoningSummary: row.reasoningSummary,
          criteriaMatch: row.criteriaMatch,
          redFlags: row.redFlags,
        },
      ],
    });

    return { kind: 'success', scoreOverall: row.scoreOverall, model: resolvedModel };
  },
});

/**
 * Scores multiple postings in one LLM request and saves one ranking row per posting.
 * This minimizes token usage by sharing one prompt context (evaluator + resume) across all postings.
 */
export const scorePostingsBatch = action({
  args: {
    postingIds: v.array(v.id('job_postings')),
    evaluatorId: v.id('job_evaluators'),
    /** OpenAI (or compatible) model id, e.g. `gpt-4.1-mini`. */
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

    const baseUrl = (readEnv('LLM_API_BASE_URL') ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    const temperatureRaw = Number(readEnv('LLM_RANKING_TEMPERATURE') ?? '0.1');
    const temperature = Number.isFinite(temperatureRaw) ? temperatureRaw : 0.1;
    const resolvedModel = (args.apiModelId.trim() || readEnv('LLM_RANKING_MODEL') || 'gpt-4.1-mini').trim();

    const candidates: LlmCandidate[] = context.postings.map((posting) => ({
      _id: posting._id,
      title: posting.title,
      company: posting.company,
      location: posting.location,
      salaryText: posting.salaryText,
      descriptionSnippet: posting.descriptionSnippet,
      postedAt: posting.postedAt,
      url: posting.url,
      source: posting.source,
    }));

    const userContent = buildRankingPrompt(context.evaluator, candidates);
    let normalized: RankingResult[] | null = null;

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
            {
              role: 'system',
              content:
                'You are a strict ranking engine that only returns valid JSON matching the provided schema.',
            },
            {
              role: 'user',
              content: userContent,
            },
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
          kind: 'error',
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
        return { kind: 'error', message: 'LLM returned an empty response.' };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(content) as unknown;
      } catch {
        if (attempt < 2) {
          await sleep(600);
          continue;
        }
        return { kind: 'error', message: 'LLM response was not valid JSON.' };
      }

      const rankings = validateRankingResults(parsed);
      if (!rankings) {
        if (attempt < 2) {
          await sleep(600);
          continue;
        }
        return { kind: 'error', message: 'LLM output did not match the expected ranking schema.' };
      }

      const checked = ensureAllCandidatesRanked(candidates, rankings);
      if (!checked) {
        if (attempt < 2) {
          await sleep(600);
          continue;
        }
        return {
          kind: 'error',
          message:
            'LLM output did not include exactly one result for each selected posting, or postingId mismatched.',
        };
      }

      normalized = checked;
      break;
    }

    if (!normalized || normalized.length !== candidates.length) {
      return { kind: 'error', message: 'Batch ranking failed after retries.' };
    }

    await ctx.runMutation(api.ranking.upsertResults, {
      evaluatorId: args.evaluatorId,
      model: resolvedModel,
      rankings: normalized.map((row) => ({
        postingId: row.postingId as Doc<'job_postings'>['_id'],
        rank: row.rank,
        scoreOverall: row.scoreOverall,
        reasoningSummary: row.reasoningSummary,
        criteriaMatch: row.criteriaMatch,
        redFlags: row.redFlags,
      })),
    });

    return { kind: 'success', model: resolvedModel, saved: normalized.length };
  },
});
