import type { Doc, Id } from '../convexBridge/doc.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { workerLog } from '../log.js';
import { withRetry } from '../retry.js';

export type LlmRankingCandidate = Pick<
  Doc<'job_postings'>,
  '_id' | 'title' | 'company' | 'location' | 'salaryText' | 'descriptionSnippet' | 'postedAt' | 'url' | 'source'
>;

type RankingResult = {
  postingId: Id<'job_postings'>;
  rank: number;
  scoreOverall: number;
  reasoningSummary: string;
  criteriaMatch: Record<string, unknown>;
  redFlags: string[];
};

type LlmRequestPayload = {
  criteria: Doc<'job_criteria'> | null;
  candidates: LlmRankingCandidate[];
  model: string;
  /** When set, overrides `LLM_RANKING_PROVIDER` for this call only. */
  provider?: 'http' | 'cursor';
};

type LlmClientConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
};

type RankingProvider = 'cursor' | 'http';

type CursorCliConfig = {
  command: string;
  args: string[];
  timeoutMs: number;
  model: string;
};

const execFileAsync = promisify(execFile);

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

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var '${name}' for LLM ranking.`);
  }
  return value;
}

function parseArgs(input: string): string[] {
  const matches = input.match(/"[^"]*"|'[^']*'|\S+/g);
  if (!matches) {
    return [];
  }
  return matches.map((part) => {
    if (
      (part.startsWith('"') && part.endsWith('"')) ||
      (part.startsWith("'") && part.endsWith("'"))
    ) {
      return part.slice(1, -1);
    }
    return part;
  });
}

function resolveProvider(): RankingProvider {
  const raw = process.env.LLM_RANKING_PROVIDER?.trim().toLowerCase();
  if (raw === 'cursor' || raw === 'http') {
    return raw;
  }
  if (raw) {
    throw new Error(
      `Invalid LLM_RANKING_PROVIDER '${process.env.LLM_RANKING_PROVIDER}'. Use 'cursor' or 'http'.`
    );
  }
  if (process.env.OPENAI_API_KEY) {
    return 'http';
  }
  return 'cursor';
}

function loadLlmConfig(modelOverride?: string): LlmClientConfig {
  const temperatureRaw = Number(process.env.LLM_RANKING_TEMPERATURE ?? '0.1');
  const temperature = Number.isFinite(temperatureRaw) ? temperatureRaw : 0.1;
  return {
    apiKey: requiredEnv('OPENAI_API_KEY'),
    baseUrl: process.env.LLM_API_BASE_URL ?? 'https://api.openai.com/v1',
    model: modelOverride ?? process.env.LLM_RANKING_MODEL ?? 'gpt-4.1-mini',
    temperature,
  };
}

function loadCursorCliConfig(modelOverride?: string): CursorCliConfig {
  const timeoutRaw = Number(process.env.LLM_RANKING_TIMEOUT_MS ?? '60000');
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 60000;

  return {
    command: process.env.CURSOR_CLI_COMMAND?.trim() || 'cursor-agent',
    args: parseArgs(process.env.CURSOR_CLI_ARGS ?? '--print'),
    timeoutMs,
    model: modelOverride ?? process.env.LLM_RANKING_MODEL ?? 'cursor-default',
  };
}

function strTrim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildPrompt(payload: LlmRequestPayload): string {
  const c = payload.criteria;
  const profileName = strTrim(c?.name);
  const rankingPrompt = strTrim(c?.rankingPrompt);
  const resumeMarkdown = strTrim(c?.resumeMarkdown);

  const sections: string[] = [
    'Ranking criteria:',
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
  for (const [index, candidate] of payload.candidates.entries()) {
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
    postingId: postingId as Id<'job_postings'>,
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

async function callLlmForRankings(
  payload: LlmRequestPayload,
  config: LlmClientConfig
): Promise<RankingResult[] | null> {
  return withRetry(
    async () => {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          temperature: config.temperature,
          messages: [
            {
              role: 'system',
              content:
                'You are a strict ranking engine that only returns valid JSON matching the provided schema.',
            },
            {
              role: 'user',
              content: buildPrompt(payload),
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
        throw new Error(`LLM request failed (${response.status}): ${errorBody}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        return null;
      }

      try {
        const parsed = JSON.parse(content) as unknown;
        return validateRankingResults(parsed);
      } catch {
        return null;
      }
    },
    {
      maxAttempts: 3,
      baseDelayMs: 600,
      maxDelayMs: 10000,
      label: 'llm.http.chat_completions',
    }
  );
}

async function callCursorCliForRankings(
  payload: LlmRequestPayload,
  config: CursorCliConfig,
  forceJsonReminder: boolean
): Promise<RankingResult[] | null> {
  const prompt = forceJsonReminder
    ? `${buildPrompt(payload)}\nIMPORTANT: Output must be strict JSON only. No prose, no markdown, no code fences.`
    : buildPrompt(payload);

  const args =
    config.args.some((arg) => arg.includes('{prompt}'))
      ? config.args.map((arg) => arg.replaceAll('{prompt}', prompt))
      : [...config.args, prompt];

  try {
    const { stdout, stderr } = await execFileAsync(config.command, args, {
      timeout: config.timeoutMs,
      maxBuffer: 1024 * 1024 * 8,
      env: process.env,
    });

    const text = (stdout ?? '').trim();
    if (!text) {
      if ((stderr ?? '').trim()) {
        return null;
      }
      return null;
    }

    try {
      const parsed = JSON.parse(text) as unknown;
      return validateRankingResults(parsed);
    } catch {
      return null;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown Cursor CLI execution error';
    const hint =
      /enoent|spawn/i.test(message)
        ? ' Install the Cursor CLI, set CURSOR_CLI_COMMAND to the full path of the agent binary, or use LLM_RANKING_PROVIDER=http with OPENAI_API_KEY.'
        : '';
    throw new Error(`Cursor CLI ranking failed: ${message}.${hint}`);
  }
}

function ensureAllCandidatesRanked(
  candidates: LlmRankingCandidate[],
  rankings: RankingResult[]
): RankingResult[] | null {
  const candidateIds = new Set(candidates.map((candidate) => candidate._id));
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

export async function rankJobsWithLlm(payload: LlmRequestPayload): Promise<{
  model: string;
  rankings: RankingResult[];
}> {
  if (payload.candidates.length === 0) {
    return {
      model: payload.model,
      rankings: [],
    };
  }

  const provider = payload.provider ?? resolveProvider();
  const httpConfig = provider === 'http' ? loadLlmConfig(payload.model) : null;
  const cursorConfig = provider === 'cursor' ? loadCursorCliConfig(payload.model) : null;

  workerLog.info('llm.rank.start', {
    provider,
    candidateCount: payload.candidates.length,
    model: payload.model,
  });

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const parsed =
      provider === 'cursor' && cursorConfig
        ? await callCursorCliForRankings(payload, cursorConfig, attempt === 2)
        : await callLlmForRankings(payload, httpConfig as LlmClientConfig);
    if (!parsed) {
      workerLog.warn('llm.rank.attempt_invalid', {
        provider,
        attempt,
        reason: 'empty_or_unparseable',
      });
      if (attempt === 2) {
        break;
      }
      continue;
    }

    const normalized = ensureAllCandidatesRanked(payload.candidates, parsed);
    if (normalized) {
      workerLog.info('llm.rank.success', {
        provider,
        attempt,
        rankingsCount: normalized.length,
      });
      return {
        model: provider === 'cursor' ? cursorConfig!.model : (httpConfig as LlmClientConfig).model,
        rankings: normalized,
      };
    }

    workerLog.warn('llm.rank.attempt_invalid', {
      provider,
      attempt,
      reason: 'schema_or_candidate_mismatch',
    });
  }

  throw new Error('LLM ranking output failed schema validation after one retry.');
}

/**
 * Helper for one-off/manual flows where Cursor CLI is the expected provider.
 * Defaults to `cursor` when no provider override is passed.
 */
export async function rankJobsWithCursor(
  payload: Omit<LlmRequestPayload, 'provider'>,
  provider: RankingProvider = 'cursor'
): Promise<{
  model: string;
  rankings: RankingResult[];
}> {
  return rankJobsWithLlm({
    ...payload,
    provider,
  });
}
