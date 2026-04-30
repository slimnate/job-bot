import { useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';

import { api } from '../../../../convex/_generated/api.js';

type RunStatus = '' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

const formatDateTime = (timestamp?: number): string => {
  if (!timestamp) {
    return '-';
  }
  return new Date(timestamp).toLocaleString();
};

const formatRunDuration = (startedAt: number, endedAt?: number): string => {
  if (!endedAt || endedAt <= startedAt) {
    return '-';
  }
  const seconds = Math.round((endedAt - startedAt) / 1000);
  return `${seconds}s`;
};

export function HistoryViewer() {
  const criteria = useQuery(api.criteria.get, { onlyActive: true });
  const triggerRun = useMutation(api.runs.trigger);

  const [runSourceFilter, setRunSourceFilter] = useState('');
  const [runStatusFilter, setRunStatusFilter] = useState<RunStatus>('');
  const [triggerMessage, setTriggerMessage] = useState('');
  const [isTriggeringRun, setIsTriggeringRun] = useState(false);

  const runs = useQuery(api.runs.list, {
    source: runSourceFilter.trim() || undefined,
    status: runStatusFilter || undefined,
    limit: 50,
  });

  const runSources = useMemo(() => {
    if (!runs) {
      return [];
    }
    return Array.from(new Set(runs.map((run) => run.source))).sort();
  }, [runs]);

  const onTriggerRun = async () => {
    setIsTriggeringRun(true);
    setTriggerMessage('');
    try {
      const result = await triggerRun({
        criteriaId: criteria?._id,
      });
      setTriggerMessage(`Queued ${result.runIds.length} run(s).`);
    } catch (error) {
      setTriggerMessage(
        error instanceof Error ? `Run trigger failed: ${error.message}` : 'Run trigger failed.'
      );
    } finally {
      setIsTriggeringRun(false);
    }
  };

  return (
    <section className='panel'>
      <div className='panel-heading'>
        <h2>Scrape Run History</h2>
        <button onClick={onTriggerRun} disabled={isTriggeringRun}>
          {isTriggeringRun ? 'Triggering...' : 'Trigger run'}
        </button>
      </div>
      {triggerMessage ? <p className='status-text'>{triggerMessage}</p> : null}
      <div className='filters'>
        <select value={runSourceFilter} onChange={(event) => setRunSourceFilter(event.target.value)}>
          <option value=''>All sources</option>
          {runSources.map((source) => (
            <option value={source} key={source}>
              {source}
            </option>
          ))}
        </select>
        <select value={runStatusFilter} onChange={(event) => setRunStatusFilter(event.target.value as RunStatus)}>
          <option value=''>All statuses</option>
          <option value='queued'>Queued</option>
          <option value='running'>Running</option>
          <option value='succeeded'>Succeeded</option>
          <option value='failed'>Failed</option>
          <option value='cancelled'>Cancelled</option>
        </select>
      </div>
      <div className='table-wrapper'>
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Source</th>
              <th>Started</th>
              <th>Ended</th>
              <th>Duration</th>
              <th>Stats</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {runs?.length ? (
              runs.map((run) => (
                <tr key={run._id}>
                  <td>{run.status}</td>
                  <td>{run.source}</td>
                  <td>{formatDateTime(run.startedAt)}</td>
                  <td>{formatDateTime(run.endedAt)}</td>
                  <td>{formatRunDuration(run.startedAt, run.endedAt)}</td>
                  <td>
                    {run.stats
                      ? `disc ${run.stats.discoveredCount}, ins ${run.stats.insertedCount}, rank ${run.stats.rankedCount}`
                      : '-'}
                  </td>
                  <td>{run.errorMessage ?? '-'}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7}>No runs recorded yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
