import { FormEvent, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';

import { api } from '../../../../convex/_generated/api.js';
import type { Doc, Id } from '../../../../convex/_generated/dataModel.js';

type CriteriaDoc = Doc<'job_criteria'>;

type CriteriaFormState = {
  id: Id<'job_criteria'>;
  name: string;
  isActive: boolean;
  notes: string;
  resumeMarkdown: string;
  rankingPrompt: string;
};

const fromCriteria = (criteria: CriteriaDoc): CriteriaFormState => ({
  id: criteria._id,
  name: criteria.name,
  isActive: criteria.isActive,
  notes: criteria.notes ?? '',
  resumeMarkdown: criteria.resumeMarkdown ?? '',
  rankingPrompt: criteria.rankingPrompt ?? '',
});

export function CriteriaEditor() {
  const criteriaList = useQuery(api.criteria.list, { limit: 50 });
  const upsertCriteria = useMutation(api.criteria.upsert);
  const createCriteria = useMutation(api.criteria.create);
  /** Keeps selection stable until Convex list includes a row we just created. */
  const pendingSelectIdRef = useRef<Id<'job_criteria'> | null>(null);

  const [selectedId, setSelectedId] = useState<Id<'job_criteria'> | null>(null);
  const [criteriaDraft, setCriteriaDraft] = useState<CriteriaFormState | null>(null);
  const [isSavingCriteria, setIsSavingCriteria] = useState(false);
  const [criteriaMessage, setCriteriaMessage] = useState('');

  useEffect(() => {
    if (!criteriaList?.length) {
      setSelectedId(null);
      setCriteriaDraft(null);
      return;
    }
    setSelectedId((current) => {
      if (current && criteriaList.some((row) => row._id === current)) {
        if (pendingSelectIdRef.current === current) {
          pendingSelectIdRef.current = null;
        }
        return current;
      }
      if (current && pendingSelectIdRef.current === current) {
        return current;
      }
      const active = criteriaList.find((row) => row.isActive);
      return active?._id ?? criteriaList[0]._id;
    });
  }, [criteriaList]);

  const selectedDoc =
    criteriaList && selectedId ? criteriaList.find((row) => row._id === selectedId) : undefined;

  useEffect(() => {
    if (!selectedDoc) {
      setCriteriaDraft(null);
      return;
    }
    setCriteriaDraft(fromCriteria(selectedDoc));
  }, [selectedDoc?._id, selectedDoc?.updatedAt]);

  const onCriteriaSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!criteriaDraft) {
      return;
    }
    setIsSavingCriteria(true);
    setCriteriaMessage('');
    try {
      await upsertCriteria({
        id: criteriaDraft.id,
        name: criteriaDraft.name.trim() || 'Untitled profile',
        isActive: criteriaDraft.isActive,
        notes: criteriaDraft.notes.trim() || undefined,
        resumeMarkdown: criteriaDraft.resumeMarkdown.trim() || undefined,
        rankingPrompt: criteriaDraft.rankingPrompt.trim() || undefined,
      });
      setCriteriaMessage('Criteria saved.');
    } catch (error) {
      setCriteriaMessage(
        error instanceof Error ? `Save failed: ${error.message}` : 'Save failed due to unknown error.'
      );
    } finally {
      setIsSavingCriteria(false);
    }
  };

  const onNewProfile = async () => {
    setCriteriaMessage('');
    try {
      const id = await createCriteria({});
      pendingSelectIdRef.current = id;
      setSelectedId(id);
      setCriteriaMessage('New profile created. Fill in details and save.');
    } catch (error) {
      setCriteriaMessage(
        error instanceof Error ? `Create failed: ${error.message}` : 'Create failed due to unknown error.'
      );
    }
  };

  return (
    <section className='panel'>
      <div className='panel-heading'>
        <h2>Criteria profiles</h2>
      </div>
      <div className='criteria-editor-layout'>
        <aside className='criteria-profile-sidebar'>
          <div className='criteria-profile-sidebar-actions'>
            <button type='button' onClick={onNewProfile}>
              New profile
            </button>
          </div>
          {criteriaList === undefined ? (
            <p className='field-hint'>Loading profiles…</p>
          ) : criteriaList.length === 0 ? (
            <p className='field-hint'>No profiles yet. Create one to get started.</p>
          ) : (
            <ul className='criteria-profile-list'>
              {criteriaList.map((row) => (
                <li key={row._id}>
                  <button
                    type='button'
                    className={row._id === selectedId ? 'criteria-profile-pill active' : 'criteria-profile-pill'}
                    onClick={() => setSelectedId(row._id)}
                  >
                    <span className='criteria-profile-name'>{row.name}</span>
                    {row.isActive ? <span className='criteria-profile-badge'>Active</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className='criteria-editor-main'>
          {!criteriaDraft ? (
            <p className='field-hint'>Select or create a profile.</p>
          ) : (
            <form className='form-grid' onSubmit={onCriteriaSubmit}>
              <label>
                Name
                <input
                  value={criteriaDraft.name}
                  onChange={(event) =>
                    setCriteriaDraft((prev) => (prev ? { ...prev, name: event.target.value } : prev))
                  }
                  placeholder='e.g. Staff engineer search'
                />
              </label>
              <label>
                Active
                <select
                  value={criteriaDraft.isActive ? 'true' : 'false'}
                  onChange={(event) =>
                    setCriteriaDraft((prev) =>
                      prev ? { ...prev, isActive: event.target.value === 'true' } : prev
                    )
                  }
                >
                  <option value='true'>Yes</option>
                  <option value='false'>No</option>
                </select>
              </label>
              <label className='full-width'>
                Notes
                <span className='field-hint'>
                  For your eyes only — not sent to the ranker. Put anything the model should consider in
                  &quot;Ranking prompt&quot; or &quot;Resume&quot; instead.
                </span>
                <textarea
                  value={criteriaDraft.notes}
                  onChange={(event) =>
                    setCriteriaDraft((prev) => (prev ? { ...prev, notes: event.target.value } : prev))
                  }
                  rows={3}
                />
              </label>
              <label className='full-width'>
                Resume (Markdown)
                <textarea
                  value={criteriaDraft.resumeMarkdown}
                  onChange={(event) =>
                    setCriteriaDraft((prev) =>
                      prev ? { ...prev, resumeMarkdown: event.target.value } : prev
                    )
                  }
                  rows={12}
                  placeholder='Paste your resume in Markdown…'
                />
              </label>
              <label className='full-width'>
                Ranking prompt
                <span className='field-hint'>
                  Instructions the ranker will see alongside your resume. You can paste the starter text from
                  <code>ranking-prompt.md</code> in the repo into this field and edit it — that file is a
                  copy-paste prompt for the model, not documentation about the app.
                </span>
                <textarea
                  value={criteriaDraft.rankingPrompt}
                  onChange={(event) =>
                    setCriteriaDraft((prev) =>
                      prev ? { ...prev, rankingPrompt: event.target.value } : prev
                    )
                  }
                  rows={10}
                  placeholder='Describe how you want jobs evaluated against your background…'
                />
              </label>
              <div className='actions full-width'>
                <button type='submit' disabled={isSavingCriteria}>
                  {isSavingCriteria ? 'Saving…' : 'Save profile'}
                </button>
                {criteriaMessage ? <span className='status-text'>{criteriaMessage}</span> : null}
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
