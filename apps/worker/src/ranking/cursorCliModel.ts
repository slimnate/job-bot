import { loadCursorDefaultModel } from './rankingEnv.js';
import { resolveCursorApiModelIdWithDefault } from './cursorCli.js';

export { effectiveRankingModelOverride } from './cursorCli.js';

/**
 * Resolves the Cursor CLI model id (aliases invalid catalog seeds; default from settings).
 */
export function resolveCursorApiModelId(
  modelOverride?: string,
  options?: { defaultModel?: string }
): string {
  const defaultModel = options?.defaultModel ?? loadCursorDefaultModel();
  return resolveCursorApiModelIdWithDefault(modelOverride, defaultModel);
}
