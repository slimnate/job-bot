import { useEffect, useMemo, useState } from 'react';
import { formatHumanizedTime } from '../lib/time';
import type { Id } from '../../../../convex/_generated/dataModel.js';

export type PostingTableRow = {
  _id: Id<'job_postings'>;
  externalId: string;
  url: string;
  title: string;
  company: string;
  source: string;
  location?: string;
  salaryText?: string;
  descriptionSnippet?: string;
  postedAt?: number;
  discoveredAt: number;
  createdAt: number;
  updatedAt: number;
  scrapeRunId?: string;
  rawPayload?: unknown;
  latestRanking: { scoreOverall: number; rankedAt: number } | null;
};

const formatDateTime = (timestamp?: number): string => {
  if (!timestamp) {
    return '-';
  }
  return new Date(timestamp).toLocaleString();
};

const DESCRIPTION_PREVIEW_MAX_CHARS = 140;

/**
 * Keeps table rows scannable while preserving the full text in a tooltip.
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
    postings?.length &&
      postings.every((posting) => selectedPostingIds?.has(posting._id))
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

  return (
    <>
      <div className='table-wrapper'>
        <table>
          <thead>
            <tr>
              {showSelection ? (
                <th className='select-cell'>
                  <input
                    type='checkbox'
                    aria-label='Select all visible postings'
                    checked={allVisibleSelected}
                    onChange={(event) => onToggleSelectAllVisible?.(event.target.checked)}
                  />
                </th>
              ) : null}
              <th>Score</th>
              <th>Role</th>
              <th>Company</th>
              <th>Description</th>
              <th>Source</th>
              <th>Location</th>
              <th className='timestamp-cell'>Ranked</th>
              <th className='timestamp-cell'>Discovered</th>
              {showActions ? <th>Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {postings?.length ? (
              postings.map((posting) => {
                const description = formatDescriptionPreview(posting.descriptionSnippet);
                return (
                  <tr key={posting._id}>
                    {showSelection ? (
                      <td className='select-cell'>
                        <input
                          type='checkbox'
                          aria-label={`Select ${posting.title}`}
                          checked={Boolean(selectedPostingIds?.has(posting._id))}
                          onChange={(event) =>
                            onTogglePostingSelection?.(posting._id, event.target.checked)
                          }
                        />
                      </td>
                    ) : null}
                    <td>{posting.latestRanking?.scoreOverall ?? '-'}</td>
                    <td>
                      <a href={posting.url} target='_blank' rel='noreferrer'>
                        {posting.title}
                      </a>
                    </td>
                    <td>{posting.company}</td>
                    <td className='description-snippet-cell' title={description.full || undefined}>
                      {description.preview}
                    </td>
                    <td>{posting.source}</td>
                    <td>{posting.location ?? '-'}</td>
                    <td className='timestamp-cell'>{formatHumanizedTime(posting.latestRanking?.rankedAt)}</td>
                    <td className='timestamp-cell'>{formatHumanizedTime(posting.discoveredAt)}</td>
                    {showActions ? (
                      <td className='queue-actions-cell'>
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
                      </td>
                    ) : null}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={showSelection ? (showActions ? 10 : 9) : showActions ? 9 : 8}>{emptyMessage}</td>
              </tr>
            )}
          </tbody>
        </table>
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
                <dt>Description snippet</dt>
                <dd>{selectedPosting.descriptionSnippet ?? '-'}</dd>
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
