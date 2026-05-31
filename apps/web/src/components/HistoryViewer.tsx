import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from 'convex/react';

import { api } from '../../../../convex/_generated/api.js';
import type { Doc, Id } from '../../../../convex/_generated/dataModel.js';
import { formatHumanizedTime } from '../lib/time';
import { formatRunLabel } from '../lib/formatSourceCriteria';
import { formatRunStatusLabel, isRunInProgress, runStatusBadgeClass } from '../lib/formatRunStatus';
import { WorkerQueuePanel } from './WorkerQueuePanel';
import { WorkerSchedulerPanel } from './WorkerSchedulerPanel';

type RunStatus =
  | ''
  | 'queued'
  | 'running'
  | 'scraping'
  | 'ranking'
  | 'succeeded'
  | 'failed'
  | 'cancelled';
type SearchPathFilter = '' | 'ui' | 'url_fallback' | 'search_url' | 'preferences_hub';

const formatRunDuration = (startedAt: number, endedAt?: number): string => {
  if (!endedAt || endedAt <= startedAt) {
    return '-';
  }
  const seconds = Math.round((endedAt - startedAt) / 1000);
  return `${seconds}s`;
};

/** Log JSON keys shown as their own table columns; everything else goes in the Other cell. */
const SHOWN_IN_TABLE_COLUMNS = new Set(['ts', 'level', 'source', 'service', 'phase', 'msg']);

type ParsedLogLine = {
  id: Id<'run_log_lines'>;
  parsed: Record<string, unknown> | null;
  rawLine: string;
};

/**
 * Parses stored JSON log lines for table display; invalid JSON keeps `parsed` null and `rawLine` for fallback.
 */
const parseRunLogLines = (rows: Array<Doc<'run_log_lines'>>): ParsedLogLine[] =>
  rows.map((row) => {
    try {
      const parsed = JSON.parse(row.line) as Record<string, unknown>;
      return { id: row._id, parsed, rawLine: row.line };
    } catch {
      return { id: row._id, parsed: null, rawLine: row.line };
    }
  });

const stringifyLogValue = (value: unknown): string => {
  if (value === undefined || value === null) {
    return '-';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

/**
 * Builds one line per remaining field as `key: value` for the Other column (sorted by key).
 */
const formatLogOtherBlock = (parsed: Record<string, unknown> | null): string => {
  if (!parsed) {
    return '-';
  }
  const keys = Object.keys(parsed)
    .filter((key) => !SHOWN_IN_TABLE_COLUMNS.has(key))
    .sort((a, b) => a.localeCompare(b));
  if (keys.length === 0) {
    return '-';
  }
  return keys.map((key) => `${key}: ${stringifyLogValue(parsed[key])}`).join('\n');
};

const logTimestampCell = (parsed: Record<string, unknown> | null): string => {
  if (!parsed) {
    return '-';
  }
  const ts = parsed.ts;
  return typeof ts === 'string' ? ts : stringifyLogValue(ts);
};

const logLevelCell = (parsed: Record<string, unknown> | null): string => {
  if (!parsed) {
    return 'info';
  }
  const level = parsed.level;
  return typeof level === 'string' ? level : 'info';
};

const logLevelBadgeClass = (level: string): string => {
  const normalized = level.toLowerCase();
  if (normalized === 'debug' || normalized === 'info' || normalized === 'warn' || normalized === 'error') {
    return normalized;
  }
  return 'info';
};

const logSourceCell = (parsed: Record<string, unknown> | null): string =>
  parsed && Object.prototype.hasOwnProperty.call(parsed, 'source')
    ? stringifyLogValue(parsed.source)
    : '-';

const logServiceCell = (parsed: Record<string, unknown> | null): string =>
  parsed && Object.prototype.hasOwnProperty.call(parsed, 'service')
    ? stringifyLogValue(parsed.service)
    : '-';

const logPhaseCell = (parsed: Record<string, unknown> | null): string =>
  parsed && Object.prototype.hasOwnProperty.call(parsed, 'phase')
    ? stringifyLogValue(parsed.phase)
    : '-';

const logMessageCell = (line: ParsedLogLine): string => {
  if (!line.parsed) {
    return line.rawLine;
  }
  if (Object.prototype.hasOwnProperty.call(line.parsed, 'msg')) {
    return stringifyLogValue(line.parsed.msg);
  }
  return '-';
};

/** Known worker log levels for Run log modal filtering. */
type LogLevelChoice = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_CHOICES: LogLevelChoice[] = ['debug', 'info', 'warn', 'error'];

const defaultLogLevelFilter = (): Record<LogLevelChoice, boolean> => ({
  debug: true,
  info: true,
  warn: true,
  error: true,
});

/** Returns a known level, or `null` when the line should always pass the filter (unparseable / unknown level). */
function parsedLogLevelForFilter(parsed: Record<string, unknown> | null): LogLevelChoice | null {
  if (!parsed) {
    return null;
  }
  const level = parsed.level;
  if (typeof level !== 'string') {
    return null;
  }
  const normalized = level.toLowerCase();
  if (
    normalized === 'debug' ||
    normalized === 'info' ||
    normalized === 'warn' ||
    normalized === 'error'
  ) {
    return normalized;
  }
  return null;
}

export function HistoryViewer() {
  const navigate = useNavigate();
  const updateStatus = useMutation(api.runs.updateStatus);
  const requestGracefulStop = useMutation(api.runs.requestGracefulStop);
  const deleteRunWithLogs = useMutation(api.runs.deleteRunWithLogs);
  const clearAllRunsAndLogs = useMutation(api.runs.clearAllRunsAndLogs);

  const [runSourceFilter, setRunSourceFilter] = useState('');
  const [runStatusFilter, setRunStatusFilter] = useState<RunStatus>('');
  const [runSearchPathFilter, setRunSearchPathFilter] = useState<SearchPathFilter>('');
  const [historyMessage, setHistoryMessage] = useState('');
  const [selectedRunId, setSelectedRunId] = useState<Id<'scrape_runs'> | null>(null);
  const [logLevelFilter, setLogLevelFilter] = useState(defaultLogLevelFilter);
  const [actionBusyRunId, setActionBusyRunId] = useState<Id<'scrape_runs'> | null>(null);
  const [isClearingHistory, setIsClearingHistory] = useState(false);

  const runs = useQuery(api.runs.list, {
    source: runSourceFilter.trim() || undefined,
    status: runStatusFilter || undefined,
    limit: 50,
  });
  const schedules = useQuery(api.schedules.list, {});
  const scheduleNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of schedules ?? []) {
      map.set(
        row._id,
        row.name ??
          formatRunLabel({
            source: row.source,
            sourceCriteria: row.sourceCriteria,
            schedule: row.schedule,
          })
      );
    }
    return map;
  }, [schedules]);

  const runSources = useMemo(() => {
    if (!runs) {
      return [];
    }
    return Array.from(new Set(runs.map((run) => run.source))).sort();
  }, [runs]);

  const selectedLogs = useQuery(
    api.runLogs.listByRun,
    selectedRunId ? { runId: selectedRunId, limit: 10_000 } : 'skip'
  );

  const parsedLogLines = useMemo(
    () => (selectedLogs ? parseRunLogLines(selectedLogs) : []),
    [selectedLogs]
  );

  useEffect(() => {
    if (selectedRunId) {
      setLogLevelFilter(defaultLogLevelFilter());
    }
  }, [selectedRunId]);

  const filteredLogLines = useMemo(() => {
    return parsedLogLines.filter((line) => {
      const levelKey = parsedLogLevelForFilter(line.parsed);
      if (levelKey === null) {
        return true;
      }
      return logLevelFilter[levelKey];
    });
  }, [parsedLogLines, logLevelFilter]);

  const visibleRuns = useMemo(() => {
    if (!runs) {
      return [];
    }
    if (!runSearchPathFilter) {
      return runs;
    }
    return runs.filter((run) => {
      const withSearchTelemetry = run as Doc<'scrape_runs'> & {
        linkedinSearchStrategy?: string;
      };
      return withSearchTelemetry.linkedinSearchStrategy === runSearchPathFilter;
    });
  }, [runs, runSearchPathFilter]);

  const onStopRun = async (run: Doc<'scrape_runs'>) => {
    if (!isRunInProgress(run.status)) {
      return;
    }

    const confirmed = window.confirm(
      run.status === 'queued'
        ? 'Cancel this queued run immediately?'
        : 'Request graceful stop? The run will finish the current scrape or ranking phase first.'
    );
    if (!confirmed) {
      return;
    }

    setActionBusyRunId(run._id);
    setHistoryMessage('');
    try {
      if (run.status === 'queued') {
        await updateStatus({
          runId: run._id,
          status: 'cancelled',
          endedAt: Date.now(),
          logsSummary: 'Cancelled from Workers history.',
        });
        setHistoryMessage('Queued run cancelled.');
      } else {
        await requestGracefulStop({ runId: run._id });
        setHistoryMessage('Graceful stop requested. Run will finish current pipeline first.');
      }
    } catch (error) {
      setHistoryMessage(
        error instanceof Error ? `Stop action failed: ${error.message}` : 'Stop action failed.'
      );
    } finally {
      setActionBusyRunId(null);
    }
  };

  const onDeleteRun = async (run: Doc<'scrape_runs'>) => {
    const confirmed = window.confirm('Delete this run and all associated logs?');
    if (!confirmed) {
      return;
    }

    setActionBusyRunId(run._id);
    setHistoryMessage('');
    try {
      const result = await deleteRunWithLogs({ runId: run._id });
      setHistoryMessage(`Deleted run and ${result.deletedLogs} log line(s).`);
      if (selectedRunId === run._id) {
        setSelectedRunId(null);
      }
    } catch (error) {
      setHistoryMessage(
        error instanceof Error ? `Delete failed: ${error.message}` : 'Delete failed.'
      );
    } finally {
      setActionBusyRunId(null);
    }
  };

  const onClearAll = async () => {
    const confirmed = window.confirm('Clear all history rows and logs? This cannot be undone.');
    if (!confirmed) {
      return;
    }

    setIsClearingHistory(true);
    setHistoryMessage('');
    try {
      const result = await clearAllRunsAndLogs({});
      setSelectedRunId(null);
      setHistoryMessage(
        `Cleared ${result.deletedRuns} run(s) and ${result.deletedLogs} log line(s).` +
          (result.hasMore ? ' Additional cleanup is scheduled in the background.' : '')
      );
    } catch (error) {
      setHistoryMessage(
        error instanceof Error ? `Clear all failed: ${error.message}` : 'Clear all failed.'
      );
    } finally {
      setIsClearingHistory(false);
    }
  };

  const linkedinSearchBadge = (run: Doc<'scrape_runs'>): string => {
    const withSearchTelemetry = run as Doc<'scrape_runs'> & {
      usedLinkedinUrlFallback?: boolean;
      linkedinSearchStrategy?: string;
    };
    if (withSearchTelemetry.usedLinkedinUrlFallback) {
      return 'URL fallback used';
    }
    if (withSearchTelemetry.linkedinSearchStrategy === 'ui') {
      return 'UI search';
    }
    if (withSearchTelemetry.linkedinSearchStrategy === 'search_url') {
      return 'Search URL';
    }
    if (withSearchTelemetry.linkedinSearchStrategy === 'preferences_hub') {
      return 'Preferences hub';
    }
    if (withSearchTelemetry.linkedinSearchStrategy === 'url_fallback') {
      return 'URL fallback';
    }
    return '-';
  };

  return (
    <>
      <WorkerSchedulerPanel />
      <WorkerQueuePanel />
      <section className='panel'>
        <div className='panel-heading'>
          <h2>History</h2>
          <div className='queue-actions-cell'>
            <button
              type='button'
              className='btn-danger'
              onClick={() => void onClearAll()}
              disabled={isClearingHistory}
            >
              {isClearingHistory ? 'Clearing…' : 'Clear All'}
            </button>
          </div>
        </div>
        {historyMessage ? <p className='status-text'>{historyMessage}</p> : null}
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
            <option value='running'>Running (legacy)</option>
            <option value='scraping'>Scraping</option>
            <option value='ranking'>Ranking</option>
            <option value='succeeded'>Succeeded</option>
            <option value='failed'>Failed</option>
            <option value='cancelled'>Cancelled</option>
          </select>
          <select
            value={runSearchPathFilter}
            onChange={(event) => setRunSearchPathFilter(event.target.value as SearchPathFilter)}
          >
            <option value=''>All search paths</option>
            <option value='ui'>UI search</option>
            <option value='search_url'>Search URL</option>
            <option value='url_fallback'>URL fallback</option>
            <option value='preferences_hub'>Preferences hub</option>
          </select>
        </div>
        <div className='table-wrapper'>
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Source</th>
                <th>Search path</th>
                <th className='timestamp-cell'>Completed</th>
                <th>Duration</th>
                <th>Stats</th>
                <th>Error</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleRuns.length ? (
                visibleRuns.map((run) => (
                  <tr key={run._id}>
                    <td>
                      <span className={`status-badge status-${runStatusBadgeClass(run)}`}>
                        {formatRunStatusLabel(run)}
                      </span>
                    </td>
                    <td>
                      {run.source}
                      {(run as Doc<'scrape_runs'> & { triggeredBy?: string }).triggeredBy === 'schedule' ? (
                        <div className='history-trigger-chip-wrap'>
                          <span className='status-badge scheduler-timer-off'>
                            scheduled
                            {(run as Doc<'scrape_runs'> & { scheduleId?: Id<'worker_schedules'> }).scheduleId
                              ? `: ${
                                  scheduleNameById.get(
                                    (run as Doc<'scrape_runs'> & { scheduleId?: Id<'worker_schedules'> })
                                      .scheduleId as string
                                  ) ?? 'unknown'
                                }`
                              : ''}
                          </span>
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {linkedinSearchBadge(run) === 'URL fallback used' ? (
                        <span className='status-badge status-running'>{linkedinSearchBadge(run)}</span>
                      ) : (
                        linkedinSearchBadge(run)
                      )}
                    </td>
                    <td className='timestamp-cell'>{formatHumanizedTime(run.endedAt)}</td>
                    <td>{formatRunDuration(run.startedAt, run.endedAt)}</td>
                    <td>
                      {run.stats
                        ? `disc ${run.stats.discoveredCount}, ins ${run.stats.insertedCount}, rank ${run.stats.rankedCount}`
                        : '-'}
                    </td>
                    <td className='history-error-cell'>
                      {run.errorMessage ? (
                        <span className='history-error-cell__text' title={run.errorMessage}>
                          {run.errorMessage}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className='queue-actions-cell'>
                      <button type='button' onClick={() => navigate(`/postings/${run._id}`)}>
                        View Jobs
                      </button>
                      <button type='button' onClick={() => setSelectedRunId(run._id)}>
                        Logs
                      </button>
                      <button
                        type='button'
                        onClick={() => void onStopRun(run)}
                        disabled={
                          actionBusyRunId !== null ||
                          !isRunInProgress(run.status)
                        }
                      >
                        Stop
                      </button>
                      <button
                        type='button'
                        className='btn-danger'
                        onClick={() => void onDeleteRun(run)}
                        disabled={actionBusyRunId !== null}
                      >
                        {actionBusyRunId === run._id ? 'Working…' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8}>No runs recorded yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {selectedRunId ? (
        <div className='modal-overlay' onClick={() => setSelectedRunId(null)} role='presentation'>
          <div className='modal-card modal-wide' onClick={(event) => event.stopPropagation()} role='dialog' aria-modal='true'>
            <div className='modal-header'>
              <h3>Run logs</h3>
              <button type='button' onClick={() => setSelectedRunId(null)}>
                Close
              </button>
            </div>
            <div className='modal-body'>
              {selectedLogs === undefined ? (
                <p>Loading logs…</p>
              ) : parsedLogLines.length === 0 ? (
                <p>No logs stored for this run.</p>
              ) : (
                <>
                  <div className='log-level-filters'>
                    <span className='log-level-filters-label'>Levels:</span>
                    {LOG_LEVEL_CHOICES.map((lvl) => (
                      <label key={lvl} className='log-level-filter-label'>
                        <input
                          type='checkbox'
                          checked={logLevelFilter[lvl]}
                          onChange={() =>
                            setLogLevelFilter((prev) => ({ ...prev, [lvl]: !prev[lvl] }))
                          }
                        />
                        {lvl}
                      </label>
                    ))}
                  </div>
                  {filteredLogLines.length < parsedLogLines.length ? (
                    <p className='status-text'>
                      Showing {filteredLogLines.length} of {parsedLogLines.length} lines
                    </p>
                  ) : null}
                  <div className='table-wrapper'>
                    <table className='log-viewer-table'>
                      <thead>
                        <tr>
                          <th className='col-log-ts'>Timestamp</th>
                          <th className='col-log-level'>Level</th>
                          <th className='col-log-source'>Source</th>
                          <th className='col-log-service'>Service</th>
                          <th className='col-log-phase'>Phase</th>
                          <th className='col-log-message'>Message</th>
                          <th className='col-log-other'>Other</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredLogLines.map((line) => {
                          const level = logLevelCell(line.parsed);
                          const ts = logTimestampCell(line.parsed);
                          return (
                            <tr key={line.id}>
                              <td className='col-log-ts' title={ts}>
                                {ts}
                              </td>
                              <td className='col-log-level'>
                                <span className={`status-badge log-level-${logLevelBadgeClass(level)}`}>
                                  {level}
                                </span>
                              </td>
                              <td className='col-log-source' title={logSourceCell(line.parsed)}>
                                {logSourceCell(line.parsed)}
                              </td>
                              <td className='col-log-service' title={logServiceCell(line.parsed)}>
                                {logServiceCell(line.parsed)}
                              </td>
                              <td className='col-log-phase' title={logPhaseCell(line.parsed)}>
                                {logPhaseCell(line.parsed)}
                              </td>
                              <td className='col-log-message'>{logMessageCell(line)}</td>
                              <td className='col-log-other'>
                                <div className='log-other-block'>{formatLogOtherBlock(line.parsed)}</div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <details>
                    <summary>Raw JSON</summary>
                    <pre className='run-log-dump'>{parsedLogLines.map((row) => row.rawLine).join('\n')}</pre>
                  </details>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
