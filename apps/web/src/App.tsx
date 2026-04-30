import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';

import { api } from '../../../convex/_generated/api.js';
import type { Doc, Id } from '../../../convex/_generated/dataModel.js';

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

type PostingSort = 'discoveredAtDesc' | 'postedAtDesc' | 'scoreDesc';
type RunStatus = '' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

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

const formatDateTime = (timestamp?: number): string => {
  if (!timestamp) {
    return '-';
  }
  return new Date(timestamp).toLocaleString();
};

const formatRunDuration = (startedAt: number, endedAt?: number): string => {
  if (!endedAt || endedAt <= startedAt) {
    return '-';
  }
  const seconds = Math.round((endedAt - startedAt) / 1000);
  return `${seconds}s`;
};

export function App() {
  const criteria = useQuery(api.criteria.get, { onlyActive: true });
  const upsertCriteria = useMutation(api.criteria.upsert);
  const triggerRun = useMutation(api.runs.trigger);

  const [criteriaDraft, setCriteriaDraft] = useState<CriteriaFormState>(emptyCriteriaState);
  const [isSavingCriteria, setIsSavingCriteria] = useState(false);
  const [criteriaMessage, setCriteriaMessage] = useState('');
  const [triggerMessage, setTriggerMessage] = useState('');
  const [isTriggeringRun, setIsTriggeringRun] = useState(false);

  const [postingQuery, setPostingQuery] = useState('');
  const [postingSource, setPostingSource] = useState('');
  const [postingSort, setPostingSort] = useState<PostingSort>('scoreDesc');
  const [postingMinScore, setPostingMinScore] = useState('');

  const postings = useQuery(api.postings.list, {
    query: postingQuery.trim() || undefined,
    source: postingSource.trim() || undefined,
    minScore: postingMinScore.trim() ? Number(postingMinScore) : undefined,
    sort: postingSort,
    limit: 100,
  });

  const [runSourceFilter, setRunSourceFilter] = useState('');
  const [runStatusFilter, setRunStatusFilter] = useState<RunStatus>('');
  const runs = useQuery(api.runs.list, {
    source: runSourceFilter.trim() || undefined,
    status: runStatusFilter || undefined,
    limit: 50,
  });

  useEffect(() => {
    if (!criteria) {
      return;
    }
    setCriteriaDraft(fromCriteria(criteria));
  }, [criteria]);

  const postingSources = useMemo(() => {
    if (!postings) {
      return [];
    }
    return Array.from(new Set(postings.map((posting) => posting.source))).sort();
  }, [postings]);

  const runSources = useMemo(() => {
    if (!runs) {
      return [];
    }
    return Array.from(new Set(runs.map((run) => run.source))).sort();
  }, [runs]);

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

  const onTriggerRun = async () => {
    setIsTriggeringRun(true);
    setTriggerMessage('');
    try {
      const result = await triggerRun({
        criteriaId: criteria?._id,
      });
      setTriggerMessage(`Queued ${result.runIds.length} run(s).`);
    } catch (error) {
      setTriggerMessage(
        error instanceof Error ? `Run trigger failed: ${error.message}` : 'Run trigger failed.'
      );
    } finally {
      setIsTriggeringRun(false);
    }
  };

  return (
    <main className='page'>
      <header className='page-header'>
        <h1>Job Bot Dashboard</h1>
        <p>Manage criteria, browse ranked postings, and track scraping runs.</p>
      </header>

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
              onChange={(event) =>
                setCriteriaDraft((prev) => ({ ...prev, titleKeywords: event.target.value }))
              }
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
              onChange={(event) =>
                setCriteriaDraft((prev) => ({ ...prev, targetSources: event.target.value }))
              }
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

      <section className='panel'>
        <div className='panel-heading'>
          <h2>Ranked Postings</h2>
        </div>
        <div className='filters'>
          <input
            value={postingQuery}
            onChange={(event) => setPostingQuery(event.target.value)}
            placeholder='Search title, company, location'
          />
          <select value={postingSource} onChange={(event) => setPostingSource(event.target.value)}>
            <option value=''>All sources</option>
            {postingSources.map((source) => (
              <option value={source} key={source}>
                {source}
              </option>
            ))}
          </select>
          <input
            value={postingMinScore}
            onChange={(event) => setPostingMinScore(event.target.value)}
            placeholder='Min score'
            type='number'
            min={0}
            max={100}
          />
          <select value={postingSort} onChange={(event) => setPostingSort(event.target.value as PostingSort)}>
            <option value='scoreDesc'>Score (desc)</option>
            <option value='discoveredAtDesc'>Discovered (newest)</option>
            <option value='postedAtDesc'>Posted (newest)</option>
          </select>
        </div>
        <div className='table-wrapper'>
          <table>
            <thead>
              <tr>
                <th>Score</th>
                <th>Role</th>
                <th>Company</th>
                <th>Source</th>
                <th>Location</th>
                <th>Posted</th>
                <th>Discovered</th>
              </tr>
            </thead>
            <tbody>
              {postings?.length ? (
                postings.map((posting) => (
                  <tr key={posting._id}>
                    <td>{posting.latestRanking?.scoreOverall ?? '-'}</td>
                    <td>
                      <a href={posting.url} target='_blank' rel='noreferrer'>
                        {posting.title}
                      </a>
                    </td>
                    <td>{posting.company}</td>
                    <td>{posting.source}</td>
                    <td>{posting.location ?? '-'}</td>
                    <td>{formatDateTime(posting.postedAt)}</td>
                    <td>{formatDateTime(posting.discoveredAt)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7}>No postings match these filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className='panel'>
        <div className='panel-heading'>
          <h2>Scrape Run History</h2>
          <button onClick={onTriggerRun} disabled={isTriggeringRun}>
            {isTriggeringRun ? 'Triggering...' : 'Trigger run'}
          </button>
        </div>
        {triggerMessage ? <p className='status-text'>{triggerMessage}</p> : null}
        <div className='filters'>
          <select value={runSourceFilter} onChange={(event) => setRunSourceFilter(event.target.value)}>
            <option value=''>All sources</option>
            {runSources.map((source) => (
              <option value={source} key={source}>
                {source}
              </option>
            ))}
          </select>
          <select
            value={runStatusFilter}
            onChange={(event) => setRunStatusFilter(event.target.value as RunStatus)}
          >
            <option value=''>All statuses</option>
            <option value='queued'>Queued</option>
            <option value='running'>Running</option>
            <option value='succeeded'>Succeeded</option>
            <option value='failed'>Failed</option>
            <option value='cancelled'>Cancelled</option>
          </select>
        </div>
        <div className='table-wrapper'>
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Source</th>
                <th>Started</th>
                <th>Ended</th>
                <th>Duration</th>
                <th>Stats</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {runs?.length ? (
                runs.map((run) => (
                  <tr key={run._id}>
                    <td>{run.status}</td>
                    <td>{run.source}</td>
                    <td>{formatDateTime(run.startedAt)}</td>
                    <td>{formatDateTime(run.endedAt)}</td>
                    <td>{formatRunDuration(run.startedAt, run.endedAt)}</td>
                    <td>
                      {run.stats
                        ? `disc ${run.stats.discoveredCount}, ins ${run.stats.insertedCount}, rank ${run.stats.rankedCount}`
                        : '-'}
                    </td>
                    <td>{run.errorMessage ?? '-'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7}>No runs recorded yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
