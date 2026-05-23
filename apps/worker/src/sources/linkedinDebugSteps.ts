import { parseAppSettingValue } from '@job-bot/shared';

import { workerLog } from '../log.js';

/**
 * `WORKER_LINKEDIN_DEBUG_STEPS`: controls **manual Continue** stepping in the in-page scrape driver
 * (`waitMajor` / `waitFine`) and Node-side `linkedInWaitStep` — not the overlay UI (always full bar).
 */
export type LinkedInDebugSteps = 'none' | 'coarse' | 'fine';

const allowed = new Set<string>(['none', 'coarse', 'fine']);

function requireResolved(env: Record<string, string | undefined>, key: string): string {
  const raw = env[key];
  if (raw === undefined) {
    throw new Error(`Missing '${key}' in worker settings (seed app_settings or set env)`);
  }
  return raw;
}

export function parseLinkedInDebugSteps(env: NodeJS.ProcessEnv): LinkedInDebugSteps {
  return parseLinkedInDebugStepsFromResolvedEnv(env);
}

/** Parses debug stepping from a settings-merged env record (post seed / cache refresh). */
export function parseLinkedInDebugStepsFromResolvedEnv(
  env: Record<string, string | undefined>
): LinkedInDebugSteps {
  const raw = requireResolved(env, 'WORKER_LINKEDIN_DEBUG_STEPS');
  const parsed = parseAppSettingValue('WORKER_LINKEDIN_DEBUG_STEPS', raw);
  const key = String(parsed).trim().toLowerCase();
  if (allowed.has(key)) {
    return key as LinkedInDebugSteps;
  }
  workerLog.warn('linkedin.debug_steps', {
    message: `Unknown WORKER_LINKEDIN_DEBUG_STEPS=${JSON.stringify(raw)}`,
  });
  throw new Error(`Invalid WORKER_LINKEDIN_DEBUG_STEPS: ${JSON.stringify(raw)}`);
}
