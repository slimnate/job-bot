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
  v.literal('scoreDesc'),
  v.literal('archivedAtDesc')
);

const archiveVisibilityValidator = v.union(
  v.literal('active'),
  v.literal('archived'),
  v.literal('good'),
  v.literal('bad')
);

type ListSort =
  | 'discoveredAtDesc'
  | 'rankedAtDesc'
  | 'postedAtDesc'
  | 'scoreDesc'
  | 'archivedAtDesc';

type ArchiveVisibility = 'active' | 'archived' | 'good' | 'bad';

type ListFilterArgs = {
  query?: string;
  source?: string;
  company?: string;
  minScore?: number;
  sort?: ListSort;
  rankStatus?: 'ranked' | 'unranked';
  archiveVisibility?: ArchiveVisibility;
};

type ListPageArgs = ListFilterArgs & {
  paginationOpts: { numItems: number; cursor: string | null };
};

function normalizeArchiveVisibility(value: ArchiveVisibility | undefined): ArchiveVisibility {
  return value ?? 'active';
}

function postingMatchesTextQuery(posting: Doc<'job_postings'>, normalizedQuery: string): boolean {
  return [posting.title, posting.company, posting.location ?? '', posting.descriptionSnippet ?? '']
    .join(' ')
    .toLowerCase()
    .includes(normalizedQuery);
}

function postingMatchesCompanyFilter(posting: Doc<'job_postings'>, company: string | undefined): boolean {
  if (!company) {
    return true;
  }
  return posting.company.trim() === company;
}

function postingMatchesArchiveVisibility(
  posting: Doc<'job_postings'>,
  visibility: ArchiveVisibility
): boolean {
  if (visibility === 'active') {
    return posting.archivedAt === undefined;
  }
  if (visibility === 'archived') {
    return posting.archivedAt !== undefined;
  }
  if (visibility === 'good') {
    return posting.archiveLabel === 'good';
  }
  return posting.archiveLabel === 'bad';
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

function postingMatchesListFilters(posting: Doc<'job_postings'>, args: ListFilterArgs): boolean {
  const visibility = normalizeArchiveVisibility(args.archiveVisibility);
  if (!postingMatchesArchiveVisibility(posting, visibility)) {
    return false;
  }
  if (!postingMatchesCompanyFilter(posting, args.company)) {
    return false;
  }
  return postingMatchesRankFilters(posting, args);
}

function comparePostingsForSort(
  a: Doc<'job_postings'>,
  b: Doc<'job_postings'>,
  sortBy: ListSort
): number {
  if (sortBy === 'archivedAtDesc') {
    return (b.archivedAt ?? -1) - (a.archivedAt ?? -1);
  }
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

function applyCompanyFilter<T extends { filter: (fn: (q: FilterApi) => FilterApi) => T }>(
  baseQuery: T,
  company: string | undefined
): T {
  if (!company) {
    return baseQuery;
  }
  return baseQuery.filter((q) => q.eq(q.field('company'), company));
}

function applyArchiveVisibilityFilter<T extends { filter: (fn: (q: FilterApi) => FilterApi) => T }>(
  baseQuery: T,
  visibility: ArchiveVisibility
): T {
  if (visibility === 'active') {
    return baseQuery.filter((q) => q.eq(q.field('archivedAt'), undefined));
  }
  if (visibility === 'archived') {
    return baseQuery.filter((q) => q.neq(q.field('archivedAt'), undefined));
  }
  if (visibility === 'good') {
    return baseQuery.filter((q) => q.eq(q.field('archiveLabel'), 'good'));
  }
  return baseQuery.filter((q) => q.eq(q.field('archiveLabel'), 'bad'));
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
 * Returns postings matching list filters when a free-text query is set (full scan).
 */
async function collectTextSearchMatches(ctx: QueryCtx, args: ListFilterArgs & { query: string }) {
  const normalizedQuery = args.query.trim().toLowerCase();
  const sourceFiltered = args.source
    ? await ctx.db
        .query('job_postings')
        .withIndex('by_source_external_id', (q) => q.eq('source', args.source!))
        .collect()
    : await ctx.db.query('job_postings').collect();

  const sortBy = args.sort ?? 'discoveredAtDesc';
  return sourceFiltered
    .filter((posting) => postingMatchesTextQuery(posting, normalizedQuery))
    .filter((posting) => postingMatchesListFilters(posting, args))
    .sort((a, b) => comparePostingsForSort(a, b, sortBy));
}

function buildIndexedFilteredQuery(ctx: QueryCtx, args: ListFilterArgs) {
  const sortBy = args.sort ?? 'discoveredAtDesc';
  const visibility = normalizeArchiveVisibility(args.archiveVisibility);
  const company = args.company;
  const source = args.source;

  let baseQuery;
  let companyInIndex = false;
  let sourceInIndex = false;

  if (sortBy === 'archivedAtDesc') {
    if (visibility === 'good') {
      baseQuery = ctx.db
        .query('job_postings')
        .withIndex('by_archive_label_archived_at', (q) => q.eq('archiveLabel', 'good'))
        .order('desc');
    } else if (visibility === 'bad') {
      baseQuery = ctx.db
        .query('job_postings')
        .withIndex('by_archive_label_archived_at', (q) => q.eq('archiveLabel', 'bad'))
        .order('desc');
    } else if (company) {
      baseQuery = ctx.db
        .query('job_postings')
        .withIndex('by_company_archived_at', (q) => q.eq('company', company))
        .order('desc');
      companyInIndex = true;
      baseQuery = applyArchiveVisibilityFilter(baseQuery, visibility);
    } else {
      baseQuery = ctx.db.query('job_postings').withIndex('by_archived_at').order('desc');
      baseQuery = applyArchiveVisibilityFilter(baseQuery, visibility);
    }
  } else if (company) {
    if (visibility === 'active') {
      baseQuery = ctx.db
        .query('job_postings')
        .withIndex('by_company', (q) => q.eq('company', company));
      companyInIndex = true;
      baseQuery = applyArchiveVisibilityFilter(baseQuery, visibility);
    } else {
      baseQuery = ctx.db
        .query('job_postings')
        .withIndex('by_company_archived_at', (q) => q.eq('company', company))
        .order('desc');
      companyInIndex = true;
      baseQuery = applyArchiveVisibilityFilter(baseQuery, visibility);
    }
  } else if (sortBy === 'scoreDesc') {
    baseQuery = ctx.db.query('job_postings').withIndex('by_latest_score').order('desc');
    baseQuery = applyArchiveVisibilityFilter(baseQuery, visibility);
  } else if (sortBy === 'rankedAtDesc') {
    baseQuery = ctx.db.query('job_postings').withIndex('by_latest_ranked_at').order('desc');
    baseQuery = applyArchiveVisibilityFilter(baseQuery, visibility);
  } else if (sortBy === 'postedAtDesc') {
    baseQuery = ctx.db.query('job_postings').withIndex('by_posted_at').order('desc');
    baseQuery = applyArchiveVisibilityFilter(baseQuery, visibility);
  } else if (source) {
    baseQuery = ctx.db
      .query('job_postings')
      .withIndex('by_source_discovered_at', (q) => q.eq('source', source))
      .order('desc');
    sourceInIndex = true;
    baseQuery = applyArchiveVisibilityFilter(baseQuery, visibility);
  } else {
    baseQuery = ctx.db.query('job_postings').withIndex('by_discovered_at').order('desc');
    baseQuery = applyArchiveVisibilityFilter(baseQuery, visibility);
  }

  let filtered = applyDenormFilters(baseQuery, args);
  if (source && !sourceInIndex) {
    filtered = applySourceFilter(filtered, source);
  }
  if (company && !companyInIndex) {
    filtered = applyCompanyFilter(filtered, company);
  }
  return filtered;
}

/**
 * Text search path: scan matching postings, sort in memory, return a manual page slice.
 */
async function listPageWithTextSearch(ctx: QueryCtx, args: ListPageArgs) {
  const numItems = capListPageNumItems(args.paginationOpts.numItems);
  const offset = decodeSearchListCursor(args.paginationOpts.cursor);

  const matched = await collectTextSearchMatches(ctx, { ...args, query: args.query! });
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
  const numItems = capListPageNumItems(args.paginationOpts.numItems);
  const filtered = buildIndexedFilteredQuery(ctx, args);

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

const listFilterArgsValidator = {
  pageSize: v.optional(v.number()),
  query: v.optional(v.string()),
  source: v.optional(v.string()),
  company: v.optional(v.string()),
  minScore: v.optional(v.number()),
  sort: v.optional(listSortValidator),
  rankStatus: v.optional(v.union(v.literal('ranked'), v.literal('unranked'))),
  archiveVisibility: v.optional(archiveVisibilityValidator),
};

function normalizeListFilterArgs(args: {
  query?: string;
  source?: string;
  company?: string;
  minScore?: number;
  sort?: ListSort;
  rankStatus?: 'ranked' | 'unranked';
  archiveVisibility?: ArchiveVisibility;
}): ListFilterArgs {
  return {
    query: args.query?.trim() || undefined,
    source: args.source?.trim() || undefined,
    company: args.company?.trim() || undefined,
    minScore: args.minScore,
    sort: args.sort,
    rankStatus: args.rankStatus,
    archiveVisibility: args.archiveVisibility,
  };
}

/**
 * Paginated postings list with preview fields only (see README field contract).
 */
export const listPage = query({
  args: {
    paginationOpts: paginationOptsValidator,
    ...listFilterArgsValidator,
  },
  handler: async (ctx, args) => {
    const filterArgs = normalizeListFilterArgs(args);
    const listArgs: ListPageArgs = {
      paginationOpts: {
        numItems: capListPageNumItems(args.paginationOpts.numItems),
        cursor: args.paginationOpts.cursor,
      },
      ...filterArgs,
    };

    if (filterArgs.query) {
      return await listPageWithTextSearch(ctx, { ...listArgs, query: filterArgs.query });
    }
    return await listPageIndexed(ctx, listArgs);
  },
});

/**
 * Count of postings matching the same filters as `listPage` (for page X of Y).
 */
export const listPageCount = query({
  args: listFilterArgsValidator,
  handler: async (ctx, args) => {
    const filterArgs = normalizeListFilterArgs(args);

    if (filterArgs.query) {
      const matched = await collectTextSearchMatches(ctx, { ...filterArgs, query: filterArgs.query });
      return matched.length;
    }

    const filtered = buildIndexedFilteredQuery(ctx, filterArgs);
    const rows = await filtered.collect();
    return rows.length;
  },
});
