import { useEffect, useMemo, useState } from 'react';
import { useAction, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { normalizeCoverLetterUserMessage } from '@job-bot/shared';
import { api } from '../../../../convex/_generated/api.js';
import type { Id } from '../../../../convex/_generated/dataModel.js';
import {
  persistQaLlmSelection,
  readStoredQaModelId,
  readStoredQaProviderKey,
  resolveDefaultQaModelId,
  resolveDefaultQaProviderKey,
  resolveQaPanelEffectiveSettings,
  type QaLlmCatalogProvider,
} from '../lib/resolveQaLlmDefaults.js';
import { formatHumanizedTime } from '../lib/time.js';
import { MarkdownContent } from './MarkdownContent.js';

type PostingCoverLetterPanelProps = {
  postingId: Id<'job_postings'>;
  workerTriggerBaseUrl: string | null;
};

type CoverLetterTurn = FunctionReturnType<typeof api.postingCoverLetters.listForPosting>[number];

type PendingTurn = {
  userMessage: string;
  providerKey: string;
  model: string;
  revisedFromId: Id<'posting_cover_letter_outlines'> | null;
};

type AppSettingsUi = {
  values: Record<string, string>;
};

function truncateSummary(text: string, maxLen = 72): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= maxLen) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLen - 1)}…`;
}

function pendingTurnMatchesRow(pending: PendingTurn, row: CoverLetterTurn): boolean {
  return (
    row.userMessage === pending.userMessage &&
    (row.revisedFromId ?? null) === pending.revisedFromId
  );
}

/**
 * Cover letter outline panel: version accordion with per-version revise, generate form at bottom.
 */
export function PostingCoverLetterPanel({
  postingId,
  workerTriggerBaseUrl,
}: PostingCoverLetterPanelProps) {
  const versions = useQuery(api.postingCoverLetters.listForPosting, { postingId });
  const llmCatalog = useQuery(api.rankingLlmCatalog.listForUi) as QaLlmCatalogProvider[] | undefined;
  const settingsUi = useQuery(api.appSettings.getForUi, {}) as AppSettingsUi | undefined;
  const generateHttp = useAction(api.postingCoverLetters.generateHttp);

  const [providerKey, setProviderKey] = useState('');
  const [apiModelId, setApiModelId] = useState('');
  const [expandedVersionIds, setExpandedVersionIds] = useState<Set<string>>(new Set());
  const [generateUserMessage, setGenerateUserMessage] = useState('');
  const [revisingOutlineId, setRevisingOutlineId] = useState<Id<'posting_cover_letter_outlines'> | null>(
    null
  );
  const [reviseUserMessage, setReviseUserMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pendingTurn, setPendingTurn] = useState<PendingTurn | null>(null);
  const [copyStatusByOutlineId, setCopyStatusByOutlineId] = useState<
    Record<string, 'copied' | 'error'>
  >({});

  const effective = useMemo(
    () => resolveQaPanelEffectiveSettings(settingsUi?.values),
    [settingsUi]
  );
  const catalog = llmCatalog ?? [];
  const catalogEmpty = llmCatalog !== undefined && catalog.length === 0;

  const selectedProvider = useMemo(
    () => catalog.find((p) => p.key === providerKey),
    [catalog, providerKey]
  );

  const providerModels = selectedProvider?.models ?? [];

  const providerByKey = useMemo(() => new Map(catalog.map((p) => [p.key, p])), [catalog]);

  const completedVersions = useMemo(
    () => (versions ?? []).filter((row) => row.status === 'completed'),
    [versions]
  );

  const versionNumberById = useMemo(() => {
    const map = new Map<string, number>();
    (versions ?? []).forEach((row, index) => {
      map.set(row._id, index + 1);
    });
    return map;
  }, [versions]);

  const hasCompletedVersion = completedVersions.length > 0;

  useEffect(() => {
    if (!catalog.length) {
      return;
    }
    const storedProvider = readStoredQaProviderKey();
    const defaultProvider = resolveDefaultQaProviderKey(catalog, effective);
    setProviderKey((prev) => {
      if (prev && catalog.some((p) => p.key === prev)) {
        return prev;
      }
      if (storedProvider && catalog.some((p) => p.key === storedProvider)) {
        return storedProvider;
      }
      return defaultProvider;
    });
  }, [catalog, effective]);

  useEffect(() => {
    if (!selectedProvider?.models.length) {
      return;
    }
    const storedModel = readStoredQaModelId();
    const defaultModel = resolveDefaultQaModelId(selectedProvider, effective);
    setApiModelId((prev) => {
      if (prev && selectedProvider.models.some((m) => m.apiModelId === prev)) {
        return prev;
      }
      if (storedModel && selectedProvider.models.some((m) => m.apiModelId === storedModel)) {
        return storedModel;
      }
      return defaultModel;
    });
  }, [selectedProvider, effective]);

  useEffect(() => {
    if (providerKey && apiModelId) {
      persistQaLlmSelection(providerKey, apiModelId);
    }
  }, [providerKey, apiModelId]);

  /** Default: expand only the latest completed version. */
  useEffect(() => {
    if (!completedVersions.length) {
      return;
    }
    const latestId = completedVersions[completedVersions.length - 1]!._id;
    setExpandedVersionIds((prev) => {
      if (prev.size === 0 || (prev.size === 1 && prev.has(latestId))) {
        return new Set([latestId]);
      }
      return prev;
    });
  }, [completedVersions]);

  /** When a new version is persisted, expand it and collapse others. */
  useEffect(() => {
    if (!pendingTurn || busy || !versions?.length) {
      return;
    }
    const last = versions[versions.length - 1];
    if (pendingTurnMatchesRow(pendingTurn, last)) {
      setPendingTurn(null);
      setError('');
      setRevisingOutlineId(null);
      setReviseUserMessage('');
      if (last.status === 'completed') {
        setExpandedVersionIds(new Set([last._id]));
      }
    }
  }, [versions, pendingTurn, busy]);

  const modelSelectDisabled = busy || !providerModels.length || llmCatalog === undefined || catalogEmpty;
  const canSubmit = !modelSelectDisabled && Boolean(selectedProvider);

  const toggleVersion = (versionId: string) => {
    setExpandedVersionIds((prev) => {
      const next = new Set(prev);
      if (next.has(versionId)) {
        next.delete(versionId);
      } else {
        next.add(versionId);
      }
      return next;
    });
  };

  const focusParentVersion = (parentId: Id<'posting_cover_letter_outlines'>) => {
    setExpandedVersionIds(new Set([parentId]));
    requestAnimationFrame(() => {
      document.getElementById(`cover-letter-version-${parentId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    });
  };

  /** Copies the raw markdown outline to the clipboard. */
  const onCopyOutline = async (outlineId: string, markdown: string) => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopyStatusByOutlineId((prev) => ({ ...prev, [outlineId]: 'copied' }));
      window.setTimeout(() => {
        setCopyStatusByOutlineId((prev) => {
          const next = { ...prev };
          delete next[outlineId];
          return next;
        });
      }, 2000);
    } catch {
      setCopyStatusByOutlineId((prev) => ({ ...prev, [outlineId]: 'error' }));
      window.setTimeout(() => {
        setCopyStatusByOutlineId((prev) => {
          const next = { ...prev };
          delete next[outlineId];
          return next;
        });
      }, 3000);
    }
  };

  const runGeneration = async (
    userMessage: string,
    revisedFromId: Id<'posting_cover_letter_outlines'> | null
  ) => {
    if (!selectedProvider || !apiModelId) {
      setError('Pick a provider and model (populate the catalog if the lists are empty).');
      return;
    }

    const trimmed = userMessage.trim();
    if (revisedFromId && !trimmed) {
      setError('Enter revision instructions.');
      return;
    }

    const normalizedMessage = revisedFromId
      ? trimmed
      : normalizeCoverLetterUserMessage(userMessage);

    const submittedTurn: PendingTurn = {
      userMessage: normalizedMessage,
      providerKey,
      model: apiModelId,
      revisedFromId,
    };

    setBusy(true);
    setError('');
    setPendingTurn(submittedTurn);

    try {
      const requestArgs = {
        postingId,
        userMessage: normalizedMessage,
        providerKey,
        apiModelId,
        revisedFromId: revisedFromId ?? undefined,
      };

      if (selectedProvider.surface === 'convex_http') {
        const result = await generateHttp(requestArgs);
        if (result.kind === 'error') {
          setError(result.message);
        }
        return;
      }

      const base = workerTriggerBaseUrl;
      if (!base) {
        setError(
          'Set VITE_WORKER_TRIGGER_URL in Settings or .env.local to generate via the worker (Cursor CLI).'
        );
        return;
      }

      const res = await fetch(`${base}/cover-letter-outline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postingId,
          userMessage: normalizedMessage,
          providerKey,
          model: apiModelId,
          revisedFromId: revisedFromId ?? undefined,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? `Worker request failed (${res.status}).`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cover letter generation failed.');
    } finally {
      setBusy(false);
    }
  };

  const onGenerateSubmit = async () => {
    await runGeneration(generateUserMessage, null);
    setGenerateUserMessage('');
  };

  const onReviseSubmit = async (parentId: Id<'posting_cover_letter_outlines'>) => {
    const trimmed = reviseUserMessage.trim();
    if (!trimmed) {
      setError('Enter revision instructions.');
      return;
    }
    await runGeneration(trimmed, parentId);
  };

  const onReviseKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
    parentId: Id<'posting_cover_letter_outlines'>
  ) => {
    if (event.key !== 'Enter' || event.ctrlKey) {
      if (event.key === 'Enter' && event.ctrlKey) {
        event.preventDefault();
        const textarea = event.currentTarget;
        const start = textarea.selectionStart ?? 0;
        const end = textarea.selectionEnd ?? 0;
        setReviseUserMessage((prev) => `${prev.slice(0, start)}\n${prev.slice(end)}`);
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 1;
        });
      }
      return;
    }
    event.preventDefault();
    if (canSubmit && !busy) {
      void onReviseSubmit(parentId);
    }
  };

  const showPendingItem =
    pendingTurn &&
    !(
      versions?.length &&
      pendingTurnMatchesRow(pendingTurn, versions[versions.length - 1]!) &&
      !busy
    );

  const pendingParentVersionNumber =
    pendingTurn?.revisedFromId != null
      ? versionNumberById.get(pendingTurn.revisedFromId)
      : undefined;

  const renderVersionItem = (row: CoverLetterTurn, versionNumber: number) => {
    const expanded = expandedVersionIds.has(row._id);
    const providerLabel = providerByKey.get(row.providerKey)?.displayName ?? row.providerKey;
    const headerSummary = truncateSummary(row.userMessage);
    const parentVersionNumber =
      row.revisedFromId != null ? versionNumberById.get(row.revisedFromId) : undefined;
    const isRevisingThis = revisingOutlineId === row._id;
    const copyStatus = copyStatusByOutlineId[row._id];

    return (
      <div
        key={row._id}
        id={`cover-letter-version-${row._id}`}
        className={['cover-letter-version', expanded ? 'cover-letter-version--expanded' : '']
          .filter(Boolean)
          .join(' ')}
      >
        <button
          type='button'
          className='cover-letter-version__header'
          onClick={() => toggleVersion(row._id)}
          aria-expanded={expanded}
        >
          <span className='cover-letter-version__title'>
            Version {versionNumber}
            {parentVersionNumber != null ? (
              <span className='cover-letter-version__revision-tag'> · revision</span>
            ) : null}
          </span>
          <span className='cover-letter-version__summary'>{headerSummary}</span>
          <span className='cover-letter-version__chevron' aria-hidden='true' />
        </button>
        {expanded ? (
          <div className='cover-letter-version__body'>
            {parentVersionNumber != null && row.revisedFromId ? (
              <p className='cover-letter-version__lineage'>
                Revised from{' '}
                <button
                  type='button'
                  className='cover-letter-version__parent-link'
                  onClick={() => focusParentVersion(row.revisedFromId!)}
                >
                  Version {parentVersionNumber}
                </button>
              </p>
            ) : null}
            <div className='cover-letter-version__field'>
              <span className='cover-letter-version__label'>Prompt</span>
              <p className='cover-letter-version__prompt'>{row.userMessage}</p>
            </div>
            {row.status === 'completed' ? (
              <MarkdownContent value={row.outline} className='cover-letter-version__outline' />
            ) : (
              <p className='cover-letter-version__error'>
                {row.errorMessage ?? 'Failed to generate outline.'}
              </p>
            )}
            <div className='cover-letter-version__footer'>
              <p className='cover-letter-version__meta'>
                {formatHumanizedTime(row.createdAt)} · {providerLabel} · {row.model}
              </p>
              {row.status === 'completed' ? (
                <span className='cover-letter-version__actions'>
                  <button
                    type='button'
                    className='cover-letter-version__copy-btn'
                    onClick={() => void onCopyOutline(row._id, row.outline)}
                  >
                    {copyStatus === 'copied'
                      ? 'Copied'
                      : copyStatus === 'error'
                        ? 'Copy failed'
                        : 'Copy'}
                  </button>
                  <button
                    type='button'
                    className='cover-letter-version__revise-btn'
                    disabled={busy}
                    onClick={() => {
                      setRevisingOutlineId((prev) => (prev === row._id ? null : row._id));
                      setReviseUserMessage('');
                      setError('');
                    }}
                  >
                    {isRevisingThis ? 'Cancel revise' : 'Revise'}
                  </button>
                </span>
              ) : null}
            </div>
            {isRevisingThis && row.status === 'completed' ? (
              <div className='cover-letter-compose-form cover-letter-compose-form--inline'>
                <label
                  className='cover-letter-compose-form__label'
                  htmlFor={`cover-letter-revise-${row._id}`}
                >
                  Revision instructions
                </label>
                <textarea
                  id={`cover-letter-revise-${row._id}`}
                  className='cover-letter-compose-form__input'
                  rows={2}
                  value={reviseUserMessage}
                  onChange={(event) => setReviseUserMessage(event.target.value)}
                  disabled={busy}
                  placeholder='Describe changes… (Enter to submit, Ctrl+Enter for new line)'
                  onKeyDown={(event) => onReviseKeyDown(event, row._id)}
                />
                <div className='cover-letter-compose-form__row'>
                  <button
                    type='button'
                    disabled={busy || !canSubmit}
                    onClick={() => void onReviseSubmit(row._id)}
                  >
                    Submit revision
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <section
      id={`posting-cover-letter-panel-${postingId}`}
      className='cover-letter-panel'
      role='region'
      aria-label='Cover letter outline'
    >
      <div className='cover-letter-panel__versions'>
        {versions === undefined ? (
          <p className='cover-letter-panel__empty'>Loading outlines…</p>
        ) : versions.length === 0 && !showPendingItem ? (
          <p className='cover-letter-panel__empty'>
            No cover letter outlines yet. Use the form below to generate one.
          </p>
        ) : (
          <>
            {(versions ?? []).map((row, index) => renderVersionItem(row, index + 1))}
            {showPendingItem ? (
              <div className='cover-letter-version cover-letter-version--expanded cover-letter-version--pending'>
                <div className='cover-letter-version__header cover-letter-version__header--static'>
                  <span className='cover-letter-version__title'>
                    {pendingTurn.revisedFromId ? 'Revising…' : 'Generating…'}
                  </span>
                  <span className='cover-letter-version__summary'>
                    {pendingTurn.revisedFromId && pendingParentVersionNumber != null
                      ? `Revision of Version ${pendingParentVersionNumber} · ${truncateSummary(pendingTurn.userMessage)}`
                      : truncateSummary(pendingTurn.userMessage)}
                  </span>
                </div>
                <div className='cover-letter-version__body'>
                  <p className='cover-letter-panel__pending' aria-live='polite'>
                    {pendingTurn.revisedFromId ? 'Revising outline…' : 'Generating outline…'}
                  </p>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className='cover-letter-panel__footer'>
        <div className='cover-letter-panel__llm-row'>
          <div className='cover-letter-panel__field cover-letter-panel__field--provider'>
            <label className='cover-letter-panel__label' htmlFor={`cover-letter-provider-${postingId}`}>
              Provider
            </label>
            <select
              id={`cover-letter-provider-${postingId}`}
              className='cover-letter-panel__select score-criteria-select'
              value={providerKey}
              onChange={(event) => setProviderKey(event.target.value)}
              disabled={busy || catalogEmpty || llmCatalog === undefined}
            >
              {llmCatalog === undefined ? (
                <option value=''>Loading catalog…</option>
              ) : catalogEmpty ? (
                <option value=''>No providers — run npm run populate:ranking-catalog</option>
              ) : (
                catalog.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.displayName}
                  </option>
                ))
              )}
            </select>
          </div>
          <div className='cover-letter-panel__field cover-letter-panel__field--model'>
            <label className='cover-letter-panel__label' htmlFor={`cover-letter-model-${postingId}`}>
              Model
            </label>
            <select
              key={providerKey}
              id={`cover-letter-model-${postingId}`}
              className='cover-letter-panel__select score-criteria-select'
              value={apiModelId}
              onChange={(event) => setApiModelId(event.target.value)}
              disabled={modelSelectDisabled}
            >
              {llmCatalog === undefined ? (
                <option value=''>Loading catalog…</option>
              ) : !providerModels.length ? (
                <option value=''>No models for this provider</option>
              ) : (
                providerModels.map((m) => (
                  <option key={m.apiModelId} value={m.apiModelId}>
                    {m.displayName}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>
        <div className='cover-letter-compose-form'>
          <label className='cover-letter-compose-form__label' htmlFor={`cover-letter-generate-${postingId}`}>
            {hasCompletedVersion ? 'New outline instructions (optional)' : 'Initial instructions (optional)'}
          </label>
          <textarea
            id={`cover-letter-generate-${postingId}`}
            className='cover-letter-compose-form__input'
            rows={3}
            value={generateUserMessage}
            onChange={(event) => setGenerateUserMessage(event.target.value)}
            disabled={busy}
            placeholder='e.g. Emphasize leadership experience and mention interest in remote work…'
          />
          <div className='cover-letter-compose-form__row'>
            <button
              type='button'
              className='btn-success'
              disabled={busy || !canSubmit}
              onClick={() => void onGenerateSubmit()}
            >
              {hasCompletedVersion ? 'New outline' : 'Generate outline'}
            </button>
          </div>
        </div>

        {error && !showPendingItem ? <p className='cover-letter-panel__error'>{error}</p> : null}
        {error && showPendingItem && !busy ? (
          <p className='cover-letter-panel__error'>{error}</p>
        ) : null}
      </div>
    </section>
  );
}
