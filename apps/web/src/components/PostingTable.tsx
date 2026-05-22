import { useEffect, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatHumanizedTime } from '../lib/time';
import {
  parseReasoningScoreTable,
  scoreCellToPercent,
  toPillItems,
} from '../lib/parseReasoningScoreTable.js';
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
/** Formats the headline overall score with a /100 suffix when ranked. */
const formatOverallScore = (score?: number | null): string => {
  if (typeof score !== 'number' || Number.isNaN(score)) {
    return '-';
  }
  return `${score}/100`;
};

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

type ReasoningScoreTableProps = {
  reasoningSummary: string;
};

/**
 * Fallback when reasoning has no parseable GFM table (legacy or non-standard output).
 */
function ReasoningFallback({ content }: { content: string }) {
  const [reasoningExpanded, setReasoningExpanded] = useState(false);
  if (!content) {
    return null;
  }
  if (content.length <= 200) {
    return <ReasoningMarkdown value={content} className='posting-item__reasoning' />;
  }
  return (
    <div className='posting-item__reasoning-fallback'>
      {reasoningExpanded ? (
        <ReasoningMarkdown value={content} className='posting-item__reasoning' />
      ) : (
        <p className='posting-item__reasoning-preview'>{`${content.slice(0, 199)}…`}</p>
      )}
      <button
        type='button'
        className='posting-item__description-toggle'
        onClick={() => setReasoningExpanded((v) => !v)}
        aria-expanded={reasoningExpanded}
      >
        {reasoningExpanded ? 'Show less reasoning' : 'Show reasoning'}
      </button>
    </div>
  );
}

/**
 * Compact rubric table: criteria names as column headers, scores in one row; expand for vertical details table.
 */
function ReasoningScoreTable({ reasoningSummary }: ReasoningScoreTableProps) {
  const [expanded, setExpanded] = useState(false);
  const parsed = useMemo(() => parseReasoningScoreTable(reasoningSummary), [reasoningSummary]);

  if (!parsed) {
    return <ReasoningFallback content={reasoningSummary.trim()} />;
  }

  const { rows, remainderMarkdown } = parsed;

  return (
    <div className='posting-item__score-table-wrap'>
      {expanded ? (
        <table className='posting-score-table posting-score-table--expanded'>
          <thead>
            <tr>
              <th scope='col'>Criteria</th>
              <th scope='col'>Score</th>
              <th scope='col'>Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.name}-${index}`}>
                <td>{row.name}</td>
                <td className={getScoreColorClass(scoreCellToPercent(row.score))}>{row.score}</td>
                <td>{row.details ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className='posting-score-table-scroll'>
            <table className='posting-score-table posting-score-table--compact'>
              <thead>
                <tr>
                  {rows.map((row, index) => (
                    <th key={`${row.name}-${index}`} scope='col'>
                      {row.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {rows.map((row, index) => (
                    <td
                      key={`${row.name}-${index}-score`}
                      className={getScoreColorClass(scoreCellToPercent(row.score))}
                    >
                      {row.score}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
        </div>
      )}
      <button
        type='button'
        className='posting-item__description-toggle'
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {expanded ? 'Hide full scoring table' : 'Show full scoring table'}
      </button>
      {remainderMarkdown ? (
        <ReasoningMarkdown value={remainderMarkdown} className='posting-item__reasoning posting-item__reasoning--remainder' />
      ) : null}
    </div>
  );
}

type CollapsibleBadgeRowProps = {
  label: string;
  items: string[];
  badgeClass: string;
};

/**
 * Single-line flag badges with "+N more" expander when multiple items exist.
 */
function CollapsibleBadgeRow({ label, items, badgeClass }: CollapsibleBadgeRowProps) {
  const [expanded, setExpanded] = useState(false);

  if (items.length === 0) {
    return null;
  }

  const hiddenCount = expanded ? 0 : Math.max(0, items.length - 1);
  const visibleItems = expanded ? items : items.slice(0, 1);

  return (
    <div
      className={`posting-flag-row ${expanded ? 'posting-flag-row--expanded' : 'posting-flag-row--collapsed'}`}
      aria-label={label}
    >
      <span className='posting-flag-row__label'>{label}</span>
      <span className='posting-flag-row__badges'>
        {visibleItems.map((item, index) => (
          <span
            key={`${item}-${index}`}
            className={`posting-item__criteria-badge posting-item__criteria-badge--${badgeClass}`}
            title={item}
          >
            {item}
          </span>
        ))}
        {hiddenCount > 0 ? (
          <button
            type='button'
            className='posting-flag-row__more posting-item__criteria-badge'
            onClick={() => setExpanded(true)}
            aria-expanded={false}
          >
            {hiddenCount} more
          </button>
        ) : null}
        {expanded && items.length > 1 ? (
          <button
            type='button'
            className='posting-flag-row__more posting-item__criteria-badge'
            onClick={() => setExpanded(false)}
            aria-expanded={true}
          >
            Show less
          </button>
        ) : null}
      </span>
    </div>
  );
}

type RankingDetailsProps = {
  ranking: Doc<'job_rankings'> | null;
};

/**
 * Ranking section: compact score table, collapsible flags, model, criteria pills, remainder prose.
 */
function RankingDetails({ ranking }: RankingDetailsProps) {
  if (!ranking) {
    return (
      <div className='posting-item__ranking'>
        <p className='posting-item__ranking-empty'>Not ranked yet</p>
      </div>
    );
  }

  const criteriaMatch =
    ranking.criteriaMatchJson && typeof ranking.criteriaMatchJson === 'object' && !Array.isArray(ranking.criteriaMatchJson)
      ? (ranking.criteriaMatchJson as Record<string, unknown>)
      : null;

  const matchedItems = criteriaMatch ? toPillItems(criteriaMatch.matched) : [];
  const unmetItems = criteriaMatch ? toPillItems(criteriaMatch.unmet) : [];
  const redFlagItems = ranking.redFlags ?? [];

  return (
    <div className='posting-item__ranking'>
      <ReasoningScoreTable reasoningSummary={ranking.reasoningSummary} />
      <CollapsibleBadgeRow label='Green flags' items={matchedItems} badgeClass='matched' />
      <CollapsibleBadgeRow label='Yellow flags' items={unmetItems} badgeClass='unmet' />
      <CollapsibleBadgeRow label='Red flags' items={redFlagItems} badgeClass='red' />
      <p className='posting-item__model-line'>
        <span className='posting-item__model-label'>Model</span> {ranking.model}
      </p>
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
};

export function PostingTable({
  postings,
  emptyMessage = 'No postings match these filters.',
  deletingPostingId,
  onDeletePosting,
  onOpenScoreDialog,
  selectedPostingIds,
  onTogglePostingSelection,
}: PostingTableProps) {
  const showActions = Boolean(onDeletePosting || onOpenScoreDialog);
  const showSelection = Boolean(onTogglePostingSelection);
  const [selectedPostingId, setSelectedPostingId] = useState<string | null>(null);
  const [rawJsonCopyStatus, setRawJsonCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
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
                        {formatOverallScore(scoreOverall)}
                      </span>
                      <span className='posting-item__meta-field posting-item__meta-role-company'>
                        <a
                          className='posting-external-link'
                          href={posting.url}
                          target='_blank'
                          rel='noreferrer'
                        >
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
                  <a
                    className='posting-external-link'
                    href={selectedPosting.url}
                    target='_blank'
                    rel='noreferrer'
                  >
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
