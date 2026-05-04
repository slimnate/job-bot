import { workerLog } from '../log.js';

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

/** Full stepping UI (Continue / Finish / Abort). Used when {@link LinkedInDebugSteps} is `coarse` or `fine`. */
export type LinkedInOverlayKind = 'abort_only' | 'full';

/**
 * `none` uses a thin strip with **Finish & rank** + **Abort** (no Continue stepping); `coarse`/`fine` use the full bar.
 */
export function linkedInOverlayKind(mode: LinkedInDebugSteps): LinkedInOverlayKind {
  return mode === 'none' ? 'abort_only' : 'full';
}
