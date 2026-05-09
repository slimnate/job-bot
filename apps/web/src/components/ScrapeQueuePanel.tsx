import { useMutation, useQuery } from 'convex/react';
import { useEffect, useMemo, useState } from 'react';

import { api } from '../../../../convex/_generated/api.js';
import type { Doc, Id } from '../../../../convex/_generated/dataModel.js';

const formatDateTime = (timestamp: number): string => new Date(timestamp).toLocaleString();

type QueuedRun = Doc<'scrape_runs'>;

type SourceRow = {
  source: string;
  displayName: string;
  acceptedCriteriaFields: string[];
  isEnabled: boolean;
  defaultEvaluatorId?: Id<'job_evaluators'>;
};

type SourcePresetRow = Doc<'source_presets'>;

export function ScrapeQueuePanel() {
  const evaluatorList = useQuery(api.evaluators.list, { limit: 50 });
  const sourceRows = (useQuery(api.sources.list) ?? []) as SourceRow[];
  const queuedRuns = useQuery(api.runs.list, { status: 'queued', limit: 100 });
  const enabledSources = useMemo(
    () => sourceRows.filter((row) => row.isEnabled),
    [sourceRows]
  );

  const [newSource, setNewSource] = useState('linkedin');
  const sourcePresets = useQuery(
    api.sourcePresets.listBySource,
    newSource ? ({ source: newSource as 'linkedin' }) : 'skip'
  ) as SourcePresetRow[] | undefined;
  const triggerRun = useMutation(api.runs.trigger);
  const bumpQueued = useMutation(api.runs.bumpQueued);
  const updateQueued = useMutation(api.runs.updateQueued);
  const updateStatus = useMutation(api.runs.updateStatus);

  const [newEvaluatorId, setNewEvaluatorId] = useState('');
  const [newPresetId, setNewPresetId] = useState('');
  const [newSourceCriteria, setNewSourceCriteria] = useState<Record<string, string>>({});
  const [queueMessage, setQueueMessage] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [triggeringRunId, setTriggeringRunId] = useState<Id<'scrape_runs'> | null>(null);

  const workerTriggerUrl =
    (import.meta.env.VITE_WORKER_TRIGGER_URL as string | undefined) ??
    'http://127.0.0.1:3999/trigger';

  const [editingId, setEditingId] = useState<Id<'scrape_runs'> | null>(null);
  const [editSource, setEditSource] = useState('');
  const [editSourceCriteria, setEditSourceCriteria] = useState<Record<string, string>>({});
  const [editEvaluatorId, setEditEvaluatorId] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const activeEvaluators = useMemo(
    () => (evaluatorList ?? []).filter((row) => row.isActive),
    [evaluatorList]
  );

  const evaluatorNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of evaluatorList ?? []) {
      map.set(row._id, row.name);
    }
    return map;
  }, [evaluatorList]);

  /**
   * Queued rows may still reference a profile that was turned off later; the edit dropdown only lists available (Active) evaluators.
   */
  useEffect(() => {
    if (!editingId || evaluatorList === undefined || editEvaluatorId === '') {
      return;
    }
    const row = evaluatorList.find((r) => r._id === editEvaluatorId);
    if (!row || !row.isActive) {
      setEditEvaluatorId('');
    }
  }, [editingId, evaluatorList, editEvaluatorId]);

  const sortedQueued = useMemo(() => {
    if (!queuedRuns) {
      return [];
    }
    return [...queuedRuns].sort((a, b) => a.startedAt - b.startedAt);
  }, [queuedRuns]);

  const sourceByKey = useMemo(() => new Map(sourceRows.map((row) => [row.source, row])), [sourceRows]);
  const newSourceFields = sourceByKey.get(newSource)?.acceptedCriteriaFields ?? [];
  const editSourceFields = sourceByKey.get(editSource)?.acceptedCriteriaFields ?? [];

  const resetEdit = () => {
    setEditingId(null);
    setEditSource('');
    setEditSourceCriteria({});
    setEditEvaluatorId('');
  };

  const startEdit = (run: QueuedRun) => {
    setEditingId(run._id);
    setEditSource(run.source.trim());
    setEditSourceCriteria(run.sourceCriteria ?? {});
    const eid = run.evaluatorId ?? '';
    if (!eid || evaluatorList === undefined) {
      setEditEvaluatorId(eid);
      return;
    }
    const row = evaluatorList.find((r) => r._id === eid);
    setEditEvaluatorId(row?.isActive ? eid : '');
  };

  const onAddToQueue = async () => {
    const source = newSource.trim();
    if (!source) {
      setQueueMessage('Enter a source label for the new run.');
      return;
    }

    setIsAdding(true);
    setQueueMessage('');
    try {
      const result = await triggerRun({
        evaluatorId: newEvaluatorId === '' ? undefined : (newEvaluatorId as Id<'job_evaluators'>),
        source,
        sourceCriteria: newSourceCriteria,
      });
      setQueueMessage(`Queued ${result.runIds.length} run(s).`);
    } catch (error) {
      setQueueMessage(
        error instanceof Error ? `Could not queue: ${error.message}` : 'Could not queue run.'
      );
    } finally {
      setIsAdding(false);
    }
  };

  const onSaveEdit = async () => {
    if (!editingId) {
      return;
    }
    const trimmed = editSource.trim();
    if (!trimmed) {
      setQueueMessage('Source cannot be empty.');
      return;
    }

    setIsSavingEdit(true);
    setQueueMessage('');
    try {
      await updateQueued({
        runId: editingId,
        source: trimmed,
        evaluatorId: editEvaluatorId === '' ? null : (editEvaluatorId as Id<'job_evaluators'>),
        sourceCriteria: editSourceCriteria,
      });
      resetEdit();
      setQueueMessage('Queue entry updated.');
    } catch (error) {
      setQueueMessage(
        error instanceof Error ? `Update failed: ${error.message}` : 'Update failed.'
      );
    } finally {
      setIsSavingEdit(false);
    }
  };

  const wakeWorkerScheduler = async (): Promise<boolean> => {
    try {
      const res = await fetch(workerTriggerUrl, { method: 'POST' });
      return res.ok;
    } catch {
      return false;
    }
  };

  const onTriggerNow = async (runId: Id<'scrape_runs'>) => {
    setQueueMessage('');
    setTriggeringRunId(runId);
    try {
      await bumpQueued({ runId });
      const ok = await wakeWorkerScheduler();
      setQueueMessage(
        ok
          ? 'Worker notified — this run should start shortly.'
          : 'Run prioritized; could not reach worker HTTP trigger (set WORKER_HTTP_TRIGGER_PORT and ensure the worker is running).'
      );
    } catch (error) {
      setQueueMessage(
        error instanceof Error ? `Trigger now failed: ${error.message}` : 'Trigger now failed.'
      );
    } finally {
      setTriggeringRunId(null);
    }
  };

  const onRemove = async (runId: Id<'scrape_runs'>) => {
    const confirmed = window.confirm('Remove this run from the queue?');
    if (!confirmed) {
      return;
    }
    setQueueMessage('');
    try {
      const endedAt = Date.now();
      await updateStatus({
        runId,
        status: 'cancelled',
        endedAt,
      });
      if (editingId === runId) {
        resetEdit();
      }
      setQueueMessage('Run removed from queue.');
    } catch (error) {
      setQueueMessage(
        error instanceof Error ? `Remove failed: ${error.message}` : 'Remove failed.'
      );
    }
  };

  return (
    <section className='panel'>
      <div className='panel-heading'>
        <h2>Queue</h2>
      </div>
      <p className='panel-subtitle tight'>
        Queued runs are processed by the worker (pending runs not yet claimed appear here). Add a
        source per run, configure source search criteria, optionally pick an <strong>available</strong> evaluator (Active on in Evaluators), or edit / cancel
        before execution. If you leave evaluator unset, ranking uses this source&apos;s default (Sources page),
        then <code>WORKER_DEFAULT_EVALUATOR_ID</code> on the worker.
      </p>

      {queueMessage ? <p className='status-text'>{queueMessage}</p> : null}

      <div className='queue-add-section'>
        <div className='queue-add-row'>
          <label>
            Source
            <select
              value={newSource}
              onChange={(event) => {
                const sourceKey = event.target.value;
                setNewSource(sourceKey);
                setNewPresetId('');
                const fields = sourceByKey.get(sourceKey)?.acceptedCriteriaFields ?? [];
                const next: Record<string, string> = {};
                for (const field of fields) {
                  next[field] = '';
                }
                setNewSourceCriteria(next);
              }}
              aria-label='Source for new queue entry'
            >
              {enabledSources.map((value) => (
                <option key={value.source} value={value.source}>
                  {value.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Evaluator (optional)
            <select value={newEvaluatorId} onChange={(event) => setNewEvaluatorId(event.target.value)}>
              <option value=''>Source / worker default</option>
              {activeEvaluators.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className='queue-add-actions'>
            <button type='button' onClick={onAddToQueue} disabled={isAdding}>
              {isAdding ? 'Adding…' : 'Add to queue'}
            </button>
          </div>
        </div>
        <label>
          Preset (optional)
          <select
            value={newPresetId}
            onChange={(event) => {
              const presetId = event.target.value;
              setNewPresetId(presetId);
              const preset = (sourcePresets ?? []).find((row) => row._id === presetId);
              if (!preset) {
                return;
              }
              const next: Record<string, string> = {};
              for (const field of newSourceFields) {
                next[field] = preset.sourceCriteria[field] ?? '';
              }
              setNewSourceCriteria(next);
            }}
          >
            <option value=''>No preset</option>
            {(sourcePresets ?? []).map((preset) => (
              <option key={preset._id} value={preset._id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
        <div className='queue-add-linkedin'>
          {newSourceFields.map((field) => (
            <label key={field}>
              {field}
              <input
                value={newSourceCriteria[field] ?? ''}
                onChange={(event) =>
                  setNewSourceCriteria((prev) => ({ ...prev, [field]: event.target.value }))
                }
                placeholder={`Enter ${field}`}
              />
            </label>
          ))}
        </div>
      </div>

      <div className='table-wrapper'>
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Search criteria</th>
              <th>Evaluator</th>
              <th>Queued at</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {queuedRuns === undefined ? (
              <tr>
                <td colSpan={5}>Loading queue…</td>
              </tr>
            ) : sortedQueued.length === 0 ? (
              <tr>
                <td colSpan={5}>No queued runs. Add one above or use &quot;Trigger run&quot; below.</td>
              </tr>
            ) : (
              sortedQueued.map((run) => {
                const runEvaluator = evaluatorList?.find((r) => r._id === run.evaluatorId);
                return editingId === run._id ? (
                  <tr key={run._id}>
                    <td>
                      <select
                        value={editSource}
                        onChange={(event) => {
                          const sourceKey = event.target.value;
                          setEditSource(sourceKey);
                          const fields = sourceByKey.get(sourceKey)?.acceptedCriteriaFields ?? [];
                          const next: Record<string, string> = {};
                          for (const field of fields) {
                            next[field] = editSourceCriteria[field] ?? '';
                          }
                          setEditSourceCriteria(next);
                        }}
                        aria-label='Edit source'
                      >
                        {enabledSources.map((value) => (
                          <option key={value.source} value={value.source}>
                            {value.displayName}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {editSourceFields.length === 0 ? (
                        '—'
                      ) : (
                        <div className='queue-add-linkedin'>
                          {editSourceFields.map((field) => (
                            <input
                              key={field}
                              value={editSourceCriteria[field] ?? ''}
                              onChange={(event) =>
                                setEditSourceCriteria((prev) => ({ ...prev, [field]: event.target.value }))
                              }
                              aria-label={`Edit ${field}`}
                              placeholder={field}
                            />
                          ))}
                        </div>
                      )}
                    </td>
                    <td>
                      <select
                        value={editEvaluatorId}
                        onChange={(event) => setEditEvaluatorId(event.target.value)}
                        aria-label='Edit evaluator'
                      >
                        <option value=''>Source / worker default</option>
                        {activeEvaluators.map((c) => (
                          <option key={c._id} value={c._id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{formatDateTime(run.createdAt)}</td>
                    <td className='queue-actions-cell'>
                      <button
                        type='button'
                        onClick={onSaveEdit}
                        disabled={isSavingEdit}
                      >
                        {isSavingEdit ? 'Saving…' : 'Save'}
                      </button>
                      <button type='button' onClick={resetEdit} disabled={isSavingEdit}>
                        Cancel
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={run._id}>
                    <td>{run.source}</td>
                    <td>
                      {Object.entries(run.sourceCriteria ?? {}).length === 0
                        ? '—'
                        : Object.entries(run.sourceCriteria ?? {})
                            .map(([key, value]) => `${key}: ${value}`)
                            .join(' | ')}
                    </td>
                    <td>
                      {run.evaluatorId ? (
                        <>
                          {evaluatorNameById.get(run.evaluatorId) ?? run.evaluatorId}
                          {runEvaluator && !runEvaluator.isActive ? (
                            <span className='panel-subtitle tight'> (unavailable)</span>
                          ) : null}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{formatDateTime(run.createdAt)}</td>
                    <td className='queue-actions-cell'>
                      <button
                        type='button'
                        onClick={() => void onTriggerNow(run._id)}
                        disabled={triggeringRunId !== null}
                      >
                        {triggeringRunId === run._id ? 'Triggering…' : 'Trigger now'}
                      </button>
                      <button type='button' onClick={() => startEdit(run)}>
                        Edit
                      </button>
                      <button type='button' onClick={() => onRemove(run._id)}>
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
