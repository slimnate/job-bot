/**
 * Base URL for worker HTTP endpoints (must match `WORKER_HTTP_TRIGGER_PORT` / `WORKER_TRIGGER_URL`).
 * Default matches `dev:all` and `ScrapeQueuePanel` trigger-now behavior.
 *
 * Note: scheduler status no longer comes from a worker HTTP fetch — it is read
 * reactively from Convex (`worker_scheduler_status`). The worker's
 * `GET /scheduler` endpoint is still exposed for ops debugging via `curl`.
 */
export function getWorkerTriggerUrl(): string {
  const raw = (import.meta.env.VITE_WORKER_TRIGGER_URL as string | undefined)?.trim();
  return raw && raw.length > 0 ? raw : 'http://127.0.0.1:3999/trigger';
}
