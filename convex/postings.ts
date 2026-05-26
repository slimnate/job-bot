import { mutation, query } from './_generated/server.js';
import { api } from './_generated/api.js';
import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel.js';

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
        v.literal('scoreDesc')
      )
    ),
    limit: v.optional(v.number()),
    rankStatus: v.optional(v.union(v.literal('ranked'), v.literal('unranked'))),
  },
  handler: async (ctx, args) => {
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

      postingsWithRanking.push({
        ...posting,
        latestRanking,
      });
    }

    const sortBy = args.sort ?? 'discoveredAtDesc';
    postingsWithRanking.sort((a, b) => {
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
    return postings.length;
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
        updated += 1;
        continue;
      }

      await ctx.db.insert('job_postings', {
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
      return { deletedPosting: false, deletedRankings: 0 };
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

    await ctx.db.delete(args.postingId);
    return { deletedPosting: true, deletedRankings };
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

    const postingsBatch = await ctx.db.query('job_postings').take(batchSize);
    for (const row of postingsBatch) {
      await ctx.db.delete(row._id);
    }

    const hasMoreRankings = (await ctx.db.query('job_rankings').take(1)).length > 0;
    const hasMorePostings = (await ctx.db.query('job_postings').take(1)).length > 0;
    const hasMore = hasMoreRankings || hasMorePostings;

    if (hasMore) {
      await ctx.scheduler.runAfter(0, api.postings.clearAll, { batchSize });
    }

    return {
      deletedPostings: postingsBatch.length,
      deletedRankings: rankingsBatch.length,
      hasMore,
    };
  },
});
