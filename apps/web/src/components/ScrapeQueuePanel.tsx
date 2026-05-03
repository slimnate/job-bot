import { useMutation, useQuery } from 'convex/react';
import { useMemo, useState } from 'react';

import { api } from '../../../../convex/_generated/api.js';
import type { Doc, Id } from '../../../../convex/_generated/dataModel.js';

const formatDateTime = (timestamp: number): string => new Date(timestamp).toLocaleString();

type QueuedRun = Doc<'scrape_runs'>;

export function ScrapeQueuePanel() {
  const criteriaList = useQuery(api.criteria.list, { limit: 50 });
  const queuedRuns = useQuery(api.runs.list, { status: 'queued', limit: 100 });

  const triggerRun = useMutation(api.runs.trigger);
  const updateQueued = useMutation(api.runs.updateQueued);
  const updateStatus = useMutation(api.runs.updateStatus);

  const [newSource, setNewSource] = useState('manual');
  const [newCriteriaId, setNewCriteriaId] = useState('');
  const [queueMessage, setQueueMessage] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const [editingId, setEditingId] = useState<Id<'scrape_runs'> | null>(null);
  const [editSource, setEditSource] = useState('');
  const [editCriteriaId, setEditCriteriaId] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const criteriaNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of criteriaList ?? []) {
      map.set(row._id, row.name);
    }
    return map;
  }, [criteriaList]);

  const sortedQueued = useMemo(() => {
    if (!queuedRuns) {
      return [];
    }
    return [...queuedRuns].sort((a, b) => a.startedAt - b.startedAt);
  }, [queuedRuns]);

  const resetEdit = () => {
    setEditingId(null);
    setEditSource('');
    setEditCriteriaId('');
  };

  const startEdit = (run: QueuedRun) => {
    setEditingId(run._id);
    setEditSource(run.source);
    setEditCriteriaId(run.criteriaId ?? '');
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
      const criteriaId =
        newCriteriaId === '' ? undefined : (newCriteriaId as Id<'job_criteria'>);
      const result = await triggerRun({
        criteriaId,
        source,
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
        criteriaId:
          editCriteriaId === '' ? null : (editCriteriaId as Id<'job_criteria'>),
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
        <h2>Scrape queue</h2>
      </div>
      <p className='panel-subtitle tight'>
        Queued runs are processed by the worker (pending runs not yet claimed appear here). Add a
        source label per run, optionally tie it to criteria, or edit / cancel before execution.
      </p>

      {queueMessage ? <p className='status-text'>{queueMessage}</p> : null}

      <div className='queue-add-row'>
        <label>
          Source
          <input
            value={newSource}
            onChange={(event) => setNewSource(event.target.value)}
            placeholder='e.g. manual, greenhouse, lever'
          />
        </label>
        <label>
          Criteria (optional)
          <select value={newCriteriaId} onChange={(event) => setNewCriteriaId(event.target.value)}>
            <option value=''>Use active criteria</option>
            {(criteriaList ?? []).map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
                {c.isActive ? ' (active)' : ''}
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

      <div className='table-wrapper'>
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Criteria</th>
              <th>Queued at</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {queuedRuns === undefined ? (
              <tr>
                <td colSpan={4}>Loading queue…</td>
              </tr>
            ) : sortedQueued.length === 0 ? (
              <tr>
                <td colSpan={4}>No queued runs. Add one above or use &quot;Trigger run&quot; below.</td>
              </tr>
            ) : (
              sortedQueued.map((run) =>
                editingId === run._id ? (
                  <tr key={run._id}>
                    <td>
                      <input
                        value={editSource}
                        onChange={(event) => setEditSource(event.target.value)}
                        aria-label='Edit source'
                      />
                    </td>
                    <td>
                      <select
                        value={editCriteriaId}
                        onChange={(event) => setEditCriteriaId(event.target.value)}
                        aria-label='Edit criteria'
                      >
                        <option value=''>None (use active at run time)</option>
                        {(criteriaList ?? []).map((c) => (
                          <option key={c._id} value={c._id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{formatDateTime(run.startedAt)}</td>
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
                      {run.criteriaId
                        ? (criteriaNameById.get(run.criteriaId) ?? run.criteriaId)
                        : '—'}
                    </td>
                    <td>{formatDateTime(run.startedAt)}</td>
                    <td className='queue-actions-cell'>
                      <button type='button' onClick={() => startEdit(run)}>
                        Edit
                      </button>
                      <button type='button' onClick={() => onRemove(run._id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                )
              )
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
