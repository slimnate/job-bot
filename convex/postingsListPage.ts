import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import { query } from './_generated/server.js';
import type { Doc } from './_generated/dataModel.js';
import type { QueryCtx } from './_generated/server.js';
import {
  capListPageNumItems,
  decodeSearchListCursor,
  encodeSearchListCursor,
  getLatestRankingForPosting,
  toPostingListRow,
  type PostingListRow,
} from './postingsListHelpers.js';

const listSortValidator = v.union(
  v.literal('discoveredAtDesc'),
  v.literal('rankedAtDesc'),
  v.literal('postedAtDesc'),
  v.literal('scoreDesc')
);

type ListSort = 'discoveredAtDesc' | 'rankedAtDesc' | 'postedAtDesc' | 'scoreDesc';

type ListPageArgs = {
  paginationOpts: { numItems: number; cursor: string | null };
  query?: string;
  source?: string;
  minScore?: number;
  sort?: ListSort;
  rankStatus?: 'ranked' | 'unranked';
};

function postingMatchesTextQuery(posting: Doc<'job_postings'>, normalizedQuery: string): boolean {
  return [posting.title, posting.company, posting.location ?? '', posting.descriptionSnippet ?? '']
    .join(' ')
    .toLowerCase()
    .includes(normalizedQuery);
}

function postingMatchesRankFilters(
  posting: Doc<'job_postings'>,
  args: Pick<ListPageArgs, 'minScore' | 'rankStatus'>
): boolean {
  const score = posting.latestScoreOverall;
  const ranked = posting.latestRankedAt !== undefined;
  if (args.minScore !== undefined && (score ?? -1) < args.minScore) {
    return false;
  }
  if (args.rankStatus === 'ranked' && !ranked) {
    return false;
  }
  if (args.rankStatus === 'unranked' && ranked) {
    return false;
  }
  return true;
}

function comparePostingsForSort(
  a: Doc<'job_postings'>,
  b: Doc<'job_postings'>,
  sortBy: ListSort
): number {
  if (sortBy === 'scoreDesc') {
    return (b.latestScoreOverall ?? -1) - (a.latestScoreOverall ?? -1);
  }
  if (sortBy === 'rankedAtDesc') {
    return (b.latestRankedAt ?? -1) - (a.latestRankedAt ?? -1);
  }
  if (sortBy === 'postedAtDesc') {
    return (b.postedAt ?? -1) - (a.postedAt ?? -1);
  }
  return b.discoveredAt - a.discoveredAt;
}

/**
 * Applies rank-status and min-score filters using denormalized posting fields.
 */
function applyDenormFilters<T extends { filter: (fn: (q: FilterApi) => FilterApi) => T }>(
  baseQuery: T,
  args: Pick<ListPageArgs, 'minScore' | 'rankStatus'>
): T {
  let next = baseQuery;
  if (args.rankStatus === 'ranked') {
    next = next.filter((q) => q.neq(q.field('latestRankedAt'), undefined));
  }
  if (args.rankStatus === 'unranked') {
    next = next.filter((q) => q.eq(q.field('latestRankedAt'), undefined));
  }
  if (args.minScore !== undefined) {
    const minScore = args.minScore;
    next = next.filter((q) => q.gte(q.field('latestScoreOverall'), minScore));
  }
  return next;
}

function applySourceFilter<T extends { filter: (fn: (q: FilterApi) => FilterApi) => T }>(
  baseQuery: T,
  source: string | undefined
): T {
  if (!source) {
    return baseQuery;
  }
  return baseQuery.filter((q) => q.eq(q.field('source'), source));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FilterApi = any;

async function attachRankingPreviews(
  ctx: QueryCtx,
  postings: Doc<'job_postings'>[]
): Promise<PostingListRow[]> {
  const rows: PostingListRow[] = [];
  for (const posting of postings) {
    const latestRanking = await getLatestRankingForPosting(ctx, posting._id);
    rows.push(toPostingListRow(posting, latestRanking));
  }
  return rows;
}

/**
 * Text search path: scan matching postings, sort in memory, return a manual page slice.
 */
async function listPageWithTextSearch(ctx: QueryCtx, args: ListPageArgs) {
  const normalizedQuery = args.query!.trim().toLowerCase();
  const numItems = capListPageNumItems(args.paginationOpts.numItems);
  const offset = decodeSearchListCursor(args.paginationOpts.cursor);

  const sourceFiltered = args.source
    ? await ctx.db
        .query('job_postings')
        .withIndex('by_source_external_id', (q) => q.eq('source', args.source!))
        .collect()
    : await ctx.db.query('job_postings').collect();

  const sortBy = args.sort ?? 'discoveredAtDesc';
  const matched = sourceFiltered
    .filter((posting) => postingMatchesTextQuery(posting, normalizedQuery))
    .filter((posting) => postingMatchesRankFilters(posting, args))
    .sort((a, b) => comparePostingsForSort(a, b, sortBy));

  const pagePostings = matched.slice(offset, offset + numItems);
  const page = await attachRankingPreviews(ctx, pagePostings);
  const nextOffset = offset + pagePostings.length;
  const isDone = nextOffset >= matched.length;

  return {
    page,
    isDone,
    continueCursor: isDone ? '' : encodeSearchListCursor(nextOffset),
  };
}

/**
 * Index-backed paginated list when no free-text query is set.
 */
async function listPageIndexed(ctx: QueryCtx, args: ListPageArgs) {
  const sortBy = args.sort ?? 'discoveredAtDesc';
  const numItems = capListPageNumItems(args.paginationOpts.numItems);

  let baseQuery;
  if (sortBy === 'scoreDesc') {
    baseQuery = ctx.db.query('job_postings').withIndex('by_latest_score').order('desc');
  } else if (sortBy === 'rankedAtDesc') {
    baseQuery = ctx.db.query('job_postings').withIndex('by_latest_ranked_at').order('desc');
  } else if (sortBy === 'postedAtDesc') {
    baseQuery = ctx.db.query('job_postings').withIndex('by_posted_at').order('desc');
  } else if (args.source) {
    baseQuery = ctx.db
      .query('job_postings')
      .withIndex('by_source_discovered_at', (q) => q.eq('source', args.source!))
      .order('desc');
  } else {
    baseQuery = ctx.db.query('job_postings').withIndex('by_discovered_at').order('desc');
  }

  let filtered = applyDenormFilters(baseQuery, args);
  if (args.source && sortBy !== 'discoveredAtDesc') {
    filtered = applySourceFilter(filtered, args.source);
  }

  const result = await filtered.paginate({
    numItems,
    cursor: args.paginationOpts.cursor,
  });

  const page = await attachRankingPreviews(ctx, result.page);
  return {
    page,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}

/**
 * Paginated postings list with preview fields only (see README field contract).
 */
export const listPage = query({
  args: {
    paginationOpts: paginationOptsValidator,
    pageSize: v.optional(v.number()),
    query: v.optional(v.string()),
    source: v.optional(v.string()),
    minScore: v.optional(v.number()),
    sort: v.optional(listSortValidator),
    rankStatus: v.optional(v.union(v.literal('ranked'), v.literal('unranked'))),
  },
  handler: async (ctx, args) => {
    const normalizedQuery = args.query?.trim().toLowerCase();
    const listArgs: ListPageArgs = {
      paginationOpts: {
        numItems: capListPageNumItems(args.paginationOpts.numItems),
        cursor: args.paginationOpts.cursor,
      },
      query: normalizedQuery || undefined,
      source: args.source?.trim() || undefined,
      minScore: args.minScore,
      sort: args.sort,
      rankStatus: args.rankStatus,
    };

    if (normalizedQuery) {
      return await listPageWithTextSearch(ctx, listArgs);
    }
    return await listPageIndexed(ctx, listArgs);
  },
});
