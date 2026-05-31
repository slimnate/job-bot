import { useQuery } from 'convex/react';
import { Link, useParams } from 'react-router-dom';

import { api } from '../../../../convex/_generated/api.js';
import type { Id } from '../../../../convex/_generated/dataModel.js';
import { formatRunStatusLabel, runStatusBadgeClass } from '../lib/formatRunStatus';

const formatDateTime = (timestamp?: number): string => {
  if (!timestamp) {
    return '-';
  }
  return new Date(timestamp).toLocaleString();
};

/**
 * Shows metadata for one scrape run plus JSON lines mirrored from the worker process (`workerLog` output).
 * Lines only exist for runs executed after the worker was updated to stream logs into Convex.
 */
export function RunDetailPage() {
  const { runId: runIdParam } = useParams<{ runId: string }>();
  const runId = runIdParam as Id<'scrape_runs'> | undefined;

  const run = useQuery(api.runs.get, runId ? { runId } : 'skip');
  const logRows = useQuery(api.runLogs.listByRun, runId ? { runId } : 'skip');

  if (!runIdParam) {
    return (
      <section className='panel'>
        <p>Missing run id in the URL.</p>
        <Link to='/workers'>Back to workers</Link>
      </section>
    );
  }

  return (
    <section className='panel'>
      <div className='panel-heading'>
        <h2>Run logs</h2>
        <Link to='/workers'>Back to workers</Link>
      </div>
      {run === undefined ? (
        <p>Loading run…</p>
      ) : run === null ? (
        <p>Run not found.</p>
      ) : (
        <div className='run-detail-meta'>
          {(() => {
            const withSearchTelemetry = run as typeof run & {
              usedLinkedinUrlFallback?: boolean;
              linkedinFallbackReason?: string;
              linkedinSearchStrategy?: string;
            };
            if (!withSearchTelemetry.linkedinSearchStrategy && !withSearchTelemetry.usedLinkedinUrlFallback) {
              return null;
            }
            const strategyLabel =
              withSearchTelemetry.linkedinSearchStrategy === 'search_url'
                ? 'Search URL'
                : withSearchTelemetry.linkedinSearchStrategy;
            return (
              <p>
                <span className='run-detail-label'>Search path</span>{' '}
                {withSearchTelemetry.usedLinkedinUrlFallback
                  ? `URL fallback used${withSearchTelemetry.linkedinFallbackReason ? ` (${withSearchTelemetry.linkedinFallbackReason})` : ''}`
                  : strategyLabel}
              </p>
            );
          })()}
          <p>
            <span className='run-detail-label'>Status</span>{' '}
            <span className={`status-badge status-${runStatusBadgeClass(run)}`}>
              {formatRunStatusLabel(run)}
            </span>
          </p>
          <p>
            <span className='run-detail-label'>Source</span> {run.source}
          </p>
          <p>
            <span className='run-detail-label'>Started</span> {formatDateTime(run.startedAt)}
          </p>
          <p>
            <span className='run-detail-label'>Ended</span> {formatDateTime(run.endedAt)}
          </p>
          {run.errorMessage ? (
            <p>
              <span className='run-detail-label'>Error</span> {run.errorMessage}
            </p>
          ) : null}
        </div>
      )}
      {logRows === undefined ? (
        <p>Loading logs…</p>
      ) : logRows.length === 0 ? (
        <p className='status-text'>
          No log lines stored for this run. Logs are recorded when the worker streams worker log output to
          Convex; older runs or runs that never started on the worker will be empty.
        </p>
      ) : (
        <pre className='run-log-dump'>{logRows.map((r) => r.line).join('\n')}</pre>
      )}
    </section>
  );
}
