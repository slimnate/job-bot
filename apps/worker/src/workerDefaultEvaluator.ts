import type { Id } from './convexBridge/doc.js';

/**
 * When a scrape run has no `evaluatorId`, the worker uses this Convex `job_evaluators` document id
 * for LLM ranking. Configured per worker process (e.g. `.env.local` on the machine running the worker),
 * not in the database.
 */
export function parseWorkerDefaultEvaluatorId(env: NodeJS.ProcessEnv): Id<'job_evaluators'> | undefined {
  const raw = env.WORKER_DEFAULT_EVALUATOR_ID?.trim();
  if (!raw) {
    return undefined;
  }
  return raw as Id<'job_evaluators'>;
}
