import { useEffect, useMemo, useRef, useState } from 'react';
import { useAction, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
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
import { FilterSelect } from './FilterSelect.js';
import { MarkdownContent } from './MarkdownContent.js';

type PostingAskPanelProps = {
  postingId: Id<'job_postings'>;
  workerTriggerBaseUrl: string | null;
};

type QuestionRow = FunctionReturnType<typeof api.postingQuestions.listForPosting>[number];

type PendingTurn = {
  question: string;
  providerKey: string;
  model: string;
};

type AppSettingsUi = {
  values: Record<string, string>;
};

/**
 * Inline “Ask about this job” panel: provider/model pickers, chat thread, and composer.
 */
export function PostingAskPanel({ postingId, workerTriggerBaseUrl }: PostingAskPanelProps) {
  const history = useQuery(api.postingQuestions.listForPosting, { postingId });
  const llmCatalog = useQuery(api.rankingLlmCatalog.listForUi) as QaLlmCatalogProvider[] | undefined;
  const settingsUi = useQuery(api.appSettings.getForUi, {}) as AppSettingsUi | undefined;
  const askHttp = useAction(api.postingQuestions.askHttp);

  const [providerKey, setProviderKey] = useState('');
  const [apiModelId, setApiModelId] = useState('');
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pendingTurn, setPendingTurn] = useState<PendingTurn | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

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

  const modelOptions = useMemo(
    () =>
      providerModels.map((m) => ({
        value: m.apiModelId,
        label: m.displayName,
        sublabel: m.apiModelId,
      })),
    [providerModels]
  );

  const providerByKey = useMemo(() => new Map(catalog.map((p) => [p.key, p])), [catalog]);

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

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [history, pendingTurn, busy]);

  /** Drop the optimistic turn once Convex persists the matching question. */
  useEffect(() => {
    if (!pendingTurn || busy || !history?.length) {
      return;
    }
    const last = history[history.length - 1];
    if (last.question === pendingTurn.question) {
      setPendingTurn(null);
      setError('');
    }
  }, [history, pendingTurn, busy]);

  const onSubmit = async () => {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      setError('Enter a question.');
      return;
    }
    if (!selectedProvider || !apiModelId) {
      setError('Pick a provider and model (populate the catalog if the lists are empty).');
      return;
    }

    const submittedTurn: PendingTurn = {
      question: trimmedQuestion,
      providerKey,
      model: apiModelId,
    };

    setBusy(true);
    setError('');
    setPendingTurn(submittedTurn);
    setQuestion('');

    try {
      if (selectedProvider.surface === 'convex_http') {
        const result = await askHttp({
          postingId,
          question: trimmedQuestion,
          providerKey,
          apiModelId,
        });
        if (result.kind === 'error') {
          setError(result.message);
          return;
        }
        return;
      }

      const base = workerTriggerBaseUrl;
      if (!base) {
        setError(
          'Set VITE_WORKER_TRIGGER_URL in Settings or .env.local to ask via the worker (Cursor CLI).'
        );
        return;
      }

      const res = await fetch(`${base}/ask-posting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postingId,
          question: trimmedQuestion,
          providerKey,
          model: apiModelId,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? `Worker request failed (${res.status}).`);
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ask failed.');
    } finally {
      setBusy(false);
    }
  };

  const modelSelectDisabled = busy || !providerModels.length || llmCatalog === undefined || catalogEmpty;
  const canSubmit = !modelSelectDisabled;

  const onQuestionKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter') {
      return;
    }

    if (event.ctrlKey) {
      event.preventDefault();
      const textarea = event.currentTarget;
      const start = textarea.selectionStart ?? 0;
      const end = textarea.selectionEnd ?? 0;
      setQuestion((prev) => `${prev.slice(0, start)}\n${prev.slice(end)}`);
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 1;
      });
      return;
    }

    event.preventDefault();
    if (canSubmit) {
      void onSubmit();
    }
  };

  const showPendingTurn =
    pendingTurn &&
    !(history?.length && history[history.length - 1]?.question === pendingTurn.question && !busy);

  const hasThread = (history?.length ?? 0) > 0 || showPendingTurn;

  const renderTurn = (row: QuestionRow) => {
    const providerLabel = providerByKey.get(row.providerKey)?.displayName ?? row.providerKey;
    return (
      <li key={row._id} className='posting-ask__turn'>
        <div className='posting-ask__bubble posting-ask__bubble--user'>
          <p className='posting-ask__bubble-text'>{row.question}</p>
        </div>
        {row.status === 'completed' ? (
          <div className='posting-ask__bubble posting-ask__bubble--assistant'>
            <MarkdownContent value={row.answer} className='posting-ask__answer' />
            <p className='posting-ask__bubble-meta'>
              {formatHumanizedTime(row.createdAt)} · {providerLabel} · {row.model}
            </p>
          </div>
        ) : (
          <div className='posting-ask__bubble posting-ask__bubble--assistant posting-ask__bubble--error'>
            <p className='posting-ask__bubble-text'>{row.errorMessage ?? 'Failed to get an answer.'}</p>
          </div>
        )}
      </li>
    );
  };

  return (
    <section
      id={`posting-ask-panel-${postingId}`}
      className='posting-ask'
      role='region'
      aria-label='Ask about this job'
    >
      <div className='posting-ask__llm-row'>
        <div className='posting-ask__field posting-ask__field--provider'>
          <label className='posting-ask__label' htmlFor={`ask-provider-${postingId}`}>
            Provider
          </label>
          <select
            id={`ask-provider-${postingId}`}
            className='posting-ask__select score-criteria-select'
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
        <div className='posting-ask__field posting-ask__field--model'>
          <FilterSelect
            key={providerKey}
            id={`ask-model-${postingId}`}
            label='Model'
            value={apiModelId}
            onChange={setApiModelId}
            options={modelOptions}
            disabled={modelSelectDisabled}
            placeholder='Search models…'
            emptyMessage='No models for this provider'
            noMatchMessage='No models match'
            className='posting-ask__model-select'
          />
        </div>
      </div>

      <div className='posting-ask__thread' role='log' aria-label='Question and answer history'>
        {history === undefined ? (
          <p className='posting-ask__thread-empty'>Loading conversation…</p>
        ) : !hasThread ? (
          <p className='posting-ask__thread-empty'>Ask a question about this posting below.</p>
        ) : (
          <ul className='posting-ask__thread-list'>
            {history.map((row: QuestionRow) => renderTurn(row))}
            {showPendingTurn ? (
              <li className='posting-ask__turn'>
                <div className='posting-ask__bubble posting-ask__bubble--user'>
                  <p className='posting-ask__bubble-text'>{pendingTurn.question}</p>
                </div>
                {busy ? (
                  <p className='posting-ask__thread-typing posting-ask__thread-typing--turn' aria-live='polite'>
                    Thinking…
                  </p>
                ) : error ? (
                  <div className='posting-ask__bubble posting-ask__bubble--assistant posting-ask__bubble--error'>
                    <p className='posting-ask__bubble-text'>{error}</p>
                  </div>
                ) : null}
              </li>
            ) : null}
          </ul>
        )}
        <div ref={threadEndRef} />
      </div>

      <div className='posting-ask__composer'>
        <textarea
          id={`ask-question-${postingId}`}
          className='posting-ask__question'
          rows={2}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          disabled={busy}
          placeholder='Ask a question… (Enter to send, Ctrl+Enter for new line)'
          aria-label='Message'
          onKeyDown={onQuestionKeyDown}
        />
        {error && !showPendingTurn ? <p className='posting-ask__error'>{error}</p> : null}
      </div>
    </section>
  );
}
