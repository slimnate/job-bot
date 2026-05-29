import { useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';

import { api } from '../../../../convex/_generated/api.js';
import type { Doc, Id } from '../../../../convex/_generated/dataModel.js';
import { formatRunLabel } from '../lib/formatSourceCriteria.js';
import { formatHumanizedTime } from '../lib/time.js';
import { useWorkerTriggerUrl } from '../hooks/useWorkerTriggerUrl.js';
import { PlusIcon } from './PlusIcon.js';
import { WorkerRunDialog, type WorkerRunDialogTarget } from './WorkerRunDialog.js';

type ScheduleRow = Doc<'worker_schedules'>;
type QueuedRun = Doc<'scrape_runs'>;

type SourceRow = {
  source: string;
  displayName: string;
  isEnabled: boolean;
};

/** A merged table row: either a recurring schedule definition or a queued one-time run. */
type TableItem =
  | { kind: 'schedule'; row: ScheduleRow }
  | { kind: 'run'; row: QueuedRun };

/**
 * Unified worker queue + schedules panel.
 *
 * Shows recurring schedule definitions (`worker_schedules`) and pending one-time
 * runs (`scrape_runs` with status `queued`) in a single table, and opens one
 * dialog for creating/editing either kind. One-time runs are ephemeral: they
 * exist only as queued runs, never as schedule rows.
 */
export function WorkerQueuePanel() {
  const schedules = (useQuery(api.schedules.list, {}) ?? []) as ScheduleRow[];
  const queuedRuns = useQuery(api.runs.list, { status: 'queued', limit: 100 }) as
    | QueuedRun[]
    | undefined;
  const sources = (useQuery(api.sources.list, {}) ?? []) as SourceRow[];
  const evaluators = useQuery(api.evaluators.list, { limit: 100 }) ?? [];

  const runNow = useMutation(api.schedules.runNow);
  const setEnabled = useMutation(api.schedules.setEnabled);
  const removeSchedule = useMutation(api.schedules.remove);
  const bumpQueued = useMutation(api.runs.bumpQueued);
  const updateStatus = useMutation(api.runs.updateStatus);

  const workerTriggerUrl = useWorkerTriggerUrl();

  const [message, setMessage] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTarget, setDialogTarget] = useState<WorkerRunDialogTarget>(null);

  const displayNameBySource = useMemo(
    () => new Map(sources.map((row) => [row.source, row.displayName])),
    [sources]
  );
  const evaluatorNameById = useMemo(
    () => new Map(evaluators.map((row) => [row._id, row.name])),
    [evaluators]
  );

  const items = useMemo<TableItem[]>(() => {
    const scheduleItems: TableItem[] = schedules.map((row) => ({ kind: 'schedule', row }));
    const runItems: TableItem[] = [...(queuedRuns ?? [])]
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((row) => ({ kind: 'run', row }));
    return [...scheduleItems, ...runItems];
  }, [schedules, queuedRuns]);

  const openCreate = () => {
    setDialogTarget(null);
    setDialogOpen(true);
  };

  const openEdit = (target: WorkerRunDialogTarget) => {
    setDialogTarget(target);
    setDialogOpen(true);
  };

  const wakeWorker = async (): Promise<boolean> => {
    if (!workerTriggerUrl) {
      return false;
    }
    try {
      const res = await fetch(workerTriggerUrl, { method: 'POST' });
      return res.ok;
    } catch {
      return false;
    }
  };

  const onRunScheduleNow = async (id: Id<'worker_schedules'>) => {
    setBusyKey(id);
    setMessage('');
    try {
      await runNow({ id });
      setMessage('Scheduled run queued.');
    } catch (error) {
      setMessage(error instanceof Error ? `Run now failed: ${error.message}` : 'Run now failed.');
    } finally {
      setBusyKey(null);
    }
  };

  const onToggleEnabled = async (row: ScheduleRow) => {
    setBusyKey(row._id);
    try {
      await setEnabled({ id: row._id, isEnabled: !row.isEnabled });
    } finally {
      setBusyKey(null);
    }
  };

  const onDeleteSchedule = async (id: Id<'worker_schedules'>) => {
    if (!window.confirm('Delete this schedule?')) {
      return;
    }
    setBusyKey(id);
    try {
      await removeSchedule({ id });
      setMessage('Schedule deleted.');
    } finally {
      setBusyKey(null);
    }
  };

  const onTriggerRunNow = async (id: Id<'scrape_runs'>) => {
    setBusyKey(id);
    setMessage('');
    try {
      await bumpQueued({ runId: id });
      const ok = await wakeWorker();
      setMessage(
        ok
          ? 'Worker notified — this run should start shortly.'
          : 'Run prioritized; could not reach worker HTTP trigger (set WORKER_HTTP_TRIGGER_PORT and ensure the worker is running).'
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? `Trigger now failed: ${error.message}` : 'Trigger now failed.'
      );
    } finally {
      setBusyKey(null);
    }
  };

  const onRemoveRun = async (id: Id<'scrape_runs'>) => {
    if (!window.confirm('Remove this run from the queue?')) {
      return;
    }
    setBusyKey(id);
    setMessage('');
    try {
      await updateStatus({ runId: id, status: 'cancelled', endedAt: Date.now() });
      setMessage('Run removed from queue.');
    } catch (error) {
      setMessage(error instanceof Error ? `Remove failed: ${error.message}` : 'Remove failed.');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section className='panel'>
      <div className='panel-heading'>
        <h2>Worker queue &amp; schedules</h2>
        <div className='queue-add-actions'>
          <button type='button' className='btn-with-icon' onClick={openCreate}>
            <PlusIcon />
            Add run
          </button>
        </div>
      </div>
      <p className='panel-subtitle tight'>
        Queue a one-time run or define a recurring schedule. One-time runs are processed by the
        worker and appear here until claimed; recurring schedules enqueue runs on a timer.
      </p>
      {message ? <p className='status-text'>{message}</p> : null}

      <WorkerRunDialog
        open={dialogOpen}
        target={dialogTarget}
        onClose={() => setDialogOpen(false)}
        onSaved={(text) => setMessage(text)}
      />

      <div className='table-wrapper'>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Evaluator</th>
              <th>Next / queued</th>
              <th>Last run</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {queuedRuns === undefined ? (
              <tr>
                <td colSpan={7}>Loading…</td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7}>No schedules or queued runs yet. Use &quot;Add run&quot; above.</td>
              </tr>
            ) : (
              items.map((item) => {
                if (item.kind === 'schedule') {
                  const row = item.row;
                  const label = formatRunLabel({
                    source: row.source,
                    displayName: displayNameBySource.get(row.source),
                    sourceCriteria: row.sourceCriteria,
                    schedule: row.schedule,
                  });
                  return (
                    <tr key={`s-${row._id}`}>
                      <td>{label}</td>
                      <td>Recurring</td>
                      <td>{row.evaluatorId ? evaluatorNameById.get(row.evaluatorId) ?? '—' : '—'}</td>
                      <td className='timestamp-cell'>{formatHumanizedTime(row.nextRunAt)}</td>
                      <td className='timestamp-cell'>{formatHumanizedTime(row.lastTriggeredAt)}</td>
                      <td>
                        <span
                          className={`status-badge ${row.isEnabled ? 'status-succeeded' : 'scheduler-timer-off'}`}
                        >
                          {row.isEnabled ? 'enabled' : 'disabled'}
                        </span>
                      </td>
                      <td className='queue-actions-cell'>
                        <button
                          type='button'
                          onClick={() => void onRunScheduleNow(row._id)}
                          disabled={busyKey !== null}
                        >
                          Run now
                        </button>
                        <button
                          type='button'
                          onClick={() => openEdit({ type: 'schedule', row })}
                          disabled={busyKey !== null}
                        >
                          Edit
                        </button>
                        <button
                          type='button'
                          onClick={() => void onToggleEnabled(row)}
                          disabled={busyKey !== null}
                        >
                          {row.isEnabled ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          type='button'
                          className='btn-danger'
                          onClick={() => void onDeleteSchedule(row._id)}
                          disabled={busyKey !== null}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                }

                const row = item.row;
                const label = formatRunLabel({
                  source: row.source,
                  displayName: displayNameBySource.get(row.source),
                  sourceCriteria: row.sourceCriteria,
                  schedule: { kind: 'once' },
                });
                return (
                  <tr key={`r-${row._id}`}>
                    <td>{label}</td>
                    <td>One-time</td>
                    <td>{row.evaluatorId ? evaluatorNameById.get(row.evaluatorId) ?? '—' : '—'}</td>
                    <td className='timestamp-cell'>{formatHumanizedTime(row.createdAt)}</td>
                    <td className='timestamp-cell'>—</td>
                    <td>
                      <span className='status-badge'>queued</span>
                    </td>
                    <td className='queue-actions-cell'>
                      <button
                        type='button'
                        onClick={() => void onTriggerRunNow(row._id)}
                        disabled={busyKey !== null}
                      >
                        Trigger now
                      </button>
                      <button
                        type='button'
                        onClick={() => openEdit({ type: 'run', row })}
                        disabled={busyKey !== null}
                      >
                        Edit
                      </button>
                      <button
                        type='button'
                        className='btn-danger'
                        onClick={() => void onRemoveRun(row._id)}
                        disabled={busyKey !== null}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
