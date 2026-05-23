import type { Id } from './convexBridge/doc.js';
import { getOptionalSettingString } from './settings/settingsHelpers.js';

/**
 * When a scrape run has no `evaluatorId`, the worker uses this Convex `job_evaluators` document id
 * for LLM ranking after the source default. Env `WORKER_DEFAULT_EVALUATOR_ID` overrides Convex settings.
 */
export function parseWorkerDefaultEvaluatorId(): Id<'job_evaluators'> | undefined {
  const raw = getOptionalSettingString('WORKER_DEFAULT_EVALUATOR_ID').trim();
  if (!raw) {
    return undefined;
  }
  return raw as Id<'job_evaluators'>;
}
