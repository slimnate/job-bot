import { workerLog } from '../log.js';

/**
 * `WORKER_LINKEDIN_DEBUG_STEPS`: controls **manual Continue** stepping in the in-page scrape driver
 * (`waitMajor` / `waitFine`) and Node-side `linkedInWaitStep` — not the overlay UI (always full bar).
 */
export type LinkedInDebugSteps = 'none' | 'coarse' | 'fine';

const allowed = new Set<string>(['none', 'coarse', 'fine']);

export function parseLinkedInDebugSteps(env: NodeJS.ProcessEnv): LinkedInDebugSteps {
  const raw = env.WORKER_LINKEDIN_DEBUG_STEPS;
  if (raw === undefined || raw.trim() === '') {
    return 'none';
  }
  const key = raw.trim().toLowerCase();
  if (allowed.has(key)) {
    return key as LinkedInDebugSteps;
  }
  workerLog.warn('linkedin.debug_steps', {
    message: `Unknown WORKER_LINKEDIN_DEBUG_STEPS=${JSON.stringify(raw)}; using none`,
  });
  return 'none';
}
