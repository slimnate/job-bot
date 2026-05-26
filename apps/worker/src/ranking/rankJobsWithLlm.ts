import type { Doc, Id } from '../convexBridge/doc.js';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import {
  buildCursorFileRankingPrompt,
  buildRankingPrompt,
  cursorBatchPaths,
  rankingJsonSchema,
  RANKING_SYSTEM_MESSAGE,
  validateIndividualScores,
  parseRankingResultsFromText,
  validateCursorRankingResults,
  validateRankingResults,
  type RankingCandidateInput,
  type RankingEvaluatorInput,
  type RankingResult,
} from '@job-bot/shared';

import { isRankDebug } from '../debugFlags.js';
import { getSettingNumber, getSettingString } from '../settings/settingsHelpers.js';
import { workerLog } from '../log.js';
import { withRetry } from '../retry.js';
import {
  isCursorCliOutputLogEnabled,
  isCursorInlinePromptForced,
  isCursorMinimalContextEnabled,
  loadCursorChunkSize,
  loadCursorExtraTimeoutMs,
  loadRankingBaseTimeoutMs,
  loadRankingPromptOptions,
  loadRankingTimeoutPerCandidateMs,
  shouldKeepCursorBatchFiles,
  type RankingProviderKind,
} from './rankingEnv.js';
import { readCursorRankingResultsFile, writeCursorRankingBatchFiles } from './cursorBatchFiles.js';
import {
  buildCursorCliArgs,
  parseCursorCliJsonEnvelope,
  runCursorCli,
  type CursorCliConfig,
  type CursorCliOutputLineHandler,
} from './cursorCli.js';
import { effectiveRankingModelOverride, resolveCursorApiModelId } from './cursorCliModel.js';
import { resolveCursorCliWorkspaceDir } from '../workerPaths.js';

const CURSOR_CLI_RECONNECT_PATTERN = /connection lost|retry attempt/i;

/**
 * Logs each `cursor-agent` stdout/stderr line when `LLM_RANKING_CURSOR_LOG_OUTPUT` is enabled.
 */
function createCursorCliOutputLogger(): CursorCliOutputLineHandler | undefined {
  if (!isCursorCliOutputLogEnabled()) {
    return undefined;
  }
  return (stream, line) => {
    if (stream === 'stderr' && CURSOR_CLI_RECONNECT_PATTERN.test(line)) {
      workerLog.debug('llm.rank.cursor_cli.reconnect', { line });
    }
    workerLog.debug('llm.rank.cursor_cli.output', { stream, line });
  };
}

function chunkCandidates<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0 || items.length <= chunkSize) {
    return items.length > 0 ? [items] : [];
  }
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
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
  const raw = getSettingString('LLM_RANKING_PROVIDER').trim().toLowerCase();
  if (raw === 'cursor' || raw === 'http') {
    return raw;
  }
  throw new Error(`Invalid LLM_RANKING_PROVIDER '${raw}'. Use 'cursor' or 'http'.`);
}

function loadLlmConfig(modelOverride?: string): LlmClientConfig {
  const temperature = getSettingNumber('LLM_RANKING_TEMPERATURE');
  const effectiveModel = effectiveRankingModelOverride(modelOverride);
  return {
    apiKey: requiredEnv('OPENAI_API_KEY'),
    baseUrl: getSettingString('LLM_API_BASE_URL'),
    model: effectiveModel ?? getSettingString('LLM_RANKING_MODEL'),
    temperature,
  };
}

function loadCursorCliConfig(modelOverride?: string): CursorCliConfig {
  const workspaceRaw = getSettingString('CURSOR_CLI_WORKSPACE').trim();
  return {
    command: getSettingString('CURSOR_CLI_COMMAND').trim(),
    args: parseArgs(
      process.env.CURSOR_CLI_ARGS ?? '--print --trust --output-format json'
    ),
    timeoutMs: loadRankingBaseTimeoutMs(),
    model: resolveCursorApiModelId(modelOverride),
    workspaceDir: resolveCursorCliWorkspaceDir(workspaceRaw),
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
  forceResultsFileReminder: boolean
): Promise<RankingResult[] | null> {
  const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  await writeCursorRankingBatchFiles(config.workspaceDir, batchId, evaluator, candidates);

  let prompt = buildCursorFileRankingPrompt(
    batchId,
    candidates.map((c) => c._id),
    { forceResultsFileReminder }
  );

  if (isCursorInlinePromptForced()) {
    const inlineBody = buildRankingPrompt(evaluator, candidates, {
      descriptionMaxChars: Number.MAX_SAFE_INTEGER,
      omitUrl: true,
    });
    prompt = `${prompt}\n\n---\nInline posting reference (also in postings.json):\n${inlineBody}`;
  }

  const args = buildCursorCliArgs(config, prompt, {
    minimalContext: isCursorMinimalContextEnabled(),
    /** Default Agent mode (omit `--mode`) so the CLI can write results.json; ask/plan are read-only. */
    useDefaultAgentMode: true,
  });

  const extraTimeout = loadCursorExtraTimeoutMs();
  const timeoutMs = rankingTimeoutMs(config.timeoutMs, candidates.length, extraTimeout);

  try {
    await mkdir(config.workspaceDir, { recursive: true });
    const { stdout, stderr } = await runCursorCli({
      config,
      args,
      prompt,
      timeoutMs,
      cwd: config.workspaceDir,
      allowEmptyStdout: true,
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

    const envelope = parseCursorCliJsonEnvelope(stdout);
    if (envelope && isRankDebug()) {
      workerLog.debug('llm.rank.cursor_cli.envelope', {
        type: envelope.type,
        subtype: envelope.subtype,
        is_error: envelope.is_error,
        duration_ms: envelope.duration_ms,
      });
    }

    let fromFile = await readCursorRankingResultsFile(config.workspaceDir, batchId);
    if (!fromFile && envelope?.result) {
      const extracted = parseRankingResultsFromText(envelope.result);
      fromFile = validateCursorRankingResults(extracted);
      if (fromFile) {
        workerLog.info('llm.rank.cursor_cli.stdout_fallback', {
          batchId,
          resultCount: fromFile.length,
        });
      }
    }
    if (!fromFile) {
      workerLog.warn('llm.rank.cursor_cli_failed', {
        message: 'Missing or invalid results.json after Cursor CLI run.',
        model: config.model,
        candidateCount: candidates.length,
        batchId,
        stderr: stderr.trim() || undefined,
        envelopeResultChars: envelope?.result?.length,
      });
      return null;
    }

    const normalized = validateIndividualScores(candidates, fromFile);
    if (!normalized) {
      workerLog.warn('llm.rank.cursor_cli_failed', {
        message: 'results.json did not match expected posting ids or schema.',
        model: config.model,
        candidateCount: candidates.length,
        batchId,
        resultsCount: fromFile.length,
      });
      return null;
    }

    return normalized;
  } catch (error: unknown) {
    if (error instanceof Error) {
      workerLog.error('llm.rank.cursor_cli_failed', {
        message: error.message,
        model: config.model,
        candidateCount: candidates.length,
      });
      throw error;
    }
    throw error;
  } finally {
    await cleanupCursorBatch(config.workspaceDir, batchId);
  }
}

/**
 * Scores all candidates via Cursor CLI, splitting into chunks when configured.
 */
async function scoreCursorWithChunks(params: {
  evaluator: RankingEvaluatorInput;
  candidates: RankingCandidateInput[];
  cursorConfig: CursorCliConfig;
  promptOptions: ReturnType<typeof loadRankingPromptOptions>;
}): Promise<RankingResult[] | null> {
  const { evaluator, candidates, cursorConfig } = params;
  const chunkSize = loadCursorChunkSize();
  const chunks = chunkCandidates(candidates, chunkSize);
  const merged: RankingResult[] = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i]!;
    workerLog.info('llm.rank.chunk.begin', {
      chunkIndex: i + 1,
      chunkTotal: chunks.length,
      candidateCount: chunk.length,
    });

    const part = await scoreWithRetries({
      provider: 'cursor',
      evaluator,
      candidates: chunk,
      httpConfig: null,
      cursorConfig,
      promptOptions: params.promptOptions,
    });

    if (!part) {
      workerLog.warn('llm.rank.chunk.end', {
        chunkIndex: i + 1,
        chunkTotal: chunks.length,
        ok: false,
      });
      return null;
    }

    merged.push(...part);
    workerLog.info('llm.rank.chunk.end', {
      chunkIndex: i + 1,
      chunkTotal: chunks.length,
      ok: true,
      rankingsCount: part.length,
    });
  }

  return validateIndividualScores(candidates, merged);
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

  const cursorChunkSize = provider === 'cursor' ? loadCursorChunkSize() : 0;
  const cursorChunkCount =
    provider === 'cursor' && candidates.length > 0
      ? chunkCandidates(candidates, cursorChunkSize).length
      : 0;

  workerLog.info('llm.rank.start', {
    provider,
    candidateCount: payload.candidates.length,
    requestCount: provider === 'http' ? candidates.length : cursorChunkCount,
    model: payload.model,
    cursorWorkspaceFiles: provider === 'cursor',
    cursorChunkSize: provider === 'cursor' ? cursorChunkSize : undefined,
  });

  const rankings =
    provider === 'cursor' && cursorConfig
      ? await scoreCursorWithChunks({
          evaluator,
          candidates,
          cursorConfig,
          promptOptions,
        })
      : await scoreWithRetries({
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
