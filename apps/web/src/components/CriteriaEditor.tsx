import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';

import { api } from '../../../../convex/_generated/api.js';
import type { Doc, Id } from '../../../../convex/_generated/dataModel.js';

type CriteriaDoc = Doc<'job_criteria'>;

type CriteriaFormState = {
  id?: Id<'job_criteria'>;
  name: string;
  isActive: boolean;
  titleKeywords: string;
  excludedKeywords: string;
  locations: string;
  remotePolicy: '' | 'remote' | 'hybrid' | 'onsite' | 'any';
  salaryHints: string;
  seniority: '' | 'intern' | 'junior' | 'mid' | 'senior' | 'staff' | 'principal' | 'any';
  targetSources: string;
  notes: string;
};

const emptyCriteriaState: CriteriaFormState = {
  name: 'Primary criteria',
  isActive: true,
  titleKeywords: '',
  excludedKeywords: '',
  locations: '',
  remotePolicy: 'any',
  salaryHints: '',
  seniority: 'any',
  targetSources: '',
  notes: '',
};

const splitCsv = (value: string): string[] =>
  value
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);

const joinCsv = (values?: string[]): string => (values ?? []).join(', ');

const fromCriteria = (criteria: CriteriaDoc): CriteriaFormState => ({
  id: criteria._id,
  name: criteria.name,
  isActive: criteria.isActive,
  titleKeywords: joinCsv(criteria.titleKeywords),
  excludedKeywords: joinCsv(criteria.excludedKeywords),
  locations: joinCsv(criteria.locations),
  remotePolicy: criteria.remotePolicy ?? '',
  salaryHints: joinCsv(criteria.salaryHints),
  seniority: criteria.seniority ?? '',
  targetSources: joinCsv(criteria.targetSources),
  notes: criteria.notes ?? '',
});

export function CriteriaEditor() {
  const criteria = useQuery(api.criteria.get, { onlyActive: true });
  const upsertCriteria = useMutation(api.criteria.upsert);

  const [criteriaDraft, setCriteriaDraft] = useState<CriteriaFormState>(emptyCriteriaState);
  const [isSavingCriteria, setIsSavingCriteria] = useState(false);
  const [criteriaMessage, setCriteriaMessage] = useState('');

  useEffect(() => {
    if (!criteria) {
      return;
    }
    setCriteriaDraft(fromCriteria(criteria));
  }, [criteria]);

  const onCriteriaSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSavingCriteria(true);
    setCriteriaMessage('');
    try {
      await upsertCriteria({
        id: criteriaDraft.id,
        name: criteriaDraft.name.trim() || 'Primary criteria',
        isActive: criteriaDraft.isActive,
        titleKeywords: splitCsv(criteriaDraft.titleKeywords),
        excludedKeywords: splitCsv(criteriaDraft.excludedKeywords),
        locations: splitCsv(criteriaDraft.locations),
        remotePolicy: criteriaDraft.remotePolicy || undefined,
        salaryHints: splitCsv(criteriaDraft.salaryHints),
        seniority: criteriaDraft.seniority || undefined,
        targetSources: splitCsv(criteriaDraft.targetSources),
        notes: criteriaDraft.notes.trim() || undefined,
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

  return (
    <section className='panel'>
      <div className='panel-heading'>
        <h2>Criteria Editor</h2>
      </div>
      <form className='form-grid' onSubmit={onCriteriaSubmit}>
        <label>
          Name
          <input
            value={criteriaDraft.name}
            onChange={(event) => setCriteriaDraft((prev) => ({ ...prev, name: event.target.value }))}
            placeholder='Primary criteria'
          />
        </label>
        <label>
          Active
          <select
            value={criteriaDraft.isActive ? 'true' : 'false'}
            onChange={(event) =>
              setCriteriaDraft((prev) => ({ ...prev, isActive: event.target.value === 'true' }))
            }
          >
            <option value='true'>Yes</option>
            <option value='false'>No</option>
          </select>
        </label>
        <label>
          Title keywords (comma-separated)
          <input
            value={criteriaDraft.titleKeywords}
            onChange={(event) => setCriteriaDraft((prev) => ({ ...prev, titleKeywords: event.target.value }))}
            placeholder='frontend, react, typescript'
          />
        </label>
        <label>
          Excluded keywords
          <input
            value={criteriaDraft.excludedKeywords}
            onChange={(event) =>
              setCriteriaDraft((prev) => ({ ...prev, excludedKeywords: event.target.value }))
            }
            placeholder='contract, unpaid'
          />
        </label>
        <label>
          Locations
          <input
            value={criteriaDraft.locations}
            onChange={(event) => setCriteriaDraft((prev) => ({ ...prev, locations: event.target.value }))}
            placeholder='new york, remote, chicago'
          />
        </label>
        <label>
          Remote policy
          <select
            value={criteriaDraft.remotePolicy}
            onChange={(event) =>
              setCriteriaDraft((prev) => ({
                ...prev,
                remotePolicy: event.target.value as CriteriaFormState['remotePolicy'],
              }))
            }
          >
            <option value=''>Unset</option>
            <option value='any'>Any</option>
            <option value='remote'>Remote</option>
            <option value='hybrid'>Hybrid</option>
            <option value='onsite'>Onsite</option>
          </select>
        </label>
        <label>
          Salary hints
          <input
            value={criteriaDraft.salaryHints}
            onChange={(event) => setCriteriaDraft((prev) => ({ ...prev, salaryHints: event.target.value }))}
            placeholder='$150k+, equity'
          />
        </label>
        <label>
          Seniority
          <select
            value={criteriaDraft.seniority}
            onChange={(event) =>
              setCriteriaDraft((prev) => ({
                ...prev,
                seniority: event.target.value as CriteriaFormState['seniority'],
              }))
            }
          >
            <option value=''>Unset</option>
            <option value='any'>Any</option>
            <option value='intern'>Intern</option>
            <option value='junior'>Junior</option>
            <option value='mid'>Mid</option>
            <option value='senior'>Senior</option>
            <option value='staff'>Staff</option>
            <option value='principal'>Principal</option>
          </select>
        </label>
        <label>
          Target sources
          <input
            value={criteriaDraft.targetSources}
            onChange={(event) => setCriteriaDraft((prev) => ({ ...prev, targetSources: event.target.value }))}
            placeholder='linkedin, greenhouse'
          />
        </label>
        <label className='full-width'>
          Notes
          <textarea
            value={criteriaDraft.notes}
            onChange={(event) => setCriteriaDraft((prev) => ({ ...prev, notes: event.target.value }))}
            rows={3}
          />
        </label>
        <div className='actions full-width'>
          <button type='submit' disabled={isSavingCriteria}>
            {isSavingCriteria ? 'Saving...' : 'Save criteria'}
          </button>
          {criteriaMessage ? <span className='status-text'>{criteriaMessage}</span> : null}
        </div>
      </form>
    </section>
  );
}
