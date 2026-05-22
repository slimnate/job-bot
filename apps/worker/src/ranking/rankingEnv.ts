import type { RankingPromptOptions } from '@job-bot/shared';

export type RankingProviderKind = 'cursor' | 'http';

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseEnvBool(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined || raw.trim() === '') {
    return defaultValue;
  }
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes') {
    return true;
  }
  if (v === '0' || v === 'false' || v === 'no') {
    return false;
  }
  return defaultValue;
}

/**
 * HTTP inline prompt options (description truncation for chat completions).
 */
export function loadRankingPromptOptions(): RankingPromptOptions {
  return {
    descriptionMaxChars: parsePositiveInt(process.env.LLM_RANKING_DESCRIPTION_MAX_CHARS, 4096),
    omitUrl: true,
  };
}

export function loadRankingBaseTimeoutMs(): number {
  return parsePositiveInt(process.env.LLM_RANKING_TIMEOUT_MS, 60_000);
}

export function loadRankingTimeoutPerCandidateMs(): number {
  return parsePositiveInt(process.env.LLM_RANKING_TIMEOUT_PER_CANDIDATE_MS, 5_000);
}

export function isCursorBatchFilesEnabled(): boolean {
  return parseEnvBool(process.env.LLM_RANKING_CURSOR_USE_BATCH_FILES, true);
}

export function isCursorInlinePromptForced(): boolean {
  return parseEnvBool(process.env.LLM_RANKING_CURSOR_INLINE_PROMPT, false);
}

export function shouldKeepCursorBatchFiles(): boolean {
  return parseEnvBool(process.env.LLM_RANKING_CURSOR_KEEP_BATCH_FILES, false);
}

export function loadCursorFileExtraTimeoutMs(): number {
  return parsePositiveInt(process.env.LLM_RANKING_CURSOR_FILE_EXTRA_TIMEOUT_MS, 90_000);
}

export function isCursorMinimalContextEnabled(): boolean {
  return parseEnvBool(process.env.LLM_RANKING_CURSOR_MINIMAL_CONTEXT, true);
}

/**
 * When true (default), each line of `cursor-agent` stdout/stderr is logged as
 * `llm.rank.cursor_cli.output` at debug level during ranking.
 */
export function isCursorCliOutputLogEnabled(): boolean {
  return parseEnvBool(process.env.LLM_RANKING_CURSOR_LOG_OUTPUT, true);
}

export const CURSOR_PROMPT_FILE_THRESHOLD_CHARS = 200_000;

/** Default `cursor-agent --model` when none is selected (must be a real CLI model id). */
export function loadCursorDefaultModel(): string {
  const raw = process.env.LLM_RANKING_CURSOR_MODEL?.trim();
  return raw && raw.length > 0 ? raw : 'auto';
}
