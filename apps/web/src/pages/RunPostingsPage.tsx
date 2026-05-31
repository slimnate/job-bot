import { useQuery } from 'convex/react';
import { useNavigate, useParams } from 'react-router-dom';

import { api } from '../../../../convex/_generated/api.js';
import type { Doc, Id } from '../../../../convex/_generated/dataModel.js';
import { PostingViewer } from '../components/PostingViewer';
import { formatSourceCriteriaSummary } from '../lib/formatSourceCriteria';
import { formatRunStatusLabel, runStatusBadgeClass } from '../lib/formatRunStatus';

const formatDateTime = (timestamp?: number): string => {
  if (!timestamp) {
    return '-';
  }
  return new Date(timestamp).toLocaleString();
};

function runHeadingSubtitle(run: Doc<'scrape_runs'>): string {
  const parts: string[] = [run.source];

  const criteria = formatSourceCriteriaSummary(run.source, run.sourceCriteria);
  if (criteria && criteria !== '—') {
    parts.push(criteria);
  }

  parts.push(`started ${formatDateTime(run.startedAt)}`);
  if (run.endedAt) {
    parts.push(`completed ${formatDateTime(run.endedAt)}`);
  }

  if (run.stats) {
    parts.push(
      `disc ${run.stats.discoveredCount}, ins ${run.stats.insertedCount}, rank ${run.stats.rankedCount}`
    );
  }

  return parts.join(' · ');
}

/**
 * Jobs scraped during one run, with the same list tooling as the main Postings page.
 */
export function RunPostingsPage() {
  const navigate = useNavigate();
  const { runId: runIdParam } = useParams<{ runId: string }>();
  const runId = runIdParam as Id<'scrape_runs'> | undefined;

  const run = useQuery(api.runs.get, runId ? { runId } : 'skip');

  if (!runIdParam) {
    return (
      <section className='panel'>
        <p>Missing run id in the URL.</p>
        <button type='button' onClick={() => navigate('/workers')}>
          Back to workers
        </button>
      </section>
    );
  }

  if (run === undefined) {
    return (
      <section className='panel'>
        <p>Loading run…</p>
      </section>
    );
  }

  if (run === null) {
    return (
      <section className='panel'>
        <p>Run not found.</p>
        <button type='button' onClick={() => navigate('/workers')}>
          Back to workers
        </button>
      </section>
    );
  }

  return (
    <PostingViewer
      scrapeRunId={runId}
      showClearAll={false}
      onViewActiveForCompanyNavigate={(company) => {
        const params = new URLSearchParams();
        params.set('q', company);
        navigate(`/postings?${params.toString()}`);
      }}
      headerContent={
        <>
          <div>
            <h2>Jobs from run</h2>
            <p className='panel-subtitle tight'>{runHeadingSubtitle(run)}</p>
            <p className='panel-subtitle tight run-postings-heading-status'>
              <span className={`status-badge status-${runStatusBadgeClass(run)}`}>
                {formatRunStatusLabel(run)}
              </span>
              {run.errorMessage ? (
                <span className='run-postings-heading-error' title={run.errorMessage}>
                  {run.errorMessage}
                </span>
              ) : null}
            </p>
          </div>
          <div className='queue-actions-cell'>
            <button type='button' onClick={() => navigate('/workers')}>
              Back to workers
            </button>
            <button type='button' onClick={() => navigate('/postings')}>
              All postings
            </button>
          </div>
        </>
      }
    />
  );
}
