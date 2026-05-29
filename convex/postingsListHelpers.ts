import type { Doc, Id } from './_generated/dataModel.js';
import type { MutationCtx, QueryCtx } from './_generated/server.js';
import { dimensionScoresPartialValidator } from './rankingValidators.js';
import { v } from 'convex/values';

/** Matches web `DESCRIPTION_PREVIEW_MAX_CHARS`. */
export const DESCRIPTION_LIST_PREVIEW_MAX_CHARS = 140;

export const LIST_PAGE_MAX_ITEMS = 100;

export const postingListRankingPreviewValidator = v.object({
  scoreOverall: v.number(),
  rankedAt: v.number(),
  criteriaMatchJson: v.any(),
  redFlags: v.optional(v.array(v.string())),
  dimensionScoresJson: v.optional(dimensionScoresPartialValidator),
});

export const postingListRowValidator = v.object({
  _id: v.id('job_postings'),
  title: v.string(),
  company: v.string(),
  url: v.string(),
  location: v.optional(v.string()),
  source: v.string(),
  salaryText: v.optional(v.string()),
  discoveredAt: v.number(),
  createdAt: v.number(),
  descriptionSnippet: v.string(),
  archivedAt: v.optional(v.number()),
  archiveLabel: v.optional(v.union(v.literal('good'), v.literal('bad'))),
  latestRanking: v.union(v.null(), postingListRankingPreviewValidator),
});

export type PostingListRow = {
  _id: Id<'job_postings'>;
  title: string;
  company: string;
  url: string;
  location?: string;
  source: string;
  salaryText?: string;
  discoveredAt: number;
  createdAt: number;
  descriptionSnippet: string;
  archivedAt?: number;
  archiveLabel?: 'good' | 'bad';
  latestRanking: {
    scoreOverall: number;
    rankedAt: number;
    criteriaMatchJson: unknown;
    redFlags?: string[];
    dimensionScoresJson?: Doc<'job_rankings'>['dimensionScoresJson'];
  } | null;
};

/**
 * Truncates description text for list payloads (full text via `postings.getDescription`).
 */
export function truncateDescriptionForList(descriptionSnippet?: string): string {
  const full = (descriptionSnippet ?? '').trim();
  if (!full) {
    return '';
  }
  if (full.length <= DESCRIPTION_LIST_PREVIEW_MAX_CHARS) {
    return full;
  }
  return `${full.slice(0, DESCRIPTION_LIST_PREVIEW_MAX_CHARS - 1)}…`;
}

/**
 * Loads the most recent ranking row for a posting.
 */
export async function getLatestRankingForPosting(
  ctx: QueryCtx,
  postingId: Id<'job_postings'>
): Promise<Doc<'job_rankings'> | null> {
  return (
    (
      await ctx.db
        .query('job_rankings')
        .withIndex('by_posting_ranked_at', (q) => q.eq('postingId', postingId))
        .order('desc')
        .take(1)
    )[0] ?? null
  );
}

/**
 * Maps a posting + optional latest ranking into the list-page row shape.
 */
export function toPostingListRow(
  posting: Doc<'job_postings'>,
  latestRanking: Doc<'job_rankings'> | null
): PostingListRow {
  return {
    _id: posting._id,
    title: posting.title,
    company: posting.company,
    url: posting.url,
    location: posting.location,
    source: posting.source,
    salaryText: posting.salaryText,
    discoveredAt: posting.discoveredAt,
    createdAt: posting.createdAt,
    descriptionSnippet: truncateDescriptionForList(posting.descriptionSnippet),
    archivedAt: posting.archivedAt,
    archiveLabel: posting.archiveLabel,
    latestRanking: latestRanking
      ? {
          scoreOverall: latestRanking.scoreOverall,
          rankedAt: latestRanking.rankedAt,
          criteriaMatchJson: latestRanking.criteriaMatchJson,
          redFlags: latestRanking.redFlags,
          dimensionScoresJson: latestRanking.dimensionScoresJson,
        }
      : null,
  };
}

/**
 * Patches denormalized latest-ranking fields on a posting when a new ranking is saved.
 */
export async function patchPostingLatestRankingDenorm(
  ctx: MutationCtx,
  postingId: Id<'job_postings'>,
  rankedAt: number,
  scoreOverall: number
): Promise<void> {
  const posting = await ctx.db.get(postingId);
  if (!posting) {
    return;
  }
  const priorRankedAt = posting.latestRankedAt ?? 0;
  if (priorRankedAt > rankedAt) {
    return;
  }
  await ctx.db.patch(postingId, {
    latestScoreOverall: scoreOverall,
    latestRankedAt: rankedAt,
  });
}

const SEARCH_CURSOR_PREFIX = 'search:';

export function encodeSearchListCursor(offset: number): string {
  return `${SEARCH_CURSOR_PREFIX}${offset}`;
}

export function decodeSearchListCursor(cursor: string | null): number {
  if (!cursor?.startsWith(SEARCH_CURSOR_PREFIX)) {
    return 0;
  }
  const parsed = Number.parseInt(cursor.slice(SEARCH_CURSOR_PREFIX.length), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function capListPageNumItems(numItems: number): number {
  if (!Number.isFinite(numItems) || numItems < 1) {
    return 20;
  }
  return Math.min(Math.floor(numItems), LIST_PAGE_MAX_ITEMS);
}
