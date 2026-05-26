/**
 * UI-exposed app settings catalog. Values persist in Convex `app_settings`;
 * non-empty env vars override stored values at runtime.
 * Factory default strings live in `systemSettingDefaults.ts` (seed / UI reference only).
 */

import { type AppSettingKey } from './systemSettingDefaults.js';

export type { AppSettingKey };
export { APP_SETTING_KEYS } from './systemSettingDefaults.js';

export type AppSettingSection =
  | 'scheduler'
  | 'linkedin'
  | 'remotive'
  | 'ranking'
  | 'http_openai'
  | 'cursor_cli'
  | 'web'
  | 'advanced';

export type AppSettingType = 'boolean' | 'number' | 'string' | 'enum' | 'evaluator_id';

export type AppSettingDefinition = {
  key: AppSettingKey;
  label: string;
  hint: string;
  type: AppSettingType;
  section: AppSettingSection;
  min?: number;
  max?: number;
  enumOptions?: readonly { value: string; label: string }[];
  /** When set, empty stored value is allowed (optional field). */
  optional?: boolean;
};

/** Ordered sections for the Settings page. */
export const APP_SETTING_SECTION_ORDER: readonly AppSettingSection[] = [
  'scheduler',
  'linkedin',
  'remotive',
  'ranking',
  'http_openai',
  'cursor_cli',
  'web',
  'advanced',
] as const;

export const APP_SETTING_SECTION_LABELS: Record<AppSettingSection, string> = {
  scheduler: 'Scheduler & queue',
  linkedin: 'LinkedIn scraping',
  remotive: 'Remotive scraping',
  ranking: 'Ranking defaults',
  http_openai: 'HTTP / OpenAI (non-secret)',
  cursor_cli: 'Cursor CLI',
  web: 'Web ↔ worker',
  advanced: 'Advanced (Cursor batch files)',
};

/** Short copy for the Settings overview page (one line per section). */
export const APP_SETTING_SECTION_DESCRIPTIONS: Record<AppSettingSection, string> = {
  scheduler:
    'Cron interval, queue concurrency, boot-time queue check, and whether the worker runs LLM ranking after each scrape.',
  linkedin:
    'Chrome/CDP toggles, headless mode, port, pagination limits, optional posting cap, and manual debug stepping.',
  remotive:
    'RSS fetch timeout and optional cap on postings collected per Remotive scrape run.',
  ranking:
    'Default evaluator when a run has none, LLM provider and models, ranking timeouts, and HTTP prompt description length.',
  http_openai:
    'OpenAI-compatible API base URL and sampling temperature for HTTP ranking (API key remains env-only).',
  cursor_cli:
    'cursor-agent executable, workspace directory, extra batch timeouts, minimal CLI context, and output logging.',
  web:
    'Worker trigger URL for scrape-queue Trigger now and Postings Cursor scoring (overridable via Vite env).',
  advanced:
    'Cursor batch files vs inline prompts and whether ranking batch directories are kept on disk for debugging.',
};

/** Catalog entry with a typed allowlisted key. */
function settingDef(input: AppSettingDefinition): AppSettingDefinition {
  return input;
}

export const APP_SETTING_DEFINITIONS: readonly AppSettingDefinition[] = [
  settingDef({
    key: 'WORKER_CRON_INTERVAL_MINUTES',
    label: 'Scheduler interval (minutes)',
    hint:
      'How often the worker scheduler checks Convex for queued scrape runs, in minutes. Default is 15. The Workers page shows live scheduler status from Convex. Changes apply on the next settings refresh (about 30 seconds) without restarting the worker. If WORKER_CRON_INTERVAL_MINUTES is set in .env.local or your shell, that value overrides what you save here.',
    type: 'number',
    section: 'scheduler',
    min: 1,
    max: 1440,
  }),
  settingDef({
    key: 'WORKER_RUN_ON_START',
    label: 'Check queue on worker start',
    hint:
      'When enabled (default), the worker runs a scheduler tick immediately on boot to pick up runs already in the queued state. This does not auto-create new scrape runs; use the Workers page or cron to queue work. Disabling only skips that first tick. Env var WORKER_RUN_ON_START=false overrides a saved “on” value.',
    type: 'boolean',
    section: 'scheduler',
  }),
  settingDef({
    key: 'WORKER_QUEUE_CONCURRENCY',
    label: 'Queue concurrency',
    hint:
      'Maximum scrape runs the worker may execute in parallel (default 2). LinkedIn runs are still serialized to one Chrome session even when concurrency is higher. Increase only if you run multiple non-Chrome sources at once. Takes effect on the next settings refresh (~30s). WORKER_QUEUE_CONCURRENCY in the environment overrides this field.',
    type: 'number',
    section: 'scheduler',
    min: 1,
    max: 32,
  }),
  settingDef({
    key: 'WORKER_ENABLE_LLM_RANKING',
    label: 'Enable post-scrape LLM ranking',
    hint:
      'When enabled (default), the worker scores postings with the LLM after each successful scrape. Set to off to skip ranking during testing (runs complete with rankedCount=0). Does not affect manual Score on the Postings page. WORKER_ENABLE_LLM_RANKING=0 in .env.local overrides a saved “on” value.',
    type: 'boolean',
    section: 'scheduler',
  }),
  settingDef({
    key: 'WORKER_USE_CHROME',
    label: 'Use Chrome for scraping',
    hint:
      'Required for LinkedIn scraping. When enabled, the worker uses Chrome with remote debugging (CDP). Chrome is not started at worker boot; the first LinkedIn scrape spawns or attaches Chrome. If Chrome exits, the next LinkedIn run reconnects or respawns. WORKER_USE_CHROME=1 in the environment overrides this toggle.',
    type: 'boolean',
    section: 'linkedin',
  }),
  settingDef({
    key: 'WORKER_CHROME_HEADLESS',
    label: 'Chrome headless mode',
    hint:
      'When enabled (default), Chrome runs without a visible window. Set to off (false) to see the browser—recommended while signing in to LinkedIn or debugging UI flows. Only applies when the worker manages Chrome (not when attaching to an external instance via WORKER_MANAGE_CHROME=0 in env). WORKER_CHROME_HEADLESS=0 overrides a saved “on” value.',
    type: 'boolean',
    section: 'linkedin',
  }),
  settingDef({
    key: 'WORKER_AUTO_CLEANUP_CHROME',
    label: 'Close Chrome after LinkedIn runs',
    hint:
      'When enabled (default), the worker tears down the Chrome instance after each LinkedIn scrape finishes. Set to off to keep Chrome alive across runs while debugging. WORKER_AUTO_CLEANUP_CHROME=0 in .env.local overrides a saved “on” value.',
    type: 'boolean',
    section: 'linkedin',
  }),
  settingDef({
    key: 'WORKER_CHROME_PORT',
    label: 'Chrome remote debugging port',
    hint:
      'TCP port for Chrome remote debugging when the worker manages Chrome (default 9222). Must match any external Chrome you attach to when WORKER_MANAGE_CHROME=0 is set in the environment (not configurable here). WORKER_CHROME_PORT in env overrides this value.',
    type: 'number',
    section: 'linkedin',
    min: 1024,
    max: 65535,
  }),
  settingDef({
    key: 'WORKER_LINKEDIN_PAGES',
    label: 'LinkedIn results pages',
    hint:
      'How many LinkedIn search result pages (pagination “Next”) to scrape per run. Minimum 1, maximum 10; default 3. Values above 10 are clamped with a worker warning. Applies to the next LinkedIn scrape after settings refresh. WORKER_LINKEDIN_PAGES in env overrides this field.',
    type: 'number',
    section: 'linkedin',
    min: 1,
    max: 10,
  }),
  settingDef({
    key: 'WORKER_LINKEDIN_MAX_POSTINGS',
    label: 'Max postings per LinkedIn run',
    hint:
      'Optional cap on total LinkedIn postings collected in one run. Leave empty for unlimited. When set, the scraper and live upserts stop at this count. Must be a positive integer; invalid env values are ignored with a warning. WORKER_LINKEDIN_MAX_POSTINGS in env overrides a saved value.',
    type: 'number',
    section: 'linkedin',
    min: 1,
    optional: true,
  }),
  settingDef({
    key: 'WORKER_LINKEDIN_DEBUG_STEPS',
    label: 'LinkedIn manual debug stepping',
    hint:
      'Controls manual Continue checkpoints during LinkedIn scrapes only. none: no stepping (default). coarse: pauses at major phases and before pagination. fine: also pauses after each job with a short preview. The scrape top bar (Pause, Finish & rank, etc.) is always shown once the jobs shell is ready. Shell exports of WORKER_LINKEDIN_DEBUG_STEPS override .env.local for that key. Env overrides this select.',
    type: 'enum',
    section: 'linkedin',
    enumOptions: [
      { value: 'none', label: 'None' },
      { value: 'coarse', label: 'Coarse' },
      { value: 'fine', label: 'Fine' },
    ],
  }),
  settingDef({
    key: 'WORKER_REMOTIVE_MAX_POSTINGS',
    label: 'Max postings per Remotive run',
    hint:
      'Optional cap on total Remotive postings collected in one run (across all selected category feeds, after dedupe). Leave empty for unlimited. Invalid env values are ignored with a worker warning. WORKER_REMOTIVE_MAX_POSTINGS in env overrides a saved value.',
    type: 'number',
    section: 'remotive',
    min: 1,
    optional: true,
  }),
  settingDef({
    key: 'WORKER_REMOTIVE_FETCH_TIMEOUT_MS',
    label: 'RSS fetch timeout (ms)',
    hint:
      'HTTP timeout when fetching each Remotive RSS feed URL (all-jobs or per category), in milliseconds. Default 30000. Applies on the next Remotive scrape after settings refresh. WORKER_REMOTIVE_FETCH_TIMEOUT_MS in env overrides this field.',
    type: 'number',
    section: 'remotive',
    min: 1000,
    max: 300000,
  }),
  settingDef({
    key: 'WORKER_DEFAULT_EVALUATOR_ID',
    label: 'Default evaluator (worker fallback)',
    hint:
      'Convex job_evaluators document id used when a scrape run has no evaluator and the source has no default on the Sources page. Choose an Active evaluator for full resume and prompt context. Per-machine override: set WORKER_DEFAULT_EVALUATOR_ID in .env.local on that worker host. Env wins over this dropdown.',
    type: 'evaluator_id',
    section: 'ranking',
    optional: true,
  }),
  settingDef({
    key: 'LLM_RANKING_PROVIDER',
    label: 'Default ranking provider',
    hint:
      'Default for post-scrape worker ranking: cursor (Cursor CLI on the worker) or http (OpenAI-compatible API). The Postings Score dialog can override per request. If unset in env and no OpenAI key exists, the worker defaults to cursor. LLM_RANKING_PROVIDER in env overrides this select.',
    type: 'enum',
    section: 'ranking',
    enumOptions: [
      { value: 'cursor', label: 'Cursor CLI' },
      { value: 'http', label: 'HTTP (OpenAI-compatible)' },
    ],
  }),
  settingDef({
    key: 'LLM_RANKING_MODEL',
    label: 'HTTP ranking model',
    hint:
      'OpenAI-compatible model id for http provider ranking (default gpt-4.1-mini). Used by worker post-scrape ranking and as fallback for Cursor when LLM_RANKING_CURSOR_MODEL is unset. The Postings Score dialog model list overrides per score. Requires OPENAI_API_KEY in env (not stored here). LLM_RANKING_MODEL in env overrides this field.',
    type: 'string',
    section: 'ranking',
  }),
  settingDef({
    key: 'LLM_RANKING_CURSOR_MODEL',
    label: 'Cursor CLI model',
    hint:
      'Model id passed to cursor-agent --model (default auto). Legacy catalog value cursor-default is mapped to auto. Postings Score can pick another model per run. LLM_RANKING_CURSOR_MODEL in env overrides this field.',
    type: 'string',
    section: 'ranking',
  }),
  settingDef({
    key: 'LLM_RANKING_TIMEOUT_MS',
    label: 'Ranking base timeout (ms)',
    hint:
      'Base timeout in milliseconds for a ranking request (default 60000). Total timeout adds LLM_RANKING_TIMEOUT_PER_CANDIDATE_MS per posting for batch paths. LLM_RANKING_TIMEOUT_MS in env overrides this value.',
    type: 'number',
    section: 'ranking',
    min: 1000,
  }),
  settingDef({
    key: 'LLM_RANKING_TIMEOUT_PER_CANDIDATE_MS',
    label: 'Ranking extra timeout per posting (ms)',
    hint:
      'Added to the base timeout for each posting in a batch ranking call (default 5000). LLM_RANKING_TIMEOUT_PER_CANDIDATE_MS in env overrides this field.',
    type: 'number',
    section: 'ranking',
    min: 0,
  }),
  settingDef({
    key: 'LLM_RANKING_DESCRIPTION_MAX_CHARS',
    label: 'Max description chars in HTTP prompts',
    hint:
      'Truncates job description text in HTTP inline prompts (default 4096). Full descriptions remain in the database and in Cursor batch files. Also used by Convex OpenAI scoring from the Postings page. LLM_RANKING_DESCRIPTION_MAX_CHARS in env overrides this value.',
    type: 'number',
    section: 'ranking',
    min: 256,
  }),
  settingDef({
    key: 'LLM_API_BASE_URL',
    label: 'LLM API base URL',
    hint:
      'Base URL for OpenAI-compatible HTTP ranking (default https://api.openai.com/v1). Used by worker http ranking and Convex scoreOnePosting. Trailing slashes are normalized. OPENAI_API_KEY must be set in Convex dashboard or worker env—not in this UI. LLM_API_BASE_URL in env overrides this field.',
    type: 'string',
    section: 'http_openai',
  }),
  settingDef({
    key: 'LLM_RANKING_TEMPERATURE',
    label: 'LLM temperature',
    hint:
      'Sampling temperature for HTTP ranking requests (default 0.1). Lower values are more deterministic. Used by worker and Convex OpenAI paths. LLM_RANKING_TEMPERATURE in env overrides this field.',
    type: 'number',
    section: 'http_openai',
    min: 0,
    max: 2,
  }),
  settingDef({
    key: 'CURSOR_CLI_COMMAND',
    label: 'Cursor CLI command',
    hint:
      'Executable invoked for Cursor ranking (default cursor-agent). Must be on PATH for the worker process. CURSOR_CLI_COMMAND in env overrides this field.',
    type: 'string',
    section: 'cursor_cli',
  }),
  settingDef({
    key: 'CURSOR_CLI_WORKSPACE',
    label: 'Cursor CLI workspace directory',
    hint:
      'Working directory for cursor-agent so repo AGENTS.md and .cursor/rules are not loaded (default apps/worker/ranking-cli-workspace). Use an empty or dedicated folder. CURSOR_CLI_WORKSPACE in env overrides this path.',
    type: 'string',
    section: 'cursor_cli',
  }),
  settingDef({
    key: 'LLM_RANKING_CURSOR_FILE_EXTRA_TIMEOUT_MS',
    label: 'Cursor batch files extra timeout (ms)',
    hint:
      'Additional timeout when ranking via postings.json batch files (default 90000). LLM_RANKING_CURSOR_FILE_EXTRA_TIMEOUT_MS in env overrides this value.',
    type: 'number',
    section: 'cursor_cli',
    min: 0,
  }),
  settingDef({
    key: 'LLM_RANKING_CURSOR_MINIMAL_CONTEXT',
    label: 'Cursor minimal CLI context',
    hint:
      'When enabled (default), forces --mode=ask, --trust, and --workspace on the Cursor CLI invocation. Set to off only if you need full agent context from the repo. LLM_RANKING_CURSOR_MINIMAL_CONTEXT=0 in env overrides a saved “on” value.',
    type: 'boolean',
    section: 'cursor_cli',
  }),
  settingDef({
    key: 'LLM_RANKING_CURSOR_LOG_OUTPUT',
    label: 'Log Cursor CLI stdout/stderr',
    hint:
      'When enabled (default), each cursor-agent output line is logged as llm.rank.cursor_cli.output during ranking. Set to off to reduce log volume. LLM_RANKING_CURSOR_LOG_OUTPUT=0 in env overrides a saved “on” value.',
    type: 'boolean',
    section: 'cursor_cli',
  }),
  settingDef({
    key: 'VITE_WORKER_TRIGGER_URL',
    label: 'Worker trigger URL (web)',
    hint:
      'URL the web app uses for Trigger now on the scrape queue and for Cursor Score POST requests (default http://127.0.0.1:3999/trigger). Must match WORKER_HTTP_TRIGGER_PORT on the worker (env-only). The base URL is derived by stripping /trigger. import.meta.env.VITE_WORKER_TRIGGER_URL overrides a value saved here.',
    type: 'string',
    section: 'web',
  }),
  settingDef({
    key: 'LLM_RANKING_CURSOR_USE_BATCH_FILES',
    label: 'Cursor use batch files',
    hint:
      'When enabled (default), Cursor ranking writes postings.json and evaluator.json under ranking-cli-workspace/.ranking-batches/ instead of inlining huge prompts. LLM_RANKING_CURSOR_USE_BATCH_FILES=0 in env overrides a saved “on” value.',
    type: 'boolean',
    section: 'advanced',
  }),
  settingDef({
    key: 'LLM_RANKING_CURSOR_INLINE_PROMPT',
    label: 'Cursor force inline prompt',
    hint:
      'When enabled, puts all posting text in the argv prompt instead of batch files (default off). Use only for debugging small jobs. LLM_RANKING_CURSOR_INLINE_PROMPT=1 in env overrides a saved “off” value.',
    type: 'boolean',
    section: 'advanced',
  }),
  settingDef({
    key: 'LLM_RANKING_CURSOR_KEEP_BATCH_FILES',
    label: 'Keep Cursor batch files on disk',
    hint:
      'When enabled, leaves batch directories after ranking for inspection (default off). LLM_RANKING_CURSOR_KEEP_BATCH_FILES=1 in env overrides a saved “off” value.',
    type: 'boolean',
    section: 'advanced',
  }),
] as const;

const definitionByKey = new Map(APP_SETTING_DEFINITIONS.map((d) => [d.key, d]));

export function getAppSettingDefinition(key: string): AppSettingDefinition | undefined {
  return definitionByKey.get(key as AppSettingKey);
}

export function isAppSettingKey(key: string): key is AppSettingKey {
  return definitionByKey.has(key as AppSettingKey);
}

/**
 * Definitions grouped by section in display order.
 */
export function listAppSettingDefinitionsForUi(): {
  section: AppSettingSection;
  sectionLabel: string;
  definitions: AppSettingDefinition[];
}[] {
  return APP_SETTING_SECTION_ORDER.map((section) => ({
    section,
    sectionLabel: APP_SETTING_SECTION_LABELS[section],
    definitions: APP_SETTING_DEFINITIONS.filter((d) => d.section === section),
  }));
}

export { buildDefaultsRecord, buildSystemDefaultsRecord } from './systemSettingDefaults.js';
