import type { RankingPromptOptions } from '@job-bot/shared';
import { parseAppSettingValue } from '@job-bot/shared';

import { getSettingBool, getSettingNumber, getSettingString } from '../settings/settingsHelpers.js';

export type RankingProviderKind = 'cursor' | 'http';

/**
 * HTTP inline prompt options (description truncation for chat completions).
 */
export function loadRankingPromptOptions(): RankingPromptOptions {
  return {
    descriptionMaxChars: getSettingNumber('LLM_RANKING_DESCRIPTION_MAX_CHARS'),
    omitUrl: true,
  };
}

export function loadRankingBaseTimeoutMs(): number {
  return getSettingNumber('LLM_RANKING_TIMEOUT_MS');
}

export function loadRankingTimeoutPerCandidateMs(): number {
  return getSettingNumber('LLM_RANKING_TIMEOUT_PER_CANDIDATE_MS');
}

export function isCursorBatchFilesEnabled(): boolean {
  return getSettingBool('LLM_RANKING_CURSOR_USE_BATCH_FILES');
}

export function isCursorInlinePromptForced(): boolean {
  return getSettingBool('LLM_RANKING_CURSOR_INLINE_PROMPT');
}

export function shouldKeepCursorBatchFiles(): boolean {
  return getSettingBool('LLM_RANKING_CURSOR_KEEP_BATCH_FILES');
}

const LEGACY_CURSOR_EXTRA_TIMEOUT_KEY = 'LLM_RANKING_CURSOR_FILE_EXTRA_TIMEOUT_MS';

/**
 * Extra timeout (ms) for Cursor ranking when using workspace files (inputs + results.json).
 * Falls back to legacy `LLM_RANKING_CURSOR_FILE_EXTRA_TIMEOUT_MS` in env or stored settings.
 */
export function loadCursorExtraTimeoutMs(): number {
  const envNew = process.env.LLM_RANKING_CURSOR_EXTRA_TIMEOUT_MS?.trim();
  const envLegacy = process.env[LEGACY_CURSOR_EXTRA_TIMEOUT_KEY]?.trim();
  const envRaw = envNew || envLegacy;
  if (envRaw) {
    const parsed = parseAppSettingValue('LLM_RANKING_CURSOR_EXTRA_TIMEOUT_MS', envRaw);
    if (typeof parsed === 'number') {
      return parsed;
    }
  }

  return getSettingNumber('LLM_RANKING_CURSOR_EXTRA_TIMEOUT_MS');
}

/** Default chunk size for Cursor ranking (0 disables chunking). */
export function loadCursorChunkSize(): number {
  return getSettingNumber('LLM_RANKING_CURSOR_CHUNK_SIZE');
}

export function isCursorMinimalContextEnabled(): boolean {
  return getSettingBool('LLM_RANKING_CURSOR_MINIMAL_CONTEXT');
}

/**
 * When true (default), each line of `cursor-agent` stdout/stderr is logged as
 * `llm.rank.cursor_cli.output` at debug level during ranking.
 */
export function isCursorCliOutputLogEnabled(): boolean {
  return getSettingBool('LLM_RANKING_CURSOR_LOG_OUTPUT');
}

export const CURSOR_PROMPT_FILE_THRESHOLD_CHARS = 200_000;

/** Default `cursor-agent --model` from settings (must be a real CLI model id). */
export function loadCursorDefaultModel(): string {
  return getSettingString('LLM_RANKING_CURSOR_MODEL');
}
