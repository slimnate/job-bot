import { internalMutation, mutation, query } from './_generated/server.js';
import { api, internal } from './_generated/api.js';
import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel.js';
import {
  getLatestRankingForPosting,
  postingListRowValidator,
  toPostingListRow,
} from './postingsListHelpers.js';
import {
  deleteScrapeRunPostingsForPosting,
  linkPostingToScrapeRun,
} from './scrapeRunPostingsHelpers.js';

export { listPage, listPageCount } from './postingsListPage.js';

/** Posting row returned by `list`, with the latest `job_rankings` document attached (or null). */
type PostingWithRanking = Doc<'job_postings'> & {
  latestRanking: Doc<'job_rankings'> | null;
};

const postingInputValidator = v.object({
  source: v.string(),
  externalId: v.string(),
  url: v.string(),
  title: v.string(),
  company: v.string(),
  location: v.optional(v.string()),
  salaryText: v.optional(v.string()),
  descriptionSnippet: v.optional(v.string()),
  postedAt: v.optional(v.number()),
  discoveredAt: v.optional(v.number()),
  scrapeRunId: v.optional(v.id('scrape_runs')),
  rawPayload: v.optional(v.any()),
});

function normalizePostingKey(source: string, externalId: string): { source: string; externalId: string } {
  return {
    source: source.trim().toLowerCase(),
    externalId: externalId.trim(),
  };
}

function dedupeKey(source: string, externalId: string): string {
  return `${source}\0${externalId}`;
}

export const list = query({
  args: {
    query: v.optional(v.string()),
    source: v.optional(v.string()),
    minScore: v.optional(v.number()),
    sort: v.optional(
      v.union(
        v.literal('discoveredAtDesc'),
        v.literal('rankedAtDesc'),
        v.literal('postedAtDesc'),
        v.literal('scoreDesc'),
        v.literal('archivedAtDesc')
      )
    ),
    limit: v.optional(v.number()),
    rankStatus: v.optional(v.union(v.literal('ranked'), v.literal('unranked'))),
    archiveVisibility: v.optional(
      v.union(v.literal('active'), v.literal('archived'), v.literal('good'), v.literal('bad'))
    ),
  },
  handler: async (ctx, args) => {
    const visibility = args.archiveVisibility ?? 'active';
    const sourceFiltered = args.source
      ? await ctx.db
          .query('job_postings')
          .withIndex('by_source_external_id', (q) => q.eq('source', args.source!))
          .collect()
      : await ctx.db.query('job_postings').collect();

    const normalizedQuery = args.query?.trim().toLowerCase();
    const queryFiltered = normalizedQuery
      ? sourceFiltered.filter((posting) =>
          [posting.title, posting.company, posting.location ?? '', posting.descriptionSnippet ?? '']
            .join(' ')
            .toLowerCase()
            .includes(normalizedQuery)
        )
      : sourceFiltered;

    const postingsWithRanking: PostingWithRanking[] = [];
    for (const posting of queryFiltered) {
      const latestRanking =
        (
          await ctx.db
            .query('job_rankings')
            .withIndex('by_posting_ranked_at', (q) => q.eq('postingId', posting._id))
            .order('desc')
            .take(1)
        )[0] ?? null;
      if (args.minScore !== undefined && (latestRanking?.scoreOverall ?? -1) < args.minScore) {
        continue;
      }
      if (args.rankStatus === 'ranked' && !latestRanking) {
        continue;
      }
      if (args.rankStatus === 'unranked' && latestRanking) {
        continue;
      }
      if (visibility === 'active' && posting.archivedAt !== undefined) {
        continue;
      }
      if (visibility === 'archived' && posting.archivedAt === undefined) {
        continue;
      }
      if (visibility === 'good' && posting.archiveLabel !== 'good') {
        continue;
      }
      if (visibility === 'bad' && posting.archiveLabel !== 'bad') {
        continue;
      }

      postingsWithRanking.push({
        ...posting,
        latestRanking,
      });
    }

    const sortBy = args.sort ?? 'discoveredAtDesc';
    postingsWithRanking.sort((a, b) => {
      if (sortBy === 'archivedAtDesc') {
        return (b.archivedAt ?? -1) - (a.archivedAt ?? -1);
      }
      if (sortBy === 'scoreDesc') {
        return (b.latestRanking?.scoreOverall ?? -1) - (a.latestRanking?.scoreOverall ?? -1);
      }

      if (sortBy === 'rankedAtDesc') {
        return (b.latestRanking?.rankedAt ?? -1) - (a.latestRanking?.rankedAt ?? -1);
      }

      if (sortBy === 'postedAtDesc') {
        return (b.postedAt ?? -1) - (a.postedAt ?? -1);
      }

      return b.discoveredAt - a.discoveredAt;
    });

    const limit = args.limit && args.limit > 0 ? args.limit : 200;
    return postingsWithRanking.slice(0, limit);
  },
});

export const count = query({
  args: {},
  handler: async (ctx) => {
    const postings = await ctx.db.query('job_postings').collect();
    return postings.filter((posting) => posting.archivedAt === undefined).length;
  },
});

/** Single posting for worker / dashboard helpers (e.g. one-off rank). */
export const getById = query({
  args: {
    postingId: v.id('job_postings'),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.postingId);
  },
});

/** Full description for a posting (lazy expand on the list UI). */
export const getDescription = query({
  args: {
    postingId: v.id('job_postings'),
  },
  handler: async (ctx, args) => {
    const posting = await ctx.db.get(args.postingId);
    if (!posting) {
      return null;
    }
    return {
      postingId: posting._id,
      descriptionSnippet: posting.descriptionSnippet,
    };
  },
});

/** Full posting + latest ranking for the View modal. */
export const getDetail = query({
  args: {
    postingId: v.id('job_postings'),
  },
  handler: async (ctx, args) => {
    const posting = await ctx.db.get(args.postingId);
    if (!posting) {
      return null;
    }
    const latestRanking = await getLatestRankingForPosting(ctx, posting._id);
    return { posting, latestRanking };
  },
});

/**
 * Postings linked to a scrape run via `scrape_run_postings` (all runs that touched each job, not just the latest).
 */
export const listByScrapeRun = query({
  args: {
    runId: v.id('scrape_runs'),
    limit: v.optional(v.number()),
  },
  returns: v.array(postingListRowValidator),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) {
      return [];
    }

    const cap = args.limit && args.limit > 0 ? Math.min(args.limit, 5_000) : 5_000;
    const links = await ctx.db
      .query('scrape_run_postings')
      .withIndex('by_scrape_run_id', (q) => q.eq('scrapeRunId', args.runId))
      .take(cap);

    const rows: Array<{ discoveredAt: number; row: ReturnType<typeof toPostingListRow> }> = [];
    for (const link of links) {
      const posting = await ctx.db.get(link.postingId);
      if (!posting) {
        continue;
      }
      const latestRanking = await getLatestRankingForPosting(ctx, posting._id);
      rows.push({
        discoveredAt: link.discoveredAt,
        row: toPostingListRow(posting, latestRanking),
      });
    }

    rows.sort((a, b) => b.discoveredAt - a.discoveredAt);
    return rows.map((entry) => entry.row);
  },
});

/**
 * Backfills `scrape_run_postings` from `job_postings.scrapeRunId` (best-effort for data predating the join table).
 * Run once after deploy: `npx convex run internal.postings.backfillScrapeRunPostings`
 */
export const backfillScrapeRunPostings = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize =
      args.batchSize && args.batchSize > 0 ? Math.min(Math.floor(args.batchSize), 200) : 100;
    const result = await ctx.db.query('job_postings').paginate({
      numItems: batchSize,
      cursor: args.cursor ?? null,
    });

    let linked = 0;
    for (const posting of result.page) {
      if (!posting.scrapeRunId) {
        continue;
      }
      const before = await ctx.db
        .query('scrape_run_postings')
        .withIndex('by_scrape_run_and_posting', (q) =>
          q.eq('scrapeRunId', posting.scrapeRunId!).eq('postingId', posting._id)
        )
        .first();
      if (before) {
        continue;
      }
      await linkPostingToScrapeRun(ctx, posting.scrapeRunId, posting._id, posting.discoveredAt);
      linked += 1;
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(0, internal.postings.backfillScrapeRunPostings, {
        cursor: result.continueCursor,
        batchSize,
      });
    }

    return { processed: result.page.length, linked, hasMore: !result.isDone };
  },
});

/**
 * Backfills `latestScoreOverall` / `latestRankedAt` on all postings from ranking history.
 * Run once after deploy: `npx convex run postings:backfillLatestRankingDenorm`
 */
export const backfillLatestRankingDenorm = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize =
      args.batchSize && args.batchSize > 0 ? Math.min(Math.floor(args.batchSize), 200) : 100;
    const result = await ctx.db.query('job_postings').paginate({
      numItems: batchSize,
      cursor: args.cursor ?? null,
    });

    for (const posting of result.page) {
      const latest = await getLatestRankingForPosting(ctx, posting._id);
      await ctx.db.patch(posting._id, {
        latestScoreOverall: latest?.scoreOverall,
        latestRankedAt: latest?.rankedAt,
      });
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(0, internal.postings.backfillLatestRankingDenorm, {
        cursor: result.continueCursor,
        batchSize,
      });
    }

    return { patched: result.page.length, hasMore: !result.isDone };
  },
});

export const upsertBatch = mutation({
  args: {
    postings: v.array(postingInputValidator),
  },
  handler: async (ctx, args) => {
    let inserted = 0;
    let updated = 0;
    let skippedInvalid = 0;
    const now = Date.now();
    const mergedByKey = new Map<string, (typeof args.postings)[number]>();
    const urlByKey = new Map<string, string>();

    for (const posting of args.postings) {
      const { source, externalId } = normalizePostingKey(posting.source, posting.externalId);
      if (!source || !externalId) {
        skippedInvalid += 1;
        continue;
      }

      const key = dedupeKey(source, externalId);
      const normalizedUrl = posting.url.trim();
      if (!normalizedUrl) {
        skippedInvalid += 1;
        continue;
      }

      const priorUrl = urlByKey.get(key);
      if (priorUrl !== undefined && priorUrl !== normalizedUrl) {
        skippedInvalid += 1;
        continue;
      }
      urlByKey.set(key, normalizedUrl);

      mergedByKey.set(key, {
        ...posting,
        source,
        externalId,
        url: normalizedUrl,
        title: posting.title.trim(),
        company: posting.company.trim(),
      });
    }

    const batchDeduped = args.postings.length - mergedByKey.size - skippedInvalid;

    for (const posting of mergedByKey.values()) {
      const existing = await ctx.db
        .query('job_postings')
        .withIndex('by_source_external_id', (q) =>
          q.eq('source', posting.source).eq('externalId', posting.externalId)
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          url: posting.url,
          title: posting.title,
          company: posting.company,
          location: posting.location,
          salaryText: posting.salaryText,
          descriptionSnippet: posting.descriptionSnippet,
          postedAt: posting.postedAt,
          discoveredAt: posting.discoveredAt ?? existing.discoveredAt,
          scrapeRunId: posting.scrapeRunId,
          rawPayload: posting.rawPayload,
          updatedAt: now,
        });
        await linkPostingToScrapeRun(
          ctx,
          posting.scrapeRunId,
          existing._id,
          posting.discoveredAt ?? now
        );
        updated += 1;
        continue;
      }

      const postingId = await ctx.db.insert('job_postings', {
        source: posting.source,
        externalId: posting.externalId,
        url: posting.url,
        title: posting.title,
        company: posting.company,
        location: posting.location,
        salaryText: posting.salaryText,
        descriptionSnippet: posting.descriptionSnippet,
        postedAt: posting.postedAt,
        discoveredAt: posting.discoveredAt ?? now,
        scrapeRunId: posting.scrapeRunId,
        rawPayload: posting.rawPayload,
        createdAt: now,
        updatedAt: now,
      });
      await linkPostingToScrapeRun(ctx, posting.scrapeRunId, postingId, posting.discoveredAt ?? now);
      inserted += 1;
    }

    return {
      inserted,
      updated,
      total: args.postings.length,
      processed: mergedByKey.size,
      batchDeduped,
      skippedInvalid,
    };
  },
});

/**
 * Deletes one posting and all ranking rows linked to that posting.
 */
export const deleteOne = mutation({
  args: {
    postingId: v.id('job_postings'),
  },
  handler: async (ctx, args) => {
    const posting = await ctx.db.get(args.postingId);
    if (!posting) {
      return { deletedPosting: false, deletedRankings: 0, deletedQuestions: 0, deletedCoverLetters: 0 };
    }

    let deletedRankings = 0;
    for (;;) {
      const batch = await ctx.db
        .query('job_rankings')
        .withIndex('by_posting', (q) => q.eq('postingId', args.postingId))
        .take(200);
      if (batch.length === 0) {
        break;
      }
      for (const row of batch) {
        await ctx.db.delete(row._id);
        deletedRankings += 1;
      }
    }

    let deletedQuestions = 0;
    for (;;) {
      const batch = await ctx.db
        .query('posting_questions')
        .withIndex('by_posting_created_at', (q) => q.eq('postingId', args.postingId))
        .take(200);
      if (batch.length === 0) {
        break;
      }
      for (const row of batch) {
        await ctx.db.delete(row._id);
        deletedQuestions += 1;
      }
    }

    let deletedCoverLetters = 0;
    for (;;) {
      const batch = await ctx.db
        .query('posting_cover_letter_outlines')
        .withIndex('by_posting_created_at', (q) => q.eq('postingId', args.postingId))
        .take(200);
      if (batch.length === 0) {
        break;
      }
      for (const row of batch) {
        await ctx.db.delete(row._id);
        deletedCoverLetters += 1;
      }
    }

    const deletedRunLinks = await deleteScrapeRunPostingsForPosting(ctx, args.postingId);

    await ctx.db.delete(args.postingId);
    return {
      deletedPosting: true,
      deletedRankings,
      deletedQuestions,
      deletedCoverLetters,
      deletedRunLinks,
    };
  },
});

/**
 * Clears all postings and ranking rows in bounded batches.
 * Schedules continuation if rows remain after this transaction.
 */
export const clearAll = mutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize =
      args.batchSize && args.batchSize > 0 ? Math.min(Math.floor(args.batchSize), 400) : 200;

    const rankingsBatch = await ctx.db.query('job_rankings').take(batchSize);
    for (const row of rankingsBatch) {
      await ctx.db.delete(row._id);
    }

    const questionsBatch = await ctx.db.query('posting_questions').take(batchSize);
    for (const row of questionsBatch) {
      await ctx.db.delete(row._id);
    }

    const coverLettersBatch = await ctx.db.query('posting_cover_letter_outlines').take(batchSize);
    for (const row of coverLettersBatch) {
      await ctx.db.delete(row._id);
    }

    const runLinksBatch = await ctx.db.query('scrape_run_postings').take(batchSize);
    for (const row of runLinksBatch) {
      await ctx.db.delete(row._id);
    }

    const postingsBatch = await ctx.db.query('job_postings').take(batchSize);
    for (const row of postingsBatch) {
      await ctx.db.delete(row._id);
    }

    const hasMoreRankings = (await ctx.db.query('job_rankings').take(1)).length > 0;
    const hasMoreQuestions = (await ctx.db.query('posting_questions').take(1)).length > 0;
    const hasMoreCoverLetters =
      (await ctx.db.query('posting_cover_letter_outlines').take(1)).length > 0;
    const hasMoreRunLinks = (await ctx.db.query('scrape_run_postings').take(1)).length > 0;
    const hasMorePostings = (await ctx.db.query('job_postings').take(1)).length > 0;
    const hasMore =
      hasMoreRankings || hasMoreQuestions || hasMoreCoverLetters || hasMoreRunLinks || hasMorePostings;

    if (hasMore) {
      await ctx.scheduler.runAfter(0, api.postings.clearAll, { batchSize });
    }

    return {
      deletedPostings: postingsBatch.length,
      deletedRankings: rankingsBatch.length,
      deletedQuestions: questionsBatch.length,
      deletedCoverLetters: coverLettersBatch.length,
      deletedRunLinks: runLinksBatch.length,
      hasMore,
    };
  },
});
