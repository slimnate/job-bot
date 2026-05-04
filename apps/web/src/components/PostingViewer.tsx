import { useEffect, useMemo, useState } from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';

import { api } from '../../../../convex/_generated/api.js';
import type { Id } from '../../../../convex/_generated/dataModel.js';
import { PostingTable, type PostingTableRow } from './PostingTable';

type PostingSort = 'discoveredAtDesc' | 'postedAtDesc' | 'scoreDesc';

type LlmCatalogProvider = {
  key: string;
  displayName: string;
  surface: 'convex_http' | 'worker_cursor';
  models: Array<{ apiModelId: string; displayName: string }>;
};

function workerTriggerBaseUrl(): string {
  const raw =
    (import.meta.env.VITE_WORKER_TRIGGER_URL as string | undefined)?.trim() ??
    'http://127.0.0.1:3999/trigger';
  const base = raw.replace(/\/trigger\/?$/i, '').trim();
  return base || 'http://127.0.0.1:3999';
}

export function PostingViewer() {
  const totalPostings = useQuery(api.postings.count);
  const criteriaProfiles = useQuery(api.criteria.list, { limit: 50 });
  const llmCatalog = useQuery(api.rankingLlmCatalog.listForUi) as LlmCatalogProvider[] | undefined;
  const deletePosting = useMutation(api.postings.deleteOne);
  const clearAllPostings = useMutation(api.postings.clearAll);
  const scoreOnePosting = useAction(api.rankingScorePosting.scoreOnePosting);
  const [postingQuery, setPostingQuery] = useState('');
  const [postingSource, setPostingSource] = useState('');
  const [postingSort, setPostingSort] = useState<PostingSort>('scoreDesc');
  const [postingMinScore, setPostingMinScore] = useState('');
  const [postingMessage, setPostingMessage] = useState('');
  const [deletingPostingId, setDeletingPostingId] = useState<string | null>(null);
  const [isClearing, setIsClearing] = useState(false);
  const [scoreTarget, setScoreTarget] = useState<PostingTableRow | null>(null);
  const [scoreCriteriaId, setScoreCriteriaId] = useState<Id<'job_criteria'> | ''>('');
  const [scoreProviderKey, setScoreProviderKey] = useState('');
  const [scoreApiModelId, setScoreApiModelId] = useState('');
  const [scoreBusy, setScoreBusy] = useState(false);
  const [scoreDialogError, setScoreDialogError] = useState('');

  const postings = useQuery(api.postings.list, {
    query: postingQuery.trim() || undefined,
    source: postingSource.trim() || undefined,
    minScore: postingMinScore.trim() ? Number(postingMinScore) : undefined,
    sort: postingSort,
    limit: 100,
  });

  const postingSources = useMemo(() => {
    if (!postings) {
      return [];
    }
    return Array.from(new Set(postings.map((posting) => posting.source))).sort();
  }, [postings]);

  const selectedProvider = useMemo(
    () => llmCatalog?.find((p) => p.key === scoreProviderKey) ?? null,
    [llmCatalog, scoreProviderKey]
  );

  useEffect(() => {
    if (!scoreTarget || !criteriaProfiles?.length) {
      return;
    }
    setScoreCriteriaId((prev) => {
      if (prev && criteriaProfiles.some((c) => c._id === prev)) {
        return prev;
      }
      const active = criteriaProfiles.find((c) => c.isActive);
      return (active ?? criteriaProfiles[0])!._id;
    });
  }, [scoreTarget, criteriaProfiles]);

  useEffect(() => {
    if (!scoreTarget || !llmCatalog?.length) {
      return;
    }
    setScoreProviderKey((prev) => {
      if (prev && llmCatalog.some((p) => p.key === prev)) {
        return prev;
      }
      return llmCatalog[0]!.key;
    });
  }, [scoreTarget, llmCatalog]);

  useEffect(() => {
    if (!scoreTarget || !selectedProvider?.models.length) {
      return;
    }
    setScoreApiModelId((prev) => {
      if (prev && selectedProvider.models.some((m) => m.apiModelId === prev)) {
        return prev;
      }
      return selectedProvider.models[0]!.apiModelId;
    });
  }, [scoreTarget, selectedProvider]);

  const openScoreDialog = (posting: PostingTableRow) => {
    setScoreDialogError('');
    setScoreTarget(posting);
  };

  const closeScoreDialog = () => {
    if (scoreBusy) {
      return;
    }
    setScoreTarget(null);
    setScoreDialogError('');
  };

  const onSubmitScore = async () => {
    if (!scoreTarget || !scoreCriteriaId) {
      setScoreDialogError('Pick a criteria profile.');
      return;
    }
    if (!selectedProvider || !scoreApiModelId) {
      setScoreDialogError('Pick a provider and model (populate the catalog if the lists are empty).');
      return;
    }

    setScoreBusy(true);
    setScoreDialogError('');
    try {
      if (selectedProvider.surface === 'convex_http') {
        const result = await scoreOnePosting({
          postingId: scoreTarget._id,
          criteriaId: scoreCriteriaId,
          apiModelId: scoreApiModelId,
        });
        if (result.kind === 'success') {
          setPostingMessage(
            `Scored '${scoreTarget.title}' — overall ${result.scoreOverall} (model: ${result.model}).`
          );
          setScoreTarget(null);
        } else {
          setScoreDialogError(result.message);
        }
        return;
      }

      const base = workerTriggerBaseUrl();
      const res = await fetch(`${base}/rank-posting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postingId: scoreTarget._id,
          criteriaId: scoreCriteriaId,
          model: scoreApiModelId,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; scoreOverall?: number; model?: string };
      if (!res.ok || !json.ok) {
        setScoreDialogError(json.error ?? `Worker request failed (${res.status}).`);
        return;
      }
      setPostingMessage(
        `Scored '${scoreTarget.title}' — overall ${json.scoreOverall ?? '-'} (model: ${json.model ?? scoreApiModelId}).`
      );
      setScoreTarget(null);
    } catch (error) {
      setScoreDialogError(
        error instanceof Error ? error.message : 'Scoring failed. Is the worker running with HTTP trigger port?'
      );
    } finally {
      setScoreBusy(false);
    }
  };

  const onDeletePosting = async (posting: { _id: Id<'job_postings'>; title: string }) => {
    setDeletingPostingId(posting._id);
    setPostingMessage('');
    try {
      await deletePosting({ postingId: posting._id });
      setPostingMessage(`Deleted '${posting.title}'.`);
    } catch (error) {
      setPostingMessage(
        error instanceof Error ? `Could not delete posting: ${error.message}` : 'Could not delete posting.'
      );
    } finally {
      setDeletingPostingId(null);
    }
  };

  const onClearAll = async () => {
    const confirmed = window.confirm(
      'Delete all postings and related rankings? This cannot be undone.'
    );
    if (!confirmed) {
      return;
    }
    setIsClearing(true);
    setPostingMessage('');
    try {
      const result = await clearAllPostings({});
      setPostingMessage(
        `Cleared ${result.deletedPostings} posting(s) and ${result.deletedRankings} ranking(s).`
      );
    } catch (error) {
      setPostingMessage(
        error instanceof Error ? `Could not clear postings: ${error.message}` : 'Could not clear postings.'
      );
    } finally {
      setIsClearing(false);
    }
  };

  const catalogEmpty = llmCatalog !== undefined && llmCatalog.length === 0;
  const canRunScore =
    Boolean(scoreCriteriaId) &&
    Boolean(selectedProvider?.models.length) &&
    Boolean(scoreApiModelId) &&
    !catalogEmpty;

  const scoreHint =
    selectedProvider?.surface === 'worker_cursor' ? (
      <p className='panel-subtitle tight score-hint'>
        Runs <strong>Cursor CLI</strong> on your local worker (<code>POST …/rank-posting</code>). Start the worker
        with <code>WORKER_HTTP_TRIGGER_PORT</code> (same base URL as <code>VITE_WORKER_TRIGGER_URL</code>).
      </p>
    ) : (
      <p className='panel-subtitle tight score-hint'>
        Runs the OpenAI-compatible Chat Completions API from <strong>Convex</strong>. Set <code>OPENAI_API_KEY</code>{' '}
        on the deployment (and optional <code>LLM_API_BASE_URL</code>, <code>LLM_RANKING_TEMPERATURE</code>).
      </p>
    );

  return (
    <section className='panel'>
      <div className='panel-heading'>
        <div>
          <h2>Postings</h2>
          {totalPostings !== undefined ? (
            <p className='panel-subtitle tight'>{totalPostings} total in database</p>
          ) : null}
        </div>
        <button
          type='button'
          className='btn-danger'
          onClick={() => void onClearAll()}
          disabled={isClearing}
        >
          {isClearing ? 'Clearing…' : 'Clear All'}
        </button>
      </div>
      {postingMessage ? <p className='status-text'>{postingMessage}</p> : null}
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
      <PostingTable
        postings={postings}
        deletingPostingId={deletingPostingId}
        onDeletePosting={onDeletePosting}
        onOpenScoreDialog={openScoreDialog}
        emptyMessage={postings === undefined ? 'Loading…' : 'No postings match these filters.'}
      />
      {scoreTarget ? (
        <div className='modal-overlay' onClick={closeScoreDialog} role='presentation'>
          <div className='modal-card' onClick={(event) => event.stopPropagation()} role='dialog' aria-modal='true'>
            <div className='modal-header'>
              <h3>Score posting</h3>
              <button type='button' onClick={closeScoreDialog} disabled={scoreBusy}>
                Close
              </button>
            </div>
            <div className='modal-body'>
              <p className='panel-subtitle tight'>
                <strong>{scoreTarget.title}</strong>
                {' · '}
                {scoreTarget.company}
              </p>
              <label className='stacked-field' htmlFor='score-criteria-select'>
                Criteria profile
              </label>
              <select
                id='score-criteria-select'
                className='score-criteria-select'
                value={scoreCriteriaId}
                onChange={(event) => setScoreCriteriaId(event.target.value as Id<'job_criteria'>)}
                disabled={scoreBusy || !criteriaProfiles?.length}
              >
                {!criteriaProfiles?.length ? (
                  <option value=''>No profiles yet — create one under Criteria</option>
                ) : (
                  criteriaProfiles.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                      {c.isActive ? ' (active)' : ''}
                    </option>
                  ))
                )}
              </select>
              <label className='stacked-field' htmlFor='score-provider-select'>
                Provider
              </label>
              <select
                id='score-provider-select'
                className='score-criteria-select'
                value={scoreProviderKey}
                onChange={(event) => setScoreProviderKey(event.target.value)}
                disabled={scoreBusy || catalogEmpty || llmCatalog === undefined}
              >
                {llmCatalog === undefined ? (
                  <option value=''>Loading catalog…</option>
                ) : catalogEmpty ? (
                  <option value=''>No providers — run npm run populate:ranking-catalog</option>
                ) : (
                  llmCatalog.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.displayName}
                    </option>
                  ))
                )}
              </select>
              <label className='stacked-field' htmlFor='score-model-select'>
                Model
              </label>
              <select
                id='score-model-select'
                className='score-criteria-select'
                value={scoreApiModelId}
                onChange={(event) => setScoreApiModelId(event.target.value)}
                disabled={
                  scoreBusy ||
                  !selectedProvider?.models.length ||
                  llmCatalog === undefined ||
                  catalogEmpty
                }
              >
                {!selectedProvider?.models.length ? (
                  <option value=''>No models for this provider</option>
                ) : (
                  selectedProvider.models.map((m) => (
                    <option key={m.apiModelId} value={m.apiModelId}>
                      {m.displayName} ({m.apiModelId})
                    </option>
                  ))
                )}
              </select>
              {scoreHint}
              {scoreDialogError ? <p className='status-text error'>{scoreDialogError}</p> : null}
              <div className='modal-actions-row'>
                <button type='button' onClick={closeScoreDialog} disabled={scoreBusy}>
                  Cancel
                </button>
                <button
                  type='button'
                  className='btn-primary'
                  onClick={() => void onSubmitScore()}
                  disabled={scoreBusy || !criteriaProfiles?.length || !scoreCriteriaId || !canRunScore}
                >
                  {scoreBusy ? 'Scoring…' : 'Run score'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
