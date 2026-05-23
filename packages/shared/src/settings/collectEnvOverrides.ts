import { APP_SETTING_KEYS } from './appSettingDefinitions.js';

/**
 * Collects non-empty allowlisted env values from a process env record.
 * Used by the worker when reporting overrides to Convex (no secrets).
 */
export function collectAllowlistedEnvOverrides(
  env: Record<string, string | undefined>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of APP_SETTING_KEYS) {
    const raw = env[key];
    if (raw !== undefined && raw.trim() !== '') {
      out[key] = raw.trim();
    }
  }
  return out;
}
