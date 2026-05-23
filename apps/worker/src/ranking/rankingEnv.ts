import type { RankingPromptOptions } from '@job-bot/shared';

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

export function loadCursorFileExtraTimeoutMs(): number {
  return getSettingNumber('LLM_RANKING_CURSOR_FILE_EXTRA_TIMEOUT_MS');
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
