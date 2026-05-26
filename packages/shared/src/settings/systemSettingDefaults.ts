/**
 * Developer-managed factory defaults for UI-exposed app settings.
 * Edit values here only; they are seeded into Convex per missing key (not used at runtime
 * except for seeding and UI reference labels).
 */
export const SYSTEM_SETTING_DEFAULTS = {
  WORKER_CRON_INTERVAL_MINUTES: '15',
  WORKER_RUN_ON_START: 'true',
  WORKER_QUEUE_CONCURRENCY: '2',
  WORKER_ENABLE_LLM_RANKING: 'true',
  WORKER_USE_CHROME: 'false',
  WORKER_CHROME_HEADLESS: 'true',
  WORKER_AUTO_CLEANUP_CHROME: 'true',
  WORKER_CHROME_PORT: '9222',
  WORKER_LINKEDIN_PAGES: '3',
  WORKER_LINKEDIN_MAX_POSTINGS: '',
  WORKER_LINKEDIN_DEBUG_STEPS: 'none',
  WORKER_REMOTIVE_MAX_POSTINGS: '',
  WORKER_REMOTIVE_FETCH_TIMEOUT_MS: '30000',
  WORKER_DEFAULT_EVALUATOR_ID: '',
  LLM_RANKING_PROVIDER: 'cursor',
  LLM_RANKING_MODEL: 'gpt-4.1-mini',
  LLM_RANKING_CURSOR_MODEL: 'auto',
  LLM_RANKING_TIMEOUT_MS: '60000',
  LLM_RANKING_TIMEOUT_PER_CANDIDATE_MS: '5000',
  LLM_RANKING_DESCRIPTION_MAX_CHARS: '4096',
  LLM_API_BASE_URL: 'https://api.openai.com/v1',
  LLM_RANKING_TEMPERATURE: '0.1',
  CURSOR_CLI_COMMAND: 'cursor-agent',
  CURSOR_CLI_WORKSPACE: 'apps/worker/ranking-cli-workspace',
  LLM_RANKING_CURSOR_FILE_EXTRA_TIMEOUT_MS: '90000',
  LLM_RANKING_CURSOR_MINIMAL_CONTEXT: 'true',
  LLM_RANKING_CURSOR_LOG_OUTPUT: 'true',
  VITE_WORKER_TRIGGER_URL: 'http://127.0.0.1:3999/trigger',
  LLM_RANKING_CURSOR_USE_BATCH_FILES: 'true',
  LLM_RANKING_CURSOR_INLINE_PROMPT: 'false',
  LLM_RANKING_CURSOR_KEEP_BATCH_FILES: 'false',
} as const;

export type AppSettingKey = keyof typeof SYSTEM_SETTING_DEFAULTS;

/** Allowlisted keys (same set as `SYSTEM_SETTING_DEFAULTS`). */
export const APP_SETTING_KEYS = Object.keys(
  SYSTEM_SETTING_DEFAULTS
) as AppSettingKey[];

/** Factory default string for a catalog key (UI / seed only). */
export function getSystemDefault(key: AppSettingKey): string {
  return SYSTEM_SETTING_DEFAULTS[key];
}

/** Full factory record for cold-start seed when no row exists. */
export function buildSystemDefaultsRecord(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of APP_SETTING_KEYS) {
    out[key] = getSystemDefault(key);
  }
  return out;
}

/**
 * @deprecated Use `buildSystemDefaultsRecord`.
 */
export function buildDefaultsRecord(): Record<string, string> {
  return buildSystemDefaultsRecord();
}

/** Keys with no entry in stored (`undefined` only — not empty string). */
export function listMissingSettingKeys(
  stored: Record<string, string | undefined> | null | undefined
): AppSettingKey[] {
  return APP_SETTING_KEYS.filter((key) => stored?.[key] === undefined);
}

/** Patch object to merge into `app_settings.values` for missing keys only. */
export function buildSeedPatch(
  stored: Record<string, string | undefined> | null | undefined
): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const key of listMissingSettingKeys(stored)) {
    patch[key] = getSystemDefault(key);
  }
  return patch;
}
