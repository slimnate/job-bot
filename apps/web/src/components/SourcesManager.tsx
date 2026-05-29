import { useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';

import { api } from '../../../../convex/_generated/api.js';
import type { Doc, Id } from '../../../../convex/_generated/dataModel.js';

import { PlusIcon } from './PlusIcon.js';
import { SourceCriteriaFields, type CriteriaFieldMeta } from './SourceCriteriaFields.js';

type SourceRow = {
  source: string;
  displayName: string;
  acceptedCriteriaFields: string[];
  criteriaFieldMeta?: Record<string, CriteriaFieldMeta>;
  isEnabled: boolean;
  defaultEvaluatorId?: Id<'job_evaluators'>;
};

type SourcePreset = Doc<'source_presets'>;

type PresetFormMode = 'closed' | 'create' | 'edit';

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
  const isRemotive = selectedSource === 'remotive';
  const presets = useQuery(
    api.sourcePresets.listBySource,
    selectedSource && !isRemotive ? { source: selectedSource } : 'skip'
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
  const [presetFormMode, setPresetFormMode] = useState<PresetFormMode>('closed');
  const [message, setMessage] = useState('');

  const acceptedFields = source?.acceptedCriteriaFields ?? [];

  const onToggleSource = async (row: SourceRow) => {
    setMessage('');
    try {
      await setEnabled({ source: row.source, isEnabled: !row.isEnabled });
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

  /** Clears the preset draft and closes the add/edit form. */
  const resetPresetDraft = () => {
    setPresetFormMode('closed');
    setEditingPresetId(null);
    setDraftName('');
    setDraftValues(emptyCriteriaForFields(acceptedFields));
  };

  const onAddPreset = () => {
    setPresetFormMode('create');
    setEditingPresetId(null);
    setDraftName('');
    setDraftValues(emptyCriteriaForFields(acceptedFields));
    setMessage('');
  };

  const onSavePreset = async () => {
    if (!source) {
      return;
    }
    setMessage('');
    const name = draftName.trim() || 'Untitled preset';
    try {
      if (presetFormMode === 'edit' && editingPresetId) {
        await updatePreset({
          id: editingPresetId,
          name,
          sourceCriteria: draftValues,
        });
        resetPresetDraft();
        setMessage('Preset updated.');
      } else {
        await createPreset({
          source: source.source,
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
          : presetFormMode === 'edit'
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
    setPresetFormMode('edit');
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
    setPresetFormMode('create');
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
        ranking evaluator for runs without an explicit evaluator, and manage reusable criteria presets
        (LinkedIn and Greenhouse; Remotive uses category selection on the queue).
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
                    resetPresetDraft();
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
              <div
                className='evaluator-inline-field evaluator-inline-field--active'
                title='When off, this source cannot be selected when adding runs to the queue.'
              >
                <span className='evaluator-inline-label'>Enabled</span>
                <button
                  type='button'
                  className={source.isEnabled ? 'toggle-pill active' : 'toggle-pill'}
                  role='switch'
                  aria-checked={source.isEnabled}
                  aria-label='Enable or disable this source'
                  onClick={() => void onToggleSource(source)}
                >
                  <span className='toggle-pill-track'>
                    <span className='toggle-pill-thumb' />
                  </span>
                  <span className='toggle-pill-text'>{source.isEnabled ? 'On' : 'Off'}</span>
                </button>
              </div>
              <p className='field-hint'>
                Accepted criteria fields: {acceptedFields.join(', ') || 'none'}
              </p>
              {source.criteriaFieldMeta ? (
                <ul className='source-criteria-meta-readonly field-hint full-width'>
                  {acceptedFields.map((field) => {
                    const meta = source.criteriaFieldMeta?.[field];
                    if (!meta?.hint) {
                      return null;
                    }
                    return (
                      <li key={field}>
                        <strong>{meta.label ?? field}:</strong> {meta.hint}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
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
              {isRemotive ? (
                <p className='field-hint full-width'>
                  Remotive uses category checkboxes on the Workers queue when adding a run (not named
                  presets on this page).
                </p>
              ) : (
                <>
                  {presetFormMode === 'closed' ? (
                    <div className='actions'>
                      <button type='button' className='btn-with-icon' onClick={onAddPreset}>
                        <PlusIcon />
                        Add preset
                      </button>
                    </div>
                  ) : (
                    <div className='form-grid inline-form-card'>
                      <h3 className='queue-add-title full-width'>
                        {presetFormMode === 'edit' ? 'Edit preset' : 'Add preset'}
                      </h3>
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
                        fieldMeta={source.criteriaFieldMeta}
                      />
                      {presetFormMode === 'edit' ? (
                        <p className='field-hint full-width'>
                          Editing preset — changes apply when you click Update preset.
                        </p>
                      ) : null}
                      <div className='actions full-width'>
                        <button type='button' onClick={() => void onSavePreset()}>
                          {presetFormMode === 'edit' ? 'Update preset' : 'Save preset'}
                        </button>
                        <button type='button' onClick={resetPresetDraft}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
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
                                <td key={`${preset._id}-${field}`}>
                                  {preset.sourceCriteria[field] ?? '-'}
                                </td>
                              ))}
                              <td className='queue-actions-cell'>
                                <button
                                  type='button'
                                  onClick={() => onEditPreset(preset)}
                                  aria-pressed={
                                    presetFormMode === 'edit' && editingPresetId === preset._id
                                  }
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
            </>
          )}
        </div>
      </div>
    </section>
  );
}
