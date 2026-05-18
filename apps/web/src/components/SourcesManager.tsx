import { useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';

import { api } from '../../../../convex/_generated/api.js';
import type { Doc, Id } from '../../../../convex/_generated/dataModel.js';

import { SourceCriteriaFields } from './SourceCriteriaFields.js';

type SourceRow = {
  source: string;
  displayName: string;
  acceptedCriteriaFields: string[];
  isEnabled: boolean;
  defaultEvaluatorId?: Id<'job_evaluators'>;
};

type SourcePreset = Doc<'source_presets'>;

function emptyCriteriaForFields(fields: string[]): Record<string, string> {
  const next: Record<string, string> = {};
  for (const field of fields) {
    next[field] = '';
  }
  return next;
}

export function SourcesManager() {
  const sources = (useQuery(api.sources.list) ?? []) as SourceRow[];
  const activeEvaluators = useQuery(api.evaluators.listActive, {});
  const [selectedSource, setSelectedSource] = useState('linkedin');
  const presets = useQuery(
    api.sourcePresets.listBySource,
    selectedSource ? ({ source: selectedSource as 'linkedin' }) : 'skip'
  ) as SourcePreset[] | undefined;

  const setEnabled = useMutation(api.sources.setEnabled);
  const setDefaultEvaluator = useMutation(api.sources.setDefaultEvaluator);
  const createPreset = useMutation(api.sourcePresets.create);
  const updatePreset = useMutation(api.sourcePresets.update);
  const removePreset = useMutation(api.sourcePresets.remove);

  const source = useMemo(
    () => sources.find((row) => row.source === selectedSource) ?? sources[0] ?? null,
    [sources, selectedSource]
  );
  const [draftName, setDraftName] = useState('');
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [editingPresetId, setEditingPresetId] = useState<Id<'source_presets'> | null>(null);
  const [message, setMessage] = useState('');

  const acceptedFields = source?.acceptedCriteriaFields ?? [];

  const syncDraftFields = (fields: string[]) => {
    setDraftValues((prev) => {
      const next: Record<string, string> = {};
      for (const field of fields) {
        next[field] = prev[field] ?? '';
      }
      return next;
    });
  };

  const onToggleSource = async (row: SourceRow) => {
    setMessage('');
    try {
      await setEnabled({ source: row.source as 'linkedin', isEnabled: !row.isEnabled });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update source.');
    }
  };

  const onDefaultEvaluatorChange = async (sourceKey: string, value: string) => {
    setMessage('');
    try {
      await setDefaultEvaluator({
        source: sourceKey,
        defaultEvaluatorId: value === '' ? null : (value as Id<'job_evaluators'>),
      });
      setMessage('Default evaluator updated.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update default evaluator.');
    }
  };

  const resetPresetDraft = () => {
    setEditingPresetId(null);
    setDraftName('');
    setDraftValues(emptyCriteriaForFields(acceptedFields));
  };

  const onSavePreset = async () => {
    if (!source) {
      return;
    }
    setMessage('');
    const name = draftName.trim() || 'Untitled preset';
    try {
      if (editingPresetId) {
        await updatePreset({
          id: editingPresetId,
          name,
          sourceCriteria: draftValues,
        });
        resetPresetDraft();
        setMessage('Preset updated.');
      } else {
        await createPreset({
          source: source.source as 'linkedin',
          name,
          sourceCriteria: draftValues,
        });
        resetPresetDraft();
        setMessage('Preset created.');
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : editingPresetId
            ? 'Could not update preset.'
            : 'Could not create preset.'
      );
    }
  };

  const onDeletePreset = async (id: Id<'source_presets'>) => {
    const confirmed = window.confirm('Delete this source preset?');
    if (!confirmed) {
      return;
    }
    setMessage('');
    try {
      await removePreset({ id });
      if (editingPresetId === id) {
        resetPresetDraft();
      }
      setMessage('Preset deleted.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not delete preset.');
    }
  };

  const onEditPreset = (preset: SourcePreset) => {
    setEditingPresetId(preset._id);
    setDraftName(preset.name);
    const next = emptyCriteriaForFields(acceptedFields);
    for (const field of acceptedFields) {
      next[field] = preset.sourceCriteria[field] ?? '';
    }
    setDraftValues(next);
    setMessage('');
  };

  const onUsePresetAsDraft = (preset: SourcePreset) => {
    setEditingPresetId(null);
    setDraftName(`${preset.name} copy`);
    const next = emptyCriteriaForFields(acceptedFields);
    for (const field of acceptedFields) {
      next[field] = preset.sourceCriteria[field] ?? '';
    }
    setDraftValues(next);
    setMessage('');
  };

  return (
    <section className='panel'>
      <div className='panel-heading'>
        <h2>Sources</h2>
      </div>
      {message ? <p className='status-text'>{message}</p> : null}
      <p className='panel-subtitle tight'>
        Source criteria fields are code-managed. Use this page to enable sources, set the default
        ranking evaluator for runs without an explicit evaluator, and manage reusable criteria presets.
      </p>
      <div className='criteria-editor-layout'>
        <aside className='criteria-profile-sidebar'>
          <ul className='criteria-profile-list'>
            {sources.map((row) => (
              <li key={row.source}>
                <button
                  type='button'
                  className={
                    row.source === (source?.source ?? '')
                      ? 'criteria-profile-pill active'
                      : 'criteria-profile-pill'
                  }
                  onClick={() => {
                    setSelectedSource(row.source);
                    setEditingPresetId(null);
                    syncDraftFields(row.acceptedCriteriaFields);
                  }}
                >
                  <span className='criteria-profile-name'>{row.displayName}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <div className='criteria-editor-main'>
          {!source ? (
            <p className='field-hint'>Loading sources...</p>
          ) : (
            <>
              <div className='actions'>
                <button type='button' onClick={() => void onToggleSource(source)}>
                  {source.isEnabled ? 'Disable source' : 'Enable source'}
                </button>
              </div>
              <p className='field-hint'>
                Accepted criteria fields: {acceptedFields.join(', ') || 'none'}
              </p>
              <label className='full-width'>
                Default evaluator (ranking when a queued run has no evaluator)
                <select
                  value={source.defaultEvaluatorId ?? ''}
                  onChange={(event) => void onDefaultEvaluatorChange(source.source, event.target.value)}
                  aria-label='Default evaluator for this source'
                >
                  <option value=''>None — use WORKER_DEFAULT_EVALUATOR_ID or empty profile</option>
                  {(activeEvaluators ?? []).map((ev) => (
                    <option key={ev._id} value={ev._id}>
                      {ev.name}
                    </option>
                  ))}
                </select>
                <span className='field-hint'>
                  Only <strong>Active</strong> (available) profiles are listed. Resolution order: run
                  evaluator → this source default → <code>WORKER_DEFAULT_EVALUATOR_ID</code>.
                </span>
              </label>
              <div className='form-grid'>
                <label className='full-width'>
                  Preset name
                  <input
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    placeholder='e.g. React Developer in Austin, TX'
                  />
                </label>
                <SourceCriteriaFields
                  fields={acceptedFields}
                  values={draftValues}
                  onChange={setDraftValues}
                />
                {editingPresetId ? (
                  <p className='field-hint full-width'>
                    Editing preset — changes apply when you click Update preset.
                  </p>
                ) : null}
                <div className='actions full-width'>
                  <button type='button' onClick={() => void onSavePreset()}>
                    {editingPresetId ? 'Update preset' : 'Save preset'}
                  </button>
                  {editingPresetId ? (
                    <button type='button' onClick={resetPresetDraft}>
                      Cancel
                    </button>
                  ) : null}
                </div>
              </div>
              <div className='table-wrapper'>
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      {acceptedFields.map((field) => (
                        <th key={field}>{field}</th>
                      ))}
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {presets === undefined ? (
                      <tr>
                        <td colSpan={acceptedFields.length + 2}>Loading presets...</td>
                      </tr>
                    ) : presets.length === 0 ? (
                      <tr>
                        <td colSpan={acceptedFields.length + 2}>No presets yet.</td>
                      </tr>
                    ) : (
                      presets.map((preset) => (
                        <tr key={preset._id}>
                          <td>{preset.name}</td>
                          {acceptedFields.map((field) => (
                            <td key={`${preset._id}-${field}`}>{preset.sourceCriteria[field] ?? '-'}</td>
                          ))}
                          <td className='queue-actions-cell'>
                            <button
                              type='button'
                              onClick={() => onEditPreset(preset)}
                              aria-pressed={editingPresetId === preset._id}
                            >
                              Edit
                            </button>
                            <button type='button' onClick={() => onUsePresetAsDraft(preset)}>
                              Duplicate
                            </button>
                            <button type='button' onClick={() => void onDeletePreset(preset._id)}>
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
