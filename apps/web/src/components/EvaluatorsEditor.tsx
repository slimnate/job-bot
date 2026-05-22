import { FormEvent, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';

import { api } from '../../../../convex/_generated/api.js';
import type { Doc, Id } from '../../../../convex/_generated/dataModel.js';

import { PlusIcon } from './PlusIcon.js';

type EvaluatorDoc = Doc<'job_evaluators'>;

type EvaluatorFormState = {
  id: Id<'job_evaluators'>;
  name: string;
  isActive: boolean;
  notes: string;
  resumeMarkdown: string;
  rankingPrompt: string;
};

const fromEvaluator = (evaluator: EvaluatorDoc): EvaluatorFormState => ({
  id: evaluator._id,
  name: evaluator.name,
  isActive: evaluator.isActive,
  notes: evaluator.notes ?? '',
  resumeMarkdown: evaluator.resumeMarkdown ?? '',
  rankingPrompt: evaluator.rankingPrompt ?? '',
});

export function EvaluatorsEditor() {
  const evaluatorList = useQuery(api.evaluators.list, { limit: 50 });
  const upsertEvaluator = useMutation(api.evaluators.upsert);
  const createEvaluator = useMutation(api.evaluators.create);
  const removeEvaluator = useMutation(api.evaluators.remove);
  /** Keeps selection stable until Convex list includes a row we just created. */
  const pendingSelectIdRef = useRef<Id<'job_evaluators'> | null>(null);

  const [selectedId, setSelectedId] = useState<Id<'job_evaluators'> | null>(null);
  const [evaluatorDraft, setEvaluatorDraft] = useState<EvaluatorFormState | null>(null);
  const [isSavingEvaluator, setIsSavingEvaluator] = useState(false);
  const [isDeletingEvaluator, setIsDeletingEvaluator] = useState(false);
  const [evaluatorMessage, setEvaluatorMessage] = useState('');

  useEffect(() => {
    if (!evaluatorList?.length) {
      setSelectedId(null);
      setEvaluatorDraft(null);
      return;
    }
    setSelectedId((current) => {
      if (current && evaluatorList.some((row) => row._id === current)) {
        if (pendingSelectIdRef.current === current) {
          pendingSelectIdRef.current = null;
        }
        return current;
      }
      if (current && pendingSelectIdRef.current === current) {
        return current;
      }
      return evaluatorList[0]._id;
    });
  }, [evaluatorList]);

  const selectedDoc =
    evaluatorList && selectedId ? evaluatorList.find((row) => row._id === selectedId) : undefined;

  useEffect(() => {
    if (!selectedDoc) {
      setEvaluatorDraft(null);
      return;
    }
    setEvaluatorDraft(fromEvaluator(selectedDoc));
  }, [selectedDoc?._id, selectedDoc?.updatedAt]);

  const onEvaluatorSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!evaluatorDraft) {
      return;
    }
    setIsSavingEvaluator(true);
    setEvaluatorMessage('');
    try {
      await upsertEvaluator({
        id: evaluatorDraft.id,
        name: evaluatorDraft.name.trim() || 'Untitled evaluator',
        isActive: evaluatorDraft.isActive,
        notes: evaluatorDraft.notes.trim() || undefined,
        resumeMarkdown: evaluatorDraft.resumeMarkdown.trim() || undefined,
        rankingPrompt: evaluatorDraft.rankingPrompt.trim() || undefined,
      });
      setEvaluatorMessage('Evaluator saved.');
    } catch (error) {
      setEvaluatorMessage(
        error instanceof Error ? `Save failed: ${error.message}` : 'Save failed due to unknown error.'
      );
    } finally {
      setIsSavingEvaluator(false);
    }
  };

  const onNewProfile = async () => {
    setEvaluatorMessage('');
    try {
      const id = await createEvaluator({});
      pendingSelectIdRef.current = id;
      setSelectedId(id);
      setEvaluatorMessage('New evaluator created. Fill in details and save.');
    } catch (error) {
      setEvaluatorMessage(
        error instanceof Error ? `Create failed: ${error.message}` : 'Create failed due to unknown error.'
      );
    }
  };

  const onDeleteEvaluator = async () => {
    if (!evaluatorDraft) {
      return;
    }
    const confirmed = window.confirm(`Delete evaluator '${evaluatorDraft.name}'?`);
    if (!confirmed) {
      return;
    }

    setIsDeletingEvaluator(true);
    setEvaluatorMessage('');
    try {
      const result = await removeEvaluator({ id: evaluatorDraft.id });
      if (result.deleted) {
        setEvaluatorMessage('Evaluator deleted.');
        setSelectedId((current) => (current === evaluatorDraft.id ? null : current));
      } else {
        setEvaluatorMessage('Evaluator not found.');
      }
    } catch (error) {
      setEvaluatorMessage(
        error instanceof Error ? `Delete failed: ${error.message}` : 'Delete failed due to unknown error.'
      );
    } finally {
      setIsDeletingEvaluator(false);
    }
  };

  return (
    <section className='panel'>
      <div className='panel-heading'>
        <h2>Evaluators</h2>
      </div>
      <div className='criteria-editor-layout'>
        <aside className='criteria-profile-sidebar'>
          <div className='criteria-profile-sidebar-actions'>
            <button type='button' className='btn-with-icon' onClick={onNewProfile}>
              <PlusIcon />
              New evaluator
            </button>
          </div>
          {evaluatorList === undefined ? (
            <p className='field-hint'>Loading evaluators...</p>
          ) : evaluatorList.length === 0 ? (
            <p className='field-hint'>No evaluators yet. Create one to get started.</p>
          ) : (
            <ul className='criteria-profile-list'>
              {evaluatorList.map((row) => (
                <li key={row._id}>
                  <button
                    type='button'
                    className={row._id === selectedId ? 'criteria-profile-pill active' : 'criteria-profile-pill'}
                    onClick={() => setSelectedId(row._id)}
                  >
                    <span className='criteria-profile-name'>{row.name}</span>
                    {row.isActive ? <span className='criteria-profile-badge'>Available</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className='criteria-editor-main'>
          {!evaluatorDraft ? (
            <p className='field-hint'>Select or create an evaluator.</p>
          ) : (
            <form className='form-grid' onSubmit={onEvaluatorSubmit}>
              <div className='actions full-width evaluator-form-actions'>
                <button type='submit' disabled={isSavingEvaluator}>
                  {isSavingEvaluator ? 'Saving...' : 'Save'}
                </button>
                <button
                  type='button'
                  className='btn-danger'
                  onClick={() => void onDeleteEvaluator()}
                  disabled={isSavingEvaluator || isDeletingEvaluator}
                >
                  {isDeletingEvaluator ? 'Deleting...' : 'Delete'}
                </button>
              </div>
              <div className='full-width evaluator-top-row'>
                <label className='evaluator-inline-field evaluator-inline-field--name'>
                  <span className='evaluator-inline-label'>Name</span>
                  <input
                    value={evaluatorDraft.name}
                    onChange={(event) =>
                      setEvaluatorDraft((prev) => (prev ? { ...prev, name: event.target.value } : prev))
                    }
                    placeholder='e.g. Senior frontend fit evaluator'
                  />
                </label>
                <div
                  className='evaluator-inline-field evaluator-inline-field--active'
                  title='When on, this profile can be selected for queued runs. The worker default for runs without an evaluator is WORKER_DEFAULT_EVALUATOR_ID (per machine), not this toggle.'
                >
                  <span className='evaluator-inline-label'>Active</span>
                  <button
                    type='button'
                    className={evaluatorDraft.isActive ? 'toggle-pill active' : 'toggle-pill'}
                    role='switch'
                    aria-checked={evaluatorDraft.isActive}
                    onClick={() =>
                      setEvaluatorDraft((prev) => (prev ? { ...prev, isActive: !prev.isActive } : prev))
                    }
                  >
                    <span className='toggle-pill-track'>
                      <span className='toggle-pill-thumb' />
                    </span>
                    <span className='toggle-pill-text'>{evaluatorDraft.isActive ? 'On' : 'Off'}</span>
                  </button>
                </div>
              </div>
              <label className='full-width'>
                Notes
                <span className='field-hint'>
                  Private notes. Not sent to the LLM evaluator.
                </span>
                <textarea
                  value={evaluatorDraft.notes}
                  onChange={(event) =>
                    setEvaluatorDraft((prev) => (prev ? { ...prev, notes: event.target.value } : prev))
                  }
                  rows={3}
                />
              </label>
              <label className='full-width'>
                Resume (Markdown)
                <textarea
                  value={evaluatorDraft.resumeMarkdown}
                  onChange={(event) =>
                    setEvaluatorDraft((prev) =>
                      prev ? { ...prev, resumeMarkdown: event.target.value } : prev
                    )
                  }
                  rows={12}
                  placeholder='Paste your resume in Markdown...'
                />
              </label>
              <label className='full-width'>
                Evaluation prompt
                <textarea
                  value={evaluatorDraft.rankingPrompt}
                  onChange={(event) =>
                    setEvaluatorDraft((prev) =>
                      prev ? { ...prev, rankingPrompt: event.target.value } : prev
                    )
                  }
                  rows={10}
                  placeholder='Describe how the evaluator should score and rank jobs...'
                />
              </label>
              <div className='actions full-width evaluator-form-actions'>
                <button type='submit' disabled={isSavingEvaluator}>
                  {isSavingEvaluator ? 'Saving...' : 'Save'}
                </button>
                <button
                  type='button'
                  className='btn-danger'
                  onClick={() => void onDeleteEvaluator()}
                  disabled={isSavingEvaluator || isDeletingEvaluator}
                >
                  {isDeletingEvaluator ? 'Deleting...' : 'Delete'}
                </button>
                {evaluatorMessage ? <span className='status-text'>{evaluatorMessage}</span> : null}
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
