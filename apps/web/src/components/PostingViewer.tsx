import { useEffect, useMemo, useRef, useState } from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';

import { api } from '../../../../convex/_generated/api.js';
import type { Id } from '../../../../convex/_generated/dataModel.js';
import { FilterSelect } from './FilterSelect';
import { useWorkerTriggerUrl } from '../hooks/useWorkerTriggerUrl.js';
import { formatRankRunLogLine, subscribeRankRunLogs } from '../rankRunLog.js';
import { PostingTable, type PostingTableRow } from './PostingTable';

type PostingSort = 'discoveredAtDesc' | 'rankedAtDesc' | 'postedAtDesc' | 'scoreDesc';
type PostingRankStatus = 'all' | 'ranked' | 'unranked';

type LlmCatalogProvider = {
  key: string;
  displayName: string;
  surface: 'convex_http' | 'worker_cursor';
  models: Array<{ apiModelId: string; displayName: string }>;
};

const POSTINGS_PAGE_SIZE_KEY = 'postingsPageSize';
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];

function readStoredPageSize(): PageSizeOption {
  try {
    const raw = localStorage.getItem(POSTINGS_PAGE_SIZE_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : 20;
    return PAGE_SIZE_OPTIONS.includes(parsed as PageSizeOption) ? (parsed as PageSizeOption) : 20;
  } catch {
    return 20;
  }
}

export function PostingViewer() {
  const workerTriggerUrl = useWorkerTriggerUrl();
  const workerTriggerBaseUrl = useMemo(() => {
    if (!workerTriggerUrl) {
      return null;
    }
    const base = workerTriggerUrl.replace(/\/trigger\/?$/i, '').trim();
    return base.length > 0 ? base : null;
  }, [workerTriggerUrl]);
  const totalPostings = useQuery(api.postings.count);
  const configuredSources = useQuery(api.sources.list);
  const [postingPageSize, setPostingPageSize] = useState<PageSizeOption>(readStoredPageSize);
  const evaluatorProfiles = useQuery(api.evaluators.list, { limit: 50 });
  const llmCatalog = useQuery(api.rankingLlmCatalog.listForUi) as LlmCatalogProvider[] | undefined;
  const deletePosting = useMutation(api.postings.deleteOne);
  const clearAllPostings = useMutation(api.postings.clearAll);
  const scoreOnePosting = useAction(api.rankingScorePosting.scoreOnePosting);
  const scorePostingsBatch = useAction(api.rankingScorePosting.scorePostingsBatch);
  const [postingQuery, setPostingQuery] = useState('');
  const [postingSource, setPostingSource] = useState('');
  const [postingSort, setPostingSort] = useState<PostingSort>('scoreDesc');
  const [postingMinScore, setPostingMinScore] = useState('');
  const [postingRankStatus, setPostingRankStatus] = useState<PostingRankStatus>('all');
  const [postingMessage, setPostingMessage] = useState('');
  const [deletingPostingId, setDeletingPostingId] = useState<string | null>(null);
  const [isClearing, setIsClearing] = useState(false);
  const [selectedPostingIds, setSelectedPostingIds] = useState<Set<string>>(new Set());
  const [scoreTargets, setScoreTargets] = useState<PostingTableRow[]>([]);
  const [scoreEvaluatorId, setScoreEvaluatorId] = useState<Id<'job_evaluators'> | ''>('');
  const [scoreProviderKey, setScoreProviderKey] = useState('');
  const [scoreApiModelId, setScoreApiModelId] = useState('');
  const [scoreBusy, setScoreBusy] = useState(false);
  const [scoreDialogError, setScoreDialogError] = useState('');
  const [scoreRankLogs, setScoreRankLogs] = useState<string[]>([]);
  const rankLogStopRef = useRef<(() => void) | null>(null);
  const rankLogEndRef = useRef<HTMLDivElement | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const pageCursorsRef = useRef<(string | null)[]>([null]);

  const listFilters = useMemo(
    () => ({
      query: postingQuery.trim() || undefined,
      source: postingSource.trim() || undefined,
      minScore: postingMinScore.trim() ? Number(postingMinScore) : undefined,
      sort: postingSort,
      rankStatus: postingRankStatus === 'all' ? undefined : postingRankStatus,
      pageSize: postingPageSize,
    }),
    [postingQuery, postingSource, postingMinScore, postingSort, postingRankStatus, postingPageSize]
  );

  const resetPagination = () => {
    setPageIndex(0);
    pageCursorsRef.current = [null];
  };

  useEffect(() => {
    resetPagination();
  }, [listFilters]);

  const pageCursor = pageCursorsRef.current[pageIndex] ?? null;

  const pageResult = useQuery(api.postings.listPage, {
    ...listFilters,
    paginationOpts: { numItems: postingPageSize, cursor: pageCursor },
  });

  useEffect(() => {
    if (pageResult === undefined) {
      return;
    }
    if (!pageResult.isDone && pageResult.continueCursor) {
      pageCursorsRef.current[pageIndex + 1] = pageResult.continueCursor;
    }
  }, [pageResult, pageIndex]);

  const filteredCount = useQuery(api.postings.listPageCount, listFilters);

  const postings = pageResult?.page ?? [];
  const postingsLoading = pageResult === undefined;

  const totalPages = Math.max(1, Math.ceil((filteredCount ?? 0) / postingPageSize));
  const currentPage = pageIndex + 1;
  const canGoPrev = pageIndex > 0;
  const canGoNext =
    filteredCount !== undefined ? currentPage < totalPages : Boolean(pageResult && !pageResult.isDone);

  const onPageSizeChange = (nextSize: PageSizeOption) => {
    setPostingPageSize(nextSize);
    resetPagination();
    try {
      localStorage.setItem(POSTINGS_PAGE_SIZE_KEY, String(nextSize));
    } catch {
      // ignore storage errors
    }
  };

  const goToPrevPage = () => {
    if (!canGoPrev) {
      return;
    }
    setPageIndex((prev) => prev - 1);
  };

  const goToNextPage = () => {
    if (!canGoNext) {
      return;
    }
    setPageIndex((prev) => prev + 1);
  };

  const selectedProvider = useMemo(
    () => llmCatalog?.find((p) => p.key === scoreProviderKey) ?? null,
    [llmCatalog, scoreProviderKey]
  );

  useEffect(() => {
    if (!scoreTargets.length || !evaluatorProfiles?.length) {
      return;
    }
    setScoreEvaluatorId((prev) => {
      if (prev && evaluatorProfiles.some((c) => c._id === prev)) {
        return prev;
      }
      return evaluatorProfiles[0]!._id;
    });
  }, [scoreTargets, evaluatorProfiles]);

  useEffect(() => {
    if (!scoreTargets.length || !llmCatalog?.length) {
      return;
    }
    setScoreProviderKey((prev) => {
      if (prev && llmCatalog.some((p) => p.key === prev)) {
        return prev;
      }
      const cursorProvider = llmCatalog.find(
        (p) => p.key === 'cursor' || p.surface === 'worker_cursor'
      );
      return cursorProvider?.key ?? llmCatalog[0]!.key;
    });
  }, [scoreTargets, llmCatalog]);

  useEffect(() => {
    if (!scoreTargets.length || !selectedProvider?.models.length) {
      return;
    }
    setScoreApiModelId((prev) => {
      if (prev && selectedProvider.models.some((m) => m.apiModelId === prev)) {
        return prev;
      }
      return selectedProvider.models[0]!.apiModelId;
    });
  }, [scoreTargets, selectedProvider]);

  const providerModels = selectedProvider?.models ?? [];

  const scoreModelOptions = useMemo(
    () =>
      providerModels.map((m) => ({
        value: m.apiModelId,
        label: m.displayName,
        sublabel: m.apiModelId,
      })),
    [providerModels]
  );

  useEffect(() => {
    if (!postings) {
      return;
    }
    const visiblePostingIds = new Set(postings.map((posting) => posting._id as string));
    setSelectedPostingIds((prev) => {
      const next = new Set(Array.from(prev).filter((id) => visiblePostingIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [postings]);

  const stopRankLogStream = () => {
    rankLogStopRef.current?.();
    rankLogStopRef.current = null;
  };

  const openScoreDialog = (posting: PostingTableRow) => {
    stopRankLogStream();
    setScoreRankLogs([]);
    setScoreDialogError('');
    setScoreTargets([posting]);
  };

  const closeScoreDialog = () => {
    if (scoreBusy) {
      return;
    }
    stopRankLogStream();
    setScoreRankLogs([]);
    setScoreTargets([]);
    setScoreDialogError('');
  };

  useEffect(() => {
    if (!scoreRankLogs.length) {
      return;
    }
    rankLogEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [scoreRankLogs]);

  useEffect(() => () => stopRankLogStream(), []);

  const onSubmitScore = async () => {
    if (!scoreTargets.length || !scoreEvaluatorId) {
      setScoreDialogError('Pick an evaluator profile.');
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
        if (scoreTargets.length === 1) {
          const one = await scoreOnePosting({
            postingId: scoreTargets[0]!._id,
            evaluatorId: scoreEvaluatorId,
            apiModelId: scoreApiModelId,
          });
          if (one.kind === 'error') {
            setScoreDialogError(one.message);
            return;
          }
          setPostingMessage(`Scored '${scoreTargets[0]!.title}'.`);
        } else {
          const batch = await scorePostingsBatch({
            postingIds: scoreTargets.map((posting) => posting._id),
            evaluatorId: scoreEvaluatorId,
            apiModelId: scoreApiModelId,
          });
          if (batch.kind === 'error') {
            setScoreDialogError(batch.message);
            return;
          }
          setPostingMessage(`Scored ${batch.saved} posting(s) in one batch request.`);
        }
      } else {
        const base = workerTriggerBaseUrl;
        if (!base) {
          setScoreDialogError(
            'Set VITE_WORKER_TRIGGER_URL in Settings or .env.local to score via the worker.'
          );
          return;
        }
        const rankingRunId = crypto.randomUUID();
        setScoreRankLogs([]);
        rankLogStopRef.current = subscribeRankRunLogs(base, rankingRunId, {
          onLog: (entry) => {
            setScoreRankLogs((prev) => [...prev, formatRankRunLogLine(entry)]);
          },
          onEnd: (end) => {
            if (!end.ok && end.error) {
              setScoreDialogError((prev) =>
                prev ? prev : `Ranking run finished with error: ${end.error}`
              );
            }
          },
        });

        if (scoreTargets.length === 1) {
          const res = await fetch(`${base}/rank-posting`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              postingId: scoreTargets[0]!._id,
              evaluatorId: scoreEvaluatorId,
              model: scoreApiModelId,
              rankingRunId,
            }),
          });
          const json = (await res.json()) as {
            ok?: boolean;
            error?: string;
            ranked?: boolean;
            scoreOverall?: number;
          };
          if (!res.ok || !json.ok) {
            const base = json.error ?? `Worker request failed (${res.status}).`;
            setScoreDialogError(
              json.ranked && typeof json.scoreOverall === 'number'
                ? `Scored ${json.scoreOverall}/100 but could not save to the database. ${base}`
                : base
            );
            return;
          }
          setPostingMessage(`Scored '${scoreTargets[0]!.title}'.`);
        } else {
          const res = await fetch(`${base}/rank-postings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              postingIds: scoreTargets.map((posting) => posting._id),
              evaluatorId: scoreEvaluatorId,
              model: scoreApiModelId,
              rankingRunId,
            }),
          });
          const json = (await res.json()) as {
            ok?: boolean;
            error?: string;
            saved?: number;
            ranked?: boolean;
            scores?: Array<{ postingId: string; scoreOverall: number }>;
          };
          if (!res.ok || !json.ok) {
            const base = json.error ?? `Worker batch request failed (${res.status}).`;
            const scoreHint =
              json.ranked && json.scores?.length
                ? ` Scores: ${json.scores.map((s) => `${s.scoreOverall}`).join(', ')}.`
                : '';
            setScoreDialogError(
              json.ranked
                ? `Ranking finished but could not save to the database.${scoreHint} ${base}`
                : base
            );
            return;
          }
          setPostingMessage(`Scored ${json.saved ?? scoreTargets.length} posting(s) in one batch request.`);
        }
      }
      setScoreTargets([]);
      setSelectedPostingIds(new Set());
    } catch (error) {
      setScoreDialogError(
        error instanceof Error ? error.message : 'Scoring failed. Is the worker running with HTTP trigger port?'
      );
    } finally {
      stopRankLogStream();
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

  /**
   * Maintains multi-select state from the first-column row checkboxes.
   */
  const onTogglePostingSelection = (postingId: string, checked: boolean) => {
    setSelectedPostingIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(postingId);
      } else {
        next.delete(postingId);
      }
      return next;
    });
  };

  /**
   * Toggles all currently visible rows, matching table filter/sort state.
   */
  const onToggleSelectAllVisible = (checked: boolean) => {
    if (!postings?.length) {
      return;
    }
    if (checked) {
      setSelectedPostingIds(new Set(postings.map((posting) => posting._id)));
      return;
    }
    setSelectedPostingIds(new Set());
  };

  const onBulkDeleteSelected = async () => {
    if (!postings?.length || !selectedPostingIds.size) {
      return;
    }
    const selected = postings.filter((posting) => selectedPostingIds.has(posting._id));
    const confirmed = window.confirm(`Delete ${selected.length} selected posting(s)? This cannot be undone.`);
    if (!confirmed) {
      return;
    }
    setPostingMessage('');
    let deleted = 0;
    for (const posting of selected) {
      try {
        await deletePosting({ postingId: posting._id });
        deleted += 1;
      } catch {
        // Continue deleting remaining selections and summarize completion count.
      }
    }
    setSelectedPostingIds(new Set());
    setPostingMessage(`Deleted ${deleted}/${selected.length} selected posting(s).`);
  };

  const onBulkScoreSelected = () => {
    if (!postings?.length || !selectedPostingIds.size) {
      return;
    }
    const selected = postings.filter((posting) => selectedPostingIds.has(posting._id));
    stopRankLogStream();
    setScoreRankLogs([]);
    setScoreDialogError('');
    setScoreTargets(selected);
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
    Boolean(scoreEvaluatorId) &&
    Boolean(selectedProvider?.models.length) &&
    Boolean(scoreApiModelId) &&
    !catalogEmpty;
  const selectedCount = selectedPostingIds.size;
  const allVisibleSelected = Boolean(
    postings?.length && postings.every((posting) => selectedPostingIds.has(posting._id))
  );

  const scoreModelSelectDisabled =
    scoreBusy || !providerModels.length || llmCatalog === undefined || catalogEmpty;

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
    <section className='panel panel--postings'>
      <div className='panel-heading'>
        <div>
          <h2>Postings</h2>
          {totalPostings !== undefined ? (
            <p className='panel-subtitle tight'>
              {filteredCount !== undefined
                ? `${filteredCount} matching · ${totalPostings} total in database`
                : `${totalPostings} total in database`}
            </p>
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
      <div className='postings-sticky-toolbar'>
        <div className='filters'>
          <input
            value={postingQuery}
            onChange={(event) => setPostingQuery(event.target.value)}
            placeholder='Search title, company, location'
          />
          <select value={postingSource} onChange={(event) => setPostingSource(event.target.value)}>
            <option value=''>All sources</option>
            {configuredSources?.map((sourceRow) => (
              <option value={sourceRow.source} key={sourceRow.source}>
                {sourceRow.displayName}
              </option>
            ))}
          </select>
          <select
            value={postingRankStatus}
            onChange={(event) => setPostingRankStatus(event.target.value as PostingRankStatus)}
          >
            <option value='all'>All statuses</option>
            <option value='ranked'>Ranked only</option>
            <option value='unranked'>Unranked only</option>
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
            <option value='scoreDesc'>Score (high to low)</option>
            <option value='rankedAtDesc'>Ranked (newest)</option>
            <option value='discoveredAtDesc'>Discovered (newest)</option>
            <option value='postedAtDesc'>Posted (newest)</option>
          </select>
        </div>
        <div className='posting-bulk-toolbar'>
          <label className='posting-list-select-all'>
            <input
              type='checkbox'
              aria-label='Select all visible postings'
              checked={allVisibleSelected}
              disabled={!postings?.length}
              onChange={(event) => onToggleSelectAllVisible(event.target.checked)}
            />
            <span>Select all visible</span>
          </label>
          <div className='actions posting-bulk-actions'>
            <button
              type='button'
              className='btn-success'
              onClick={onBulkScoreSelected}
              disabled={!selectedCount || scoreBusy || isClearing}
            >
              Score selected ({selectedCount})
            </button>
            <button
              type='button'
              className='btn-danger'
              onClick={() => void onBulkDeleteSelected()}
              disabled={!selectedCount || scoreBusy || isClearing || deletingPostingId !== null}
            >
              Delete selected ({selectedCount})
            </button>
          </div>
        </div>
      </div>
      <PostingTable
        postings={postings}
        deletingPostingId={deletingPostingId}
        onDeletePosting={onDeletePosting}
        onOpenScoreDialog={openScoreDialog}
        selectedPostingIds={selectedPostingIds}
        onTogglePostingSelection={onTogglePostingSelection}
        emptyMessage={postingsLoading && !postings.length ? 'Loading…' : 'No postings match these filters.'}
      />
      <div className='postings-pagination' aria-label='Postings pagination'>
        <div className='postings-pagination__inner'>
        <div className='postings-pagination__nav'>
          <button
            type='button'
            className='postings-pagination__arrow'
            onClick={goToPrevPage}
            disabled={!canGoPrev || postingsLoading}
            aria-label='Previous page'
          >
            ←
          </button>
          <span className='postings-pagination__status'>
            {postingsLoading && filteredCount === undefined
              ? 'Loading…'
              : `Page ${currentPage} of ${totalPages}`}
          </span>
          <button
            type='button'
            className='postings-pagination__arrow'
            onClick={goToNextPage}
            disabled={!canGoNext || postingsLoading}
            aria-label='Next page'
          >
            →
          </button>
        </div>
        <label className='postings-page-size'>
          <span className='postings-page-size__label'>Rows per page</span>
          <select
            value={postingPageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value) as PageSizeOption)}
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        </div>
      </div>
      {scoreTargets.length ? (
        <div className='modal-overlay' onClick={closeScoreDialog} role='presentation'>
          <div className='modal-card' onClick={(event) => event.stopPropagation()} role='dialog' aria-modal='true'>
            <div className='modal-header'>
              <h3>{scoreTargets.length === 1 ? 'Score posting' : `Score ${scoreTargets.length} postings`}</h3>
              <button type='button' onClick={closeScoreDialog} disabled={scoreBusy}>
                Close
              </button>
            </div>
            <div className='modal-body'>
              <p className='panel-subtitle tight'>
                {scoreTargets.length === 1 ? (
                  <>
                    <strong>{scoreTargets[0]!.title}</strong>
                    {' · '}
                    {scoreTargets[0]!.company}
                  </>
                ) : (
                    <strong>Selected postings will be scored one by one with the same evaluator/provider/model.</strong>
                )}
              </p>
              <label className='stacked-field' htmlFor='score-criteria-select'>
                Evaluator profile
              </label>
              <select
                id='score-criteria-select'
                className='score-criteria-select'
                value={scoreEvaluatorId}
                onChange={(event) => setScoreEvaluatorId(event.target.value as Id<'job_evaluators'>)}
                disabled={scoreBusy || !evaluatorProfiles?.length}
              >
                {!evaluatorProfiles?.length ? (
                  <option value=''>No profiles yet — create one under Evaluators</option>
                ) : (
                  evaluatorProfiles.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                      {c.isActive ? ' (available)' : ''}
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
              <FilterSelect
                key={scoreProviderKey}
                id='score-model-select'
                label='Model'
                value={scoreApiModelId}
                onChange={setScoreApiModelId}
                options={scoreModelOptions}
                disabled={scoreModelSelectDisabled}
                placeholder='Search models…'
                emptyMessage='No models for this provider'
                noMatchMessage='No models match'
              />
              {scoreHint}
              {selectedProvider?.surface === 'worker_cursor' ? (
                <div className='rank-run-log-panel' aria-live='polite' aria-label='Ranking log'>
                  <div className='rank-run-log-panel__title'>Ranking log</div>
                  {scoreRankLogs.length ? (
                    <pre className='rank-run-log-panel__body'>
                      {scoreRankLogs.join('\n')}
                      <div ref={rankLogEndRef} />
                    </pre>
                  ) : (
                    <p className='rank-run-log-panel__empty'>
                      {scoreBusy ? 'Waiting for llm.rank logs from the worker…' : 'Live llm.rank logs appear here while scoring runs.'}
                    </p>
                  )}
                </div>
              ) : null}
              {scoreDialogError ? <p className='status-text error'>{scoreDialogError}</p> : null}
              <div className='modal-actions-row'>
                <button type='button' onClick={closeScoreDialog} disabled={scoreBusy}>
                  Cancel
                </button>
                <button
                  type='button'
                  className='btn-primary'
                  onClick={() => void onSubmitScore()}
                  disabled={scoreBusy || !evaluatorProfiles?.length || !scoreEvaluatorId || !canRunScore}
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
