import { useEffect, useMemo, useState } from 'react';
import { useQuery } from 'convex/react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { FunctionReturnType } from 'convex/server';

import { api } from '../../../../convex/_generated/api.js';
import type { Id } from '../../../../convex/_generated/dataModel.js';
import { formatHumanizedTime } from '../lib/time';
import {
  DimensionScoresCompactTable,
  type DimensionScoresRecord,
} from '../lib/dimensionScoresTable.js';
import {
  parseReasoningScoreTable,
  scoreCellToPercent,
  toPillItems,
} from '../lib/parseReasoningScoreTable.js';

export type PostingTableRow = FunctionReturnType<typeof api.postings.listPage>['page'][number];

const formatDateTime = (timestamp?: number): string => {
  if (!timestamp) {
    return '-';
  }
  return new Date(timestamp).toLocaleString();
};

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

type PostingDescriptionProps = {
  postingId: Id<'job_postings'>;
  descriptionSnippet: string;
};

/**
 * List description with lazy fetch when the server-truncated snippet is expanded.
 */
function PostingDescription({ postingId, descriptionSnippet }: PostingDescriptionProps) {
  const [expanded, setExpanded] = useState(false);
  const isTruncated = descriptionSnippet.endsWith('…');
  const fullDescription = useQuery(
    api.postings.getDescription,
    expanded && isTruncated ? { postingId } : 'skip'
  );

  const displayText = expanded
    ? (fullDescription?.descriptionSnippet ?? descriptionSnippet).trim() || '-'
    : descriptionSnippet.trim() || '-';

  if (!descriptionSnippet.trim() && !expanded) {
    return (
      <div className='posting-item__description'>
        <p className='posting-item__description-text'>-</p>
      </div>
    );
  }

  const wrapperClass = [
    'posting-item__description',
    isTruncated ? 'posting-item__description--expandable' : '',
    isTruncated && expanded ? 'posting-item__description--expanded' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={wrapperClass}>
      <p className='posting-item__description-text'>{displayText}</p>
      {isTruncated ? (
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

function ReasoningFallback({ content }: { content: string }) {
  return <ReasoningMarkdown value={content} className='posting-item__reasoning' />;
}

function ReasoningScoreTable({ reasoningSummary }: ReasoningScoreTableProps) {
  const parsed = useMemo(() => parseReasoningScoreTable(reasoningSummary), [reasoningSummary]);

  if (!parsed) {
    return <ReasoningFallback content={reasoningSummary.trim()} />;
  }

  const { rows, remainderMarkdown } = parsed;

  return (
    <div className='posting-item__score-table-wrap'>
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
      {remainderMarkdown ? (
        <ReasoningMarkdown
          value={remainderMarkdown}
          className='posting-item__reasoning posting-item__reasoning--remainder'
        />
      ) : null}
    </div>
  );
}

type CollapsibleBadgeRowProps = {
  label: string;
  items: string[];
  badgeClass: string;
};

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

type RankingPreview = NonNullable<PostingTableRow['latestRanking']>;

type RankingDetailsProps = {
  postingId: Id<'job_postings'>;
  ranking: RankingPreview | null;
};

/**
 * Ranking section: compact dimension strip from list payload; full table via lazy query on expand.
 */
function RankingDetails({ postingId, ranking }: RankingDetailsProps) {
  const [scoringExpanded, setScoringExpanded] = useState(false);
  const reasoningPayload = useQuery(
    api.ranking.getLatestReasoning,
    scoringExpanded ? { postingId } : 'skip'
  );

  if (!ranking) {
    return (
      <div className='posting-item__ranking'>
        <p className='posting-item__ranking-empty'>Not ranked yet</p>
      </div>
    );
  }

  const criteriaMatch =
    ranking.criteriaMatchJson &&
    typeof ranking.criteriaMatchJson === 'object' &&
    !Array.isArray(ranking.criteriaMatchJson)
      ? (ranking.criteriaMatchJson as Record<string, unknown>)
      : null;

  const matchedItems = criteriaMatch ? toPillItems(criteriaMatch.matched) : [];
  const unmetItems = criteriaMatch ? toPillItems(criteriaMatch.unmet) : [];
  const redFlagItems = ranking.redFlags ?? [];
  const dimensionScores = (ranking.dimensionScoresJson ?? undefined) as DimensionScoresRecord | undefined;
  const hasCompactScores = Boolean(dimensionScores && Object.keys(dimensionScores).length > 0);

  return (
    <div className='posting-item__ranking'>
      {scoringExpanded ? (
        reasoningPayload === undefined ? (
          <p className='posting-item__ranking-empty'>Loading scoring details…</p>
        ) : reasoningPayload?.reasoningSummary ? (
          <ReasoningScoreTable reasoningSummary={reasoningPayload.reasoningSummary} />
        ) : (
          <p className='posting-item__ranking-empty'>No reasoning available.</p>
        )
      ) : hasCompactScores ? (
        <DimensionScoresCompactTable scores={dimensionScores!} getScoreColorClass={getScoreColorClass} />
      ) : null}
      <button
        type='button'
        className='posting-item__description-toggle'
        onClick={() => setScoringExpanded((v) => !v)}
        aria-expanded={scoringExpanded}
      >
        {scoringExpanded ? 'Hide full scoring table' : 'Show full scoring table'}
      </button>
      <CollapsibleBadgeRow label='Green flags' items={matchedItems} badgeClass='matched' />
      <CollapsibleBadgeRow label='Yellow flags' items={unmetItems} badgeClass='unmet' />
      <CollapsibleBadgeRow label='Red flags' items={redFlagItems} badgeClass='red' />
    </div>
  );
}

type ViewPostingModalProps = {
  postingId: Id<'job_postings'>;
  title: string;
  onClose: () => void;
};

function ViewPostingModal({ postingId, title, onClose }: ViewPostingModalProps) {
  const detail = useQuery(api.postings.getDetail, { postingId });
  const [rawJsonCopyStatus, setRawJsonCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  const rawPostingJson = useMemo(
    () => (detail ? JSON.stringify(detail, null, 2) : ''),
    [detail]
  );

  useEffect(() => {
    setRawJsonCopyStatus('idle');
  }, [postingId]);

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

  const posting = detail?.posting;
  const latestRanking = detail?.latestRanking;

  return (
    <div className='modal-overlay' onClick={onClose} role='presentation'>
      <div className='modal-card' onClick={(event) => event.stopPropagation()} role='dialog' aria-modal='true'>
        <div className='modal-header'>
          <h3>{title}</h3>
          <button type='button' onClick={onClose}>
            Close
          </button>
        </div>
        <div className='modal-body'>
          {detail === undefined ? (
            <p className='posting-list-empty'>Loading…</p>
          ) : !posting ? (
            <p className='posting-list-empty'>Posting not found.</p>
          ) : (
            <>
              <dl className='details-grid'>
                <dt>Company</dt>
                <dd>{posting.company}</dd>
                <dt>Location</dt>
                <dd>{posting.location ?? '-'}</dd>
                <dt>Source</dt>
                <dd>{posting.source}</dd>
                <dt>External ID</dt>
                <dd>{posting.externalId}</dd>
                <dt>Posted</dt>
                <dd>{formatDateTime(posting.postedAt)}</dd>
                <dt>Discovered</dt>
                <dd>{formatDateTime(posting.discoveredAt)}</dd>
                <dt>Latest score</dt>
                <dd>{latestRanking?.scoreOverall ?? '-'}</dd>
                <dt>Latest reasoning</dt>
                <dd>
                  <ReasoningMarkdown
                    value={latestRanking?.reasoningSummary}
                    className='details-grid__markdown'
                  />
                </dd>
                <dt>Created</dt>
                <dd>{formatDateTime(posting.createdAt)}</dd>
                <dt>Updated</dt>
                <dd>{formatDateTime(posting.updatedAt)}</dd>
                <dt>Run ID</dt>
                <dd>{posting.scrapeRunId ?? '-'}</dd>
                <dt>URL</dt>
                <dd>
                  <a className='posting-external-link' href={posting.url} target='_blank' rel='noreferrer'>
                    {posting.url}
                  </a>
                </dd>
                <dt>Salary</dt>
                <dd>{posting.salaryText ?? '-'}</dd>
                <dt>Description</dt>
                <dd className='details-grid__description-full'>{posting.descriptionSnippet ?? '-'}</dd>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type PostingTableProps = {
  postings: PostingTableRow[] | undefined;
  emptyMessage?: string;
  deletingPostingId?: string | null;
  onDeletePosting?: (posting: PostingTableRow) => Promise<void>;
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
  const [selectedPostingId, setSelectedPostingId] = useState<Id<'job_postings'> | null>(null);
  const [selectedPostingTitle, setSelectedPostingTitle] = useState('');

  const closeModal = () => {
    setSelectedPostingId(null);
    setSelectedPostingTitle('');
  };

  const openModal = (posting: PostingTableRow) => {
    setSelectedPostingId(posting._id);
    setSelectedPostingTitle(posting.title);
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
                            <button type='button' onClick={() => openModal(posting)}>
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
                    <PostingDescription
                      postingId={posting._id}
                      descriptionSnippet={posting.descriptionSnippet}
                    />
                    <RankingDetails postingId={posting._id} ranking={posting.latestRanking} />
                  </article>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className='posting-list-empty'>{emptyMessage}</p>
        )}
      </div>
      {selectedPostingId ? (
        <ViewPostingModal postingId={selectedPostingId} title={selectedPostingTitle} onClose={closeModal} />
      ) : null}
    </>
  );
}
