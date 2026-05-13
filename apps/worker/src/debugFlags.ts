/**
 * Optional env toggles for subsystem `workerLog.debug` lines. All default off when unset.
 * Parse style matches other worker env parsing (`1`, `true`, `yes`, `on` vs `0`, `false`, …).
 */

function parseEnvBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  const lower = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(lower)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(lower)) {
    return false;
  }
  return defaultValue;
}

export function isSchedulerDebug(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvBool(env.SCHEDULER_DEBUG, false);
}

export function isOrchestratorDebug(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvBool(env.ORCHESTRATOR_DEBUG, false);
}

export function isScrapeDebug(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvBool(env.SCRAPE_DEBUG, false);
}

export function isRankDebug(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvBool(env.RANK_DEBUG, false);
}
