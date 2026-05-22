import { useEffect, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatHumanizedTime } from '../lib/time';
import type { Doc } from '../../../../convex/_generated/dataModel.js';

export type PostingTableRow = Doc<'job_postings'> & {
  latestRanking: Doc<'job_rankings'> | null;
};

const formatDateTime = (timestamp?: number): string => {
  if (!timestamp) {
    return '-';
  }
  return new Date(timestamp).toLocaleString();
};

/**
 * Maps score ranges to semantic color classes for quick scanning.
 */
const getScoreColorClass = (score?: number | null): string => {
  if (typeof score !== 'number' || Number.isNaN(score)) {
    return 'posting-item__score--neutral';
  }
  if (score >= 80) {
    return 'posting-item__score--green';
  }
  if (score >= 70) {
    return 'posting-item__score--blue';
  }
  if (score >= 60) {
    return 'posting-item__score--yellow';
  }
  return 'posting-item__score--red';
};

const DESCRIPTION_PREVIEW_MAX_CHARS = 140;

/**
 * Keeps description previews scannable while preserving the full text in a tooltip.
 */
const formatDescriptionPreview = (descriptionSnippet?: string): { preview: string; full: string } => {
  const full = (descriptionSnippet ?? '').trim();
  if (!full) {
    return { preview: '-', full: '' };
  }
  if (full.length <= DESCRIPTION_PREVIEW_MAX_CHARS) {
    return { preview: full, full };
  }
  return { preview: `${full.slice(0, DESCRIPTION_PREVIEW_MAX_CHARS - 1)}…`, full };
};

type PostingDescriptionProps = {
  descriptionSnippet?: string;
};

/**
 * Compact description line with optional expand/collapse when the snippet is longer than the preview cap.
 * Preserves line breaks from the scraper when showing the full text.
 */
function PostingDescription({ descriptionSnippet }: PostingDescriptionProps) {
  const { preview, full } = formatDescriptionPreview(descriptionSnippet);
  const [expanded, setExpanded] = useState(false);
  const expandable = full.length > DESCRIPTION_PREVIEW_MAX_CHARS;

  if (!full) {
    return (
      <div className='posting-item__description'>
        <p className='posting-item__description-text'>-</p>
      </div>
    );
  }

  const wrapperClass = [
    'posting-item__description',
    expandable ? 'posting-item__description--expandable' : '',
    expandable && expanded ? 'posting-item__description--expanded' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={wrapperClass}>
      <p className='posting-item__description-text'>{expanded ? full : preview}</p>
      {expandable ? (
        <button
          type='button'
          className='posting-item__description-toggle'
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? 'Show less' : 'Show full description'}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Normalizes unknown arrays into display-ready string items.
 */
const toPillItems = (value: unknown): string[] => {
  let rawValue = value;
  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        rawValue = JSON.parse(trimmed);
      } catch {
        return [];
      }
    } else {
      return [];
    }
  }
  if (!Array.isArray(rawValue)) {
    return [];
  }
  return rawValue
    .map((item) => {
      if (typeof item === 'string') {
        return item.trim();
      }
      if (item === null || item === undefined) {
        return '';
      }
      return String(item).trim();
    })
    .filter(Boolean);
};

/**
 * Renders `criteriaMatchJson` as compact labeled lines when it is a non-array object.
 */
function CriteriaMatchDetails({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, v]) => v !== undefined && v !== null && v !== ''
  );
  if (entries.length === 0) {
    return null;
  }
  return (
    <div className='posting-item__criteria'>
      {entries.map(([key, val]) => (
        <div key={key} className='posting-item__criteria-row'>
          {key === 'matched' || key === 'unmet' ? null : (
            <span className='posting-item__criteria-key'>{key}</span>
          )}
          {key === 'matched' || key === 'unmet' ? (
            (() => {
              const pillItems = toPillItems(val);
              if (pillItems.length === 0) {
                return <span className='posting-item__criteria-val'>-</span>;
              }
              return (
                <span className='posting-item__criteria-badge-list'>
                  {pillItems.map((item, index) => (
                    <span
                      key={`${key}-${item}-${index}`}
                      className={`posting-item__criteria-badge posting-item__criteria-badge--${key}`}
                    >
                      {item}
                    </span>
                  ))}
                </span>
              );
            })()
          ) : (
            <span className='posting-item__criteria-val'>
              {typeof val === 'object' ? JSON.stringify(val) : String(val)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

type RankingDetailsProps = {
  ranking: Doc<'job_rankings'> | null;
};

type ReasoningMarkdownProps = {
  value?: string | null;
  className?: string;
};

/**
 * Renders LLM reasoning as markdown with GFM tables enabled.
 */
function ReasoningMarkdown({ value, className }: ReasoningMarkdownProps) {
  const content = value?.trim();
  if (!content) {
    return <span className={className}>-</span>;
  }
  return (
    <div className={className}>
      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
    </div>
  );
}

/**
 * Third row of each posting card: model, reasoning, criteria breakdown, red flags.
 */
function RankingDetails({ ranking }: RankingDetailsProps) {
  if (!ranking) {
    return (
      <div className='posting-item__ranking'>
        <p className='posting-item__ranking-empty'>Not ranked yet</p>
      </div>
    );
  }

  return (
    <div className='posting-item__ranking'>
      <ReasoningMarkdown value={ranking.reasoningSummary} className='posting-item__reasoning' />
      <p className='posting-item__model-line'>
        <span className='posting-item__model-label'>Model</span> {ranking.model}
      </p>
      <CriteriaMatchDetails value={ranking.criteriaMatchJson} />
      {ranking.redFlags && ranking.redFlags.length > 0 ? (
        <div className='posting-item__red-flags' aria-label='Red flags'>
          {ranking.redFlags.map((flag, index) => (
            <span key={`${flag}-${index}`} className='posting-item__criteria-badge posting-item__criteria-badge--red'>
              {flag}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type PostingTableProps = {
  postings: PostingTableRow[] | undefined;
  emptyMessage?: string;
  deletingPostingId?: string | null;
  onDeletePosting?: (posting: PostingTableRow) => Promise<void>;
  /** When set, shows a **Score** action that opens the manual scoring flow (postings page). */
  onOpenScoreDialog?: (posting: PostingTableRow) => void;
  selectedPostingIds?: Set<string>;
  onTogglePostingSelection?: (postingId: string, checked: boolean) => void;
  onToggleSelectAllVisible?: (checked: boolean) => void;
};

export function PostingTable({
  postings,
  emptyMessage = 'No postings match these filters.',
  deletingPostingId,
  onDeletePosting,
  onOpenScoreDialog,
  selectedPostingIds,
  onTogglePostingSelection,
  onToggleSelectAllVisible,
}: PostingTableProps) {
  const showActions = Boolean(onDeletePosting || onOpenScoreDialog);
  const showSelection = Boolean(onTogglePostingSelection);
  const [selectedPostingId, setSelectedPostingId] = useState<string | null>(null);
  const [rawJsonCopyStatus, setRawJsonCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const allVisibleSelected = Boolean(
    postings?.length && postings.every((posting) => selectedPostingIds?.has(posting._id))
  );
  const selectedPosting = useMemo(
    () => postings?.find((posting) => posting._id === selectedPostingId) ?? null,
    [postings, selectedPostingId]
  );

  const rawPostingJson = useMemo(
    () => (selectedPosting ? JSON.stringify(selectedPosting, null, 2) : ''),
    [selectedPosting]
  );

  useEffect(() => {
    setRawJsonCopyStatus('idle');
  }, [selectedPostingId]);

  const closeModal = () => setSelectedPostingId(null);

  const copyRawPostingJson = async () => {
    if (!rawPostingJson) {
      return;
    }
    try {
      await navigator.clipboard.writeText(rawPostingJson);
      setRawJsonCopyStatus('copied');
      window.setTimeout(() => setRawJsonCopyStatus('idle'), 2000);
    } catch {
      setRawJsonCopyStatus('error');
      window.setTimeout(() => setRawJsonCopyStatus('idle'), 3000);
    }
  };

  const onDelete = async (posting: PostingTableRow) => {
    const confirmed = window.confirm(`Delete '${posting.title}' from postings?`);
    if (!confirmed) {
      return;
    }
    if (!onDeletePosting) {
      return;
    }
    await onDeletePosting(posting);
    if (selectedPostingId === posting._id) {
      closeModal();
    }
  };

  const hasRows = Boolean(postings?.length);

  return (
    <>
      <div className='table-wrapper'>
        {showSelection ? (
          <div className='posting-list-toolbar'>
            <label className='posting-list-select-all'>
              <input
                type='checkbox'
                aria-label='Select all visible postings'
                checked={allVisibleSelected}
                onChange={(event) => onToggleSelectAllVisible?.(event.target.checked)}
              />
              <span>Select all visible</span>
            </label>
          </div>
        ) : null}
        {hasRows ? (
          <ul className='posting-list'>
            {postings!.map((posting) => {
              const scoreOverall = posting.latestRanking?.scoreOverall;
              const scoreColorClass = getScoreColorClass(scoreOverall);
              return (
                <li key={posting._id}>
                  <article className='posting-item' aria-label={`Posting: ${posting.title}`}>
                    {showSelection || showActions ? (
                      <div className='posting-item__controls'>
                        {showSelection ? (
                          <span className='posting-item__controls-selection'>
                            <input
                              type='checkbox'
                              aria-label={`Select ${posting.title}`}
                              checked={Boolean(selectedPostingIds?.has(posting._id))}
                              onChange={(event) =>
                                onTogglePostingSelection?.(posting._id, event.target.checked)
                              }
                            />
                          </span>
                        ) : null}
                        {showActions ? (
                          <span className='posting-item__controls-actions'>
                            <button type='button' onClick={() => setSelectedPostingId(posting._id)}>
                              View
                            </button>
                            {onOpenScoreDialog ? (
                              <button
                                type='button'
                                className='btn-success'
                                onClick={() => onOpenScoreDialog(posting)}
                              >
                                Score
                              </button>
                            ) : null}
                            {onDeletePosting ? (
                              <button
                                type='button'
                                className='btn-danger'
                                onClick={() => void onDelete(posting)}
                                disabled={deletingPostingId === posting._id}
                              >
                                {deletingPostingId === posting._id ? 'Deleting…' : 'Delete'}
                              </button>
                            ) : null}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    <div className='posting-item__meta'>
                      <span className={`posting-item__meta-field posting-item__meta-score ${scoreColorClass}`}>
                        {scoreOverall ?? '-'}
                      </span>
                      <span className='posting-item__meta-field posting-item__meta-role-company'>
                        <a href={posting.url} target='_blank' rel='noreferrer'>
                          {posting.title}
                        </a>
                        {` - ${posting.company}`}
                      </span>
                      <span className='posting-item__meta-field'>
                        <span className='posting-item__meta-label'>Salary</span> {posting.salaryText ?? '-'}
                      </span>
                      <span className='posting-item__meta-field'>
                        <span className='posting-item__meta-label'>Source</span> {posting.source}
                      </span>
                      <span className='posting-item__meta-field'>
                        <span className='posting-item__meta-label'>Location</span>{' '}
                        {posting.location ?? '-'}
                      </span>
                      <span className='posting-item__meta-field posting-item__meta-time'>
                        <span className='posting-item__meta-label'>Ranked</span>{' '}
                        {formatHumanizedTime(posting.latestRanking?.rankedAt)}
                      </span>
                      <span className='posting-item__meta-field posting-item__meta-time'>
                        <span className='posting-item__meta-label'>Discovered</span>{' '}
                        {formatHumanizedTime(posting.discoveredAt)}
                      </span>
                    </div>
                    <PostingDescription descriptionSnippet={posting.descriptionSnippet} />
                    <RankingDetails ranking={posting.latestRanking} />
                  </article>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className='posting-list-empty'>{emptyMessage}</p>
        )}
      </div>
      {selectedPosting ? (
        <div className='modal-overlay' onClick={closeModal} role='presentation'>
          <div className='modal-card' onClick={(event) => event.stopPropagation()} role='dialog' aria-modal='true'>
            <div className='modal-header'>
              <h3>{selectedPosting.title}</h3>
              <button type='button' onClick={closeModal}>
                Close
              </button>
            </div>
            <div className='modal-body'>
              <dl className='details-grid'>
                <dt>Company</dt>
                <dd>{selectedPosting.company}</dd>
                <dt>Location</dt>
                <dd>{selectedPosting.location ?? '-'}</dd>
                <dt>Source</dt>
                <dd>{selectedPosting.source}</dd>
                <dt>External ID</dt>
                <dd>{selectedPosting.externalId}</dd>
                <dt>Posted</dt>
                <dd>{formatDateTime(selectedPosting.postedAt)}</dd>
                <dt>Discovered</dt>
                <dd>{formatDateTime(selectedPosting.discoveredAt)}</dd>
                <dt>Latest score</dt>
                <dd>{selectedPosting.latestRanking?.scoreOverall ?? '-'}</dd>
                <dt>Latest reasoning</dt>
                <dd>
                  <ReasoningMarkdown
                    value={selectedPosting.latestRanking?.reasoningSummary}
                    className='details-grid__markdown'
                  />
                </dd>
                <dt>Created</dt>
                <dd>{formatDateTime(selectedPosting.createdAt)}</dd>
                <dt>Updated</dt>
                <dd>{formatDateTime(selectedPosting.updatedAt)}</dd>
                <dt>Run ID</dt>
                <dd>{selectedPosting.scrapeRunId ?? '-'}</dd>
                <dt>URL</dt>
                <dd>
                  <a href={selectedPosting.url} target='_blank' rel='noreferrer'>
                    {selectedPosting.url}
                  </a>
                </dd>
                <dt>Salary</dt>
                <dd>{selectedPosting.salaryText ?? '-'}</dd>
                <dt>Description</dt>
                <dd className='details-grid__description-full'>
                  {selectedPosting.descriptionSnippet ?? '-'}
                </dd>
              </dl>
              <details>
                <summary>Raw JSON</summary>
                <div className='raw-json-toolbar'>
                  <button type='button' onClick={() => void copyRawPostingJson()}>
                    {rawJsonCopyStatus === 'copied'
                      ? 'Copied'
                      : rawJsonCopyStatus === 'error'
                        ? 'Copy failed — try again'
                        : 'Copy to clipboard'}
                  </button>
                </div>
                <pre className='run-log-dump'>{rawPostingJson}</pre>
              </details>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
