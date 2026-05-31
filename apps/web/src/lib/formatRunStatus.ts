import type { Doc } from '../../../../convex/_generated/dataModel.js';

type RunStatusFields = Pick<Doc<'scrape_runs'>, 'status' | 'rankingBatchIndex' | 'rankingBatchTotal'>;

/**
 * Human-readable run status for history tables, including ranking batch progress (e.g. `ranking 2/5`).
 */
export function formatRunStatusLabel(run: RunStatusFields): string {
  if (
    run.status === 'ranking' &&
    run.rankingBatchIndex != null &&
    run.rankingBatchTotal != null &&
    run.rankingBatchTotal > 0
  ) {
    return `ranking ${run.rankingBatchIndex}/${run.rankingBatchTotal}`;
  }
  return run.status;
}

/** CSS class suffix for `status-badge status-${class}` from a run row. */
export function runStatusBadgeClass(run: RunStatusFields): string {
  if (run.status === 'ranking' || run.status === 'scraping') {
    return run.status;
  }
  if (run.status === 'running') {
    return 'scraping';
  }
  return run.status;
}

/** True when the run has not finished (queued or active worker phases). */
export function isRunInProgress(status: Doc<'scrape_runs'>['status']): boolean {
  return (
    status === 'queued' ||
    status === 'running' ||
    status === 'scraping' ||
    status === 'ranking'
  );
}

/** True when the UI may request a graceful stop (worker is mid-pipeline). */
export function canRequestGracefulStop(status: Doc<'scrape_runs'>['status']): boolean {
  return status === 'running' || status === 'scraping' || status === 'ranking';
}
