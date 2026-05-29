import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';

import { api } from '../../../../convex/_generated/api.js';
import type { Doc, Id } from '../../../../convex/_generated/dataModel.js';
import { SourceCriteriaFields, type CriteriaFieldMeta } from './SourceCriteriaFields.js';

type SourceRow = {
  source: string;
  displayName: string;
  acceptedCriteriaFields: string[];
  criteriaFieldMeta?: Record<string, CriteriaFieldMeta>;
  isEnabled: boolean;
  defaultEvaluatorId?: Id<'job_evaluators'>;
};

/**
 * Label for the empty evaluator option: shows which profile the source uses by default.
 */
function formatSourceDefaultEvaluatorLabel(
  sourceRow: SourceRow | undefined,
  evaluatorNameById: Map<string, string>
): string {
  const defaultId = sourceRow?.defaultEvaluatorId;
  if (!defaultId) {
    return 'Source default (none)';
  }
  const name = evaluatorNameById.get(defaultId);
  return `Source default (${name ?? 'unknown'})`;
}

/**
 * What the dialog is editing, if anything:
 * - `null`: creating a new run/schedule
 * - `schedule`: editing an existing recurring `worker_schedules` row
 * - `run`: editing an existing queued one-time `scrape_runs` row
 */
export type WorkerRunDialogTarget =
  | { type: 'schedule'; row: Doc<'worker_schedules'> }
  | { type: 'run'; row: Doc<'scrape_runs'> }
  | null;

type RunMode = 'once' | 'recurring';
type ScheduleKind = 'daily' | 'interval';

const timezoneDefault = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

type WorkerRunDialogProps = {
  open: boolean;
  target: WorkerRunDialogTarget;
  onClose: () => void;
  onSaved: (message: string) => void;
};

/**
 * Unified create/edit dialog for worker runs. A One-time / Recurring toggle
 * controls whether the submit enqueues an immediate run (`schedules.create`
 * with `kind: 'once'`) or persists a recurring schedule. When editing, the
 * toggle is locked to the target's kind.
 */
export function WorkerRunDialog({ open, target, onClose, onSaved }: WorkerRunDialogProps) {
  const sources = (useQuery(api.sources.list, {}) ?? []) as SourceRow[];
  const evaluators = useQuery(api.evaluators.list, { limit: 100 }) ?? [];

  const createRun = useMutation(api.schedules.create);
  const updateSchedule = useMutation(api.schedules.update);
  const updateQueued = useMutation(api.runs.updateQueued);

  const [mode, setMode] = useState<RunMode>('once');
  const [source, setSource] = useState('linkedin');
  const [evaluatorId, setEvaluatorId] = useState('');
  const [sourcePresetId, setSourcePresetId] = useState('');
  const [sourceCriteria, setSourceCriteria] = useState<Record<string, string>>({});
  const [enableRanking, setEnableRanking] = useState(true);
  const [scheduleKind, setScheduleKind] = useState<ScheduleKind>('daily');
  const [timeOfDay, setTimeOfDay] = useState('09:00');
  const [timezone, setTimezone] = useState(timezoneDefault);
  const [intervalHours, setIntervalHours] = useState('24');
  const [isEnabled, setIsEnabled] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const enabledSources = useMemo(() => sources.filter((row) => row.isEnabled), [sources]);
  const activeEvaluators = useMemo(() => evaluators.filter((row) => row.isActive), [evaluators]);
  const evaluatorNameById = useMemo(
    () => new Map(evaluators.map((row) => [row._id, row.name])),
    [evaluators]
  );
  const sourceByKey = useMemo(() => new Map(sources.map((row) => [row.source, row])), [sources]);
  const selectedSource = sourceByKey.get(source);
  const sourceDefaultEvaluatorLabel = useMemo(
    () => formatSourceDefaultEvaluatorLabel(selectedSource, evaluatorNameById),
    [selectedSource, evaluatorNameById]
  );
  const sourceFields = selectedSource?.acceptedCriteriaFields ?? [];
  const sourceFieldMeta = selectedSource?.criteriaFieldMeta;

  const sourcePresets = useQuery(
    api.sourcePresets.listBySource,
    open && source ? { source } : 'skip'
  ) as Array<Doc<'source_presets'>> | undefined;

  // Whether the toggle is locked (editing always keeps its original kind).
  const isEditing = target !== null;

  // Populate the form whenever the dialog opens or its target changes.
  useEffect(() => {
    if (!open) {
      return;
    }
    setError('');
    setIsSaving(false);

    const shapeCriteria = (sourceKey: string, values: Record<string, string> | undefined) => {
      const fields = sourceByKey.get(sourceKey)?.acceptedCriteriaFields ?? [];
      const next: Record<string, string> = {};
      for (const field of fields) {
        next[field] = values?.[field] ?? '';
      }
      return next;
    };

    if (target?.type === 'schedule') {
      const row = target.row;
      setMode('recurring');
      setSource(row.source);
      setEvaluatorId(row.evaluatorId ?? '');
      setSourcePresetId(row.sourcePresetId ?? '');
      setSourceCriteria(shapeCriteria(row.source, row.sourceCriteria));
      setEnableRanking(row.enableRanking);
      setIsEnabled(row.isEnabled);
      if (row.schedule.kind === 'daily') {
        setScheduleKind('daily');
        setTimeOfDay(row.schedule.timeOfDay);
        setTimezone(row.schedule.timezone);
      } else {
        setScheduleKind('interval');
        setIntervalHours(String(row.schedule.intervalHours));
      }
      return;
    }

    if (target?.type === 'run') {
      const row = target.row;
      setMode('once');
      setSource(row.source);
      setEvaluatorId(row.evaluatorId ?? '');
      setSourcePresetId('');
      setSourceCriteria(shapeCriteria(row.source, row.sourceCriteria));
      setEnableRanking(row.enableRanking ?? true);
      return;
    }

    // Fresh create.
    setMode('once');
    setSource('linkedin');
    setEvaluatorId('');
    setSourcePresetId('');
    setSourceCriteria(shapeCriteria('linkedin', undefined));
    setEnableRanking(true);
    setScheduleKind('daily');
    setTimeOfDay('09:00');
    setTimezone(timezoneDefault);
    setIntervalHours('24');
    setIsEnabled(true);
    // sourceByKey changes as sources load; intentionally re-run to shape criteria.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target, sources.length]);

  const onSourceChange = (nextSource: string) => {
    setSource(nextSource);
    setSourcePresetId('');
    const fields = sourceByKey.get(nextSource)?.acceptedCriteriaFields ?? [];
    const next: Record<string, string> = {};
    for (const field of fields) {
      next[field] = '';
    }
    setSourceCriteria(next);
  };

  const onPresetChange = (presetId: string) => {
    setSourcePresetId(presetId);
    const preset = (sourcePresets ?? []).find((row) => row._id === presetId);
    // "No preset" (or an unknown id) clears every source-dependent criteria field.
    const next: Record<string, string> = {};
    for (const field of sourceFields) {
      next[field] = preset?.sourceCriteria[field] ?? '';
    }
    setSourceCriteria(next);
  };

  const buildScheduleInput = () =>
    scheduleKind === 'daily'
      ? { kind: 'daily' as const, timeOfDay, timezone }
      : { kind: 'interval' as const, intervalHours: Number(intervalHours) };

  const onSubmit = async () => {
    setIsSaving(true);
    setError('');
    try {
      if (target?.type === 'run') {
        await updateQueued({
          runId: target.row._id,
          source,
          evaluatorId: evaluatorId ? (evaluatorId as Id<'job_evaluators'>) : null,
          sourceCriteria,
          enableRanking,
        });
        onSaved('Queue entry updated.');
      } else if (target?.type === 'schedule') {
        await updateSchedule({
          id: target.row._id,
          source,
          sourcePresetId: sourcePresetId ? (sourcePresetId as Id<'source_presets'>) : null,
          sourceCriteria,
          evaluatorId: evaluatorId ? (evaluatorId as Id<'job_evaluators'>) : null,
          enableRanking,
          schedule: buildScheduleInput(),
          isEnabled,
        });
        onSaved('Schedule updated.');
      } else if (mode === 'once') {
        await createRun({
          source,
          sourcePresetId: sourcePresetId ? (sourcePresetId as Id<'source_presets'>) : undefined,
          sourceCriteria,
          evaluatorId: evaluatorId ? (evaluatorId as Id<'job_evaluators'>) : undefined,
          enableRanking,
          schedule: { kind: 'once' },
        });
        onSaved('Run queued.');
      } else {
        await createRun({
          source,
          sourcePresetId: sourcePresetId ? (sourcePresetId as Id<'source_presets'>) : undefined,
          sourceCriteria,
          evaluatorId: evaluatorId ? (evaluatorId as Id<'job_evaluators'>) : undefined,
          enableRanking,
          schedule: buildScheduleInput(),
          isEnabled,
        });
        onSaved('Schedule created.');
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!open) {
    return null;
  }

  const title =
    target?.type === 'schedule'
      ? 'Edit schedule'
      : target?.type === 'run'
        ? 'Edit queued run'
        : 'Add run';

  const submitLabel = isSaving
    ? 'Saving…'
    : isEditing
      ? 'Save'
      : mode === 'once'
        ? 'Queue run'
        : 'Create schedule';

  return (
    <div className='queue-add-section worker-run-form inline-form-card'>
      <h3 className='queue-add-title'>{title}</h3>
      {error ? <p className='status-text'>{error}</p> : null}

      <div className='queue-add-row'>
        <label>
          Type
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as RunMode)}
            disabled={isEditing}
          >
            <option value='once'>One-time (queue now)</option>
            <option value='recurring'>Recurring schedule</option>
          </select>
        </label>
        <div className='evaluator-inline-field'>
          <span className='evaluator-inline-label'>Enable ranking</span>
          <button
            type='button'
            className={enableRanking ? 'toggle-pill active' : 'toggle-pill'}
            role='switch'
            aria-checked={enableRanking}
            aria-label='Enable ranking for this run'
            onClick={() => setEnableRanking((prev) => !prev)}
          >
            <span className='toggle-pill-track'>
              <span className='toggle-pill-thumb' />
            </span>
            <span className='toggle-pill-text'>{enableRanking ? 'On' : 'Off'}</span>
          </button>
        </div>
        {mode === 'recurring' ? (
          <div className='evaluator-inline-field'>
            <span className='evaluator-inline-label'>Enabled</span>
            <button
              type='button'
              className={isEnabled ? 'toggle-pill active' : 'toggle-pill'}
              role='switch'
              aria-checked={isEnabled}
              aria-label='Enable or disable this schedule'
              onClick={() => setIsEnabled((prev) => !prev)}
            >
              <span className='toggle-pill-track'>
                <span className='toggle-pill-thumb' />
              </span>
              <span className='toggle-pill-text'>{isEnabled ? 'On' : 'Off'}</span>
            </button>
          </div>
        ) : null}
      </div>

      <div className='queue-add-row'>
        <label>
          Source
          <select value={source} onChange={(event) => onSourceChange(event.target.value)}>
            {enabledSources.map((row) => (
              <option key={row.source} value={row.source}>
                {row.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Evaluator (optional)
          <select value={evaluatorId} onChange={(event) => setEvaluatorId(event.target.value)}>
            <option value=''>{sourceDefaultEvaluatorLabel}</option>
            {activeEvaluators.map((row) => (
              <option key={row._id} value={row._id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Preset (optional)
          <select value={sourcePresetId} onChange={(event) => onPresetChange(event.target.value)}>
            <option value=''>No preset</option>
            {(sourcePresets ?? []).map((row) => (
              <option key={row._id} value={row._id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {mode === 'recurring' ? (
        <div className='queue-add-row'>
          <label>
            Schedule type
            <select
              value={scheduleKind}
              onChange={(event) => setScheduleKind(event.target.value as ScheduleKind)}
            >
              <option value='daily'>Daily at time</option>
              <option value='interval'>Every X hours</option>
            </select>
          </label>
          {scheduleKind === 'daily' ? (
            <label>
              Time
              <input
                type='time'
                value={timeOfDay}
                onChange={(event) => setTimeOfDay(event.target.value)}
              />
            </label>
          ) : (
            <label>
              Interval hours
              <input
                type='number'
                min={1}
                max={168}
                value={intervalHours}
                onChange={(event) => setIntervalHours(event.target.value)}
              />
            </label>
          )}
        </div>
      ) : null}

      {sourceFields.length > 0 ? (
        <SourceCriteriaFields
          fields={sourceFields}
          values={sourceCriteria}
          onChange={setSourceCriteria}
          fieldMeta={sourceFieldMeta}
        />
      ) : null}

      <div className='queue-actions-cell'>
        <button type='button' onClick={() => void onSubmit()} disabled={isSaving}>
          {submitLabel}
        </button>
        <button type='button' onClick={onClose} disabled={isSaving}>
          Cancel
        </button>
      </div>
    </div>
  );
}
