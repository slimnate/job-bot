import type { Doc, Id } from '../convexBridge/doc.js';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildCursorFileRankingPrompt,
  buildRankingPrompt,
  cursorBatchPaths,
  extractRankingJsonFromText,
  rankingJsonSchema,
  RANKING_SYSTEM_MESSAGE,
  validateIndividualScores,
  validateRankingResults,
  type RankingCandidateInput,
  type RankingEvaluatorInput,
  type RankingResult,
} from '@job-bot/shared';

import { isRankDebug } from '../debugFlags.js';
import { workerLog } from '../log.js';
import { withRetry } from '../retry.js';
import {
  CURSOR_PROMPT_FILE_THRESHOLD_CHARS,
  isCursorBatchFilesEnabled,
  isCursorCliOutputLogEnabled,
  isCursorInlinePromptForced,
  isCursorMinimalContextEnabled,
  loadCursorFileExtraTimeoutMs,
  loadRankingBaseTimeoutMs,
  loadRankingPromptOptions,
  loadRankingTimeoutPerCandidateMs,
  shouldKeepCursorBatchFiles,
  type RankingProviderKind,
} from './rankingEnv.js';
import { writeCursorRankingBatchFiles } from './cursorBatchFiles.js';
import {
  buildCursorCliArgs,
  formatCursorCliFailure,
  resolveCursorApiModelId,
  runCursorCli,
  type CursorCliConfig,
  type CursorCliOutputLineHandler,
} from './cursorCli.js';

/**
 * Logs each `cursor-agent` stdout/stderr line when `LLM_RANKING_CURSOR_LOG_OUTPUT` is enabled.
 */
function createCursorCliOutputLogger(): CursorCliOutputLineHandler | undefined {
  if (!isCursorCliOutputLogEnabled()) {
    return undefined;
  }
  return (stream, line) => {
    workerLog.debug('llm.rank.cursor_cli.output', { stream, line });
  };
}

export type LlmRankingCandidate = Pick<
  Doc<'job_postings'>,
  '_id' | 'title' | 'company' | 'location' | 'salaryText' | 'descriptionSnippet' | 'postedAt' | 'url' | 'source'
>;

type LlmRequestPayload = {
  evaluator: Doc<'job_evaluators'> | null;
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

function resolveProvider(): RankingProviderKind {
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

function defaultRankingCliWorkspace(): string {
  const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  return join(workerRoot, 'ranking-cli-workspace');
}

function loadCursorCliConfig(modelOverride?: string): CursorCliConfig {
  return {
    command: process.env.CURSOR_CLI_COMMAND?.trim() || 'cursor-agent',
    args: parseArgs(process.env.CURSOR_CLI_ARGS ?? '--print --mode=ask --trust --output-format text'),
    timeoutMs: loadRankingBaseTimeoutMs(),
    model: resolveCursorApiModelId(modelOverride),
    workspaceDir: process.env.CURSOR_CLI_WORKSPACE?.trim() || defaultRankingCliWorkspace(),
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function requiredString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function toRankingEvaluator(evaluator: Doc<'job_evaluators'> | null): RankingEvaluatorInput {
  if (!evaluator) {
    return null;
  }
  return {
    name: optionalString(evaluator.name),
    rankingPrompt: optionalString(evaluator.rankingPrompt),
    resumeMarkdown: optionalString(evaluator.resumeMarkdown),
  };
}

function toRankingCandidates(candidates: LlmRankingCandidate[]): RankingCandidateInput[] {
  return candidates.map((candidate) => ({
    _id: requiredString(candidate._id),
    title: requiredString(candidate.title),
    company: requiredString(candidate.company),
    location: optionalString(candidate.location),
    salaryText: optionalString(candidate.salaryText),
    descriptionSnippet: optionalString(candidate.descriptionSnippet),
    postedAt:
      candidate.postedAt != null && candidate.postedAt !== ''
        ? String(candidate.postedAt)
        : undefined,
    url: requiredString(candidate.url),
    source: requiredString(candidate.source),
  }));
}

function rankingTimeoutMs(baseMs: number, candidateCount: number, extraMs = 0): number {
  return baseMs + candidateCount * loadRankingTimeoutPerCandidateMs() + extraMs;
}

async function writePromptTempFile(prompt: string): Promise<string> {
  const dir = join(tmpdir(), 'job-bot-ranking');
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `prompt-${Date.now()}.txt`);
  await writeFile(filePath, prompt, 'utf8');
  return filePath;
}

async function callLlmForOnePosting(
  evaluator: RankingEvaluatorInput,
  candidate: RankingCandidateInput,
  config: LlmClientConfig,
  promptOptions: ReturnType<typeof loadRankingPromptOptions>
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
            { role: 'system', content: RANKING_SYSTEM_MESSAGE },
            {
              role: 'user',
              content: buildRankingPrompt(evaluator, [candidate], promptOptions),
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

      const parsed = JSON.parse(content) as unknown;
      return validateRankingResults(parsed);
    },
    {
      maxAttempts: 3,
      baseDelayMs: 600,
      maxDelayMs: 10000,
      label: 'llm.http.chat_completions',
      retryDebugSubsystem: 'rank',
    }
  );
}

async function cleanupCursorBatch(workspaceDir: string, batchId: string): Promise<void> {
  if (shouldKeepCursorBatchFiles()) {
    return;
  }
  const paths = cursorBatchPaths(batchId);
  await rm(join(workspaceDir, paths.batchDir), { recursive: true, force: true });
}

async function callCursorCliForRankings(
  evaluator: RankingEvaluatorInput,
  candidates: RankingCandidateInput[],
  config: CursorCliConfig,
  forceJsonReminder: boolean
): Promise<RankingResult[] | null> {
  const batchId = `batch-${Date.now()}`;
  const useBatchFiles = isCursorBatchFilesEnabled() && !isCursorInlinePromptForced();

  let prompt: string;
  if (useBatchFiles) {
    await writeCursorRankingBatchFiles(config.workspaceDir, batchId, evaluator, candidates);
    prompt = buildCursorFileRankingPrompt(
      batchId,
      candidates.map((c) => c._id)
    );
    if (forceJsonReminder) {
      prompt += '\nIMPORTANT: Output must be strict JSON only. No prose, no markdown, no code fences.';
    }
  } else {
    const body = buildRankingPrompt(evaluator, candidates, {
      descriptionMaxChars: Number.MAX_SAFE_INTEGER,
      omitUrl: true,
    });
    prompt = [
      'Score each posting independently. Return JSON only.',
      forceJsonReminder
        ? 'IMPORTANT: Output must be strict JSON only. No prose, no markdown, no code fences.'
        : '',
      body,
    ]
      .filter(Boolean)
      .join('\n');
  }

  let args: string[];
  if (
    !useBatchFiles &&
    prompt.length > CURSOR_PROMPT_FILE_THRESHOLD_CHARS &&
    config.args.some((a) => a.includes('{prompt}'))
  ) {
    const filePath = await writePromptTempFile(prompt);
    args = config.args.map((arg) => arg.replaceAll('{prompt}', filePath));
  } else {
    args = buildCursorCliArgs(config, prompt, {
      minimalContext: isCursorMinimalContextEnabled(),
    });
  }

  const extraTimeout = useBatchFiles ? loadCursorFileExtraTimeoutMs() : 0;
  const timeoutMs = rankingTimeoutMs(config.timeoutMs, candidates.length, extraTimeout);

  try {
    await mkdir(config.workspaceDir, { recursive: true });
    const { stdout, stderr } = await runCursorCli({
      config,
      args,
      prompt,
      timeoutMs,
      cwd: config.workspaceDir,
      onOutputLine: createCursorCliOutputLogger(),
      onSpawn: isCursorCliOutputLogEnabled()
        ? ({ commandLine, timeoutMs: cliTimeoutMs, cwd: cliCwd }) => {
            workerLog.debug('llm.rank.cursor_cli.spawn', {
              command: commandLine,
              timeoutMs: cliTimeoutMs,
              cwd: cliCwd,
            });
          }
        : undefined,
    });

    const text = stdout.trim();
    if (!text) {
      throw new Error(
        formatCursorCliFailure({
          reason: 'Cursor CLI produced empty stdout.',
          command: config.command,
          args,
          prompt,
          stderr,
          stdout,
        })
      );
    }

    const parsed = extractRankingJsonFromText(text);
    if (parsed == null) {
      throw new Error(
        formatCursorCliFailure({
          reason: 'Could not parse a JSON score array from Cursor CLI stdout.',
          command: config.command,
          args,
          prompt,
          stderr,
          stdout: text,
        })
      );
    }

    const validated = validateRankingResults(parsed);
    if (!validated) {
      throw new Error(
        formatCursorCliFailure({
          reason: 'Cursor CLI JSON did not match the expected scoring schema.',
          command: config.command,
          args,
          prompt,
          stderr,
          stdout: text,
        })
      );
    }

    return validated;
  } catch (error: unknown) {
    if (error instanceof Error) {
      workerLog.error('llm.rank.cursor_cli_failed', {
        message: error.message,
        model: config.model,
        candidateCount: candidates.length,
      });
    }
    throw error;
  } finally {
    if (useBatchFiles) {
      await cleanupCursorBatch(config.workspaceDir, batchId);
    }
  }
}

/**
 * Scores postings with retries; validates one result per candidate.
 */
async function scoreWithRetries(params: {
  provider: RankingProviderKind;
  evaluator: RankingEvaluatorInput;
  candidates: RankingCandidateInput[];
  httpConfig: LlmClientConfig | null;
  cursorConfig: CursorCliConfig | null;
  promptOptions: ReturnType<typeof loadRankingPromptOptions>;
}): Promise<RankingResult[] | null> {
  const { provider, evaluator, candidates, httpConfig, cursorConfig, promptOptions } = params;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (isRankDebug()) {
      workerLog.debug('llm.rank.attempt', {
        provider,
        attempt,
        candidateCount: candidates.length,
      });
    }

    let parsed: RankingResult[] | null = null;

    if (provider === 'cursor' && cursorConfig) {
      parsed = await callCursorCliForRankings(evaluator, candidates, cursorConfig, attempt === 2);
    } else if (provider === 'http' && httpConfig) {
      const flat: RankingResult[] = [];
      for (let i = 0; i < candidates.length; i += 1) {
        const candidate = candidates[i]!;
        const one = await callLlmForOnePosting(evaluator, candidate, httpConfig, promptOptions);
        if (!one) {
          workerLog.warn('llm.rank.posting_failed', {
            provider,
            postingId: candidate._id,
            index: i + 1,
            total: candidates.length,
          });
          parsed = null;
          break;
        }
        const validated = validateIndividualScores([candidate], one);
        if (!validated) {
          parsed = null;
          break;
        }
        flat.push(...validated);
        if (isRankDebug()) {
          workerLog.debug('llm.rank.posting_scored', {
            provider,
            postingId: candidate._id,
            index: i + 1,
            total: candidates.length,
            scoreOverall: validated[0]?.scoreOverall,
          });
        }
      }
      parsed = flat.length === candidates.length ? flat : null;
    }

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

    const normalized = validateIndividualScores(candidates, parsed);
    if (normalized) {
      return normalized;
    }

    workerLog.warn('llm.rank.attempt_invalid', {
      provider,
      attempt,
      reason: 'schema_or_candidate_mismatch',
    });
  }

  return null;
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
  const promptOptions = loadRankingPromptOptions();
  const evaluator = toRankingEvaluator(payload.evaluator);
  const candidates = toRankingCandidates(payload.candidates);

  workerLog.info('llm.rank.start', {
    provider,
    candidateCount: payload.candidates.length,
    requestCount: provider === 'http' ? candidates.length : 1,
    model: payload.model,
    cursorBatchFiles:
      provider === 'cursor' ? isCursorBatchFilesEnabled() && !isCursorInlinePromptForced() : false,
  });

  const rankings = await scoreWithRetries({
    provider,
    evaluator,
    candidates,
    httpConfig,
    cursorConfig,
    promptOptions,
  });

  if (!rankings) {
    throw new Error('LLM scoring output failed schema validation after one retry.');
  }

  workerLog.info('llm.rank.success', {
    provider,
    rankingsCount: rankings.length,
  });

  return {
    model: provider === 'cursor' ? cursorConfig!.model : (httpConfig as LlmClientConfig).model,
    rankings: rankings.map((row) => ({
      ...row,
      postingId: row.postingId as Id<'job_postings'>,
    })),
  };
}

/**
 * Helper for one-off/manual flows where Cursor CLI is the expected provider.
 */
export async function rankJobsWithCursor(
  payload: Omit<LlmRequestPayload, 'provider'>,
  provider: RankingProviderKind = 'cursor'
): Promise<{
  model: string;
  rankings: RankingResult[];
}> {
  return rankJobsWithLlm({
    ...payload,
    provider,
  });
}
