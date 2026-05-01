import { mutation, query } from './_generated/server.js';
import { v } from 'convex/values';

type PostingWithRanking = {
  _id: string;
  _creationTime: number;
  source: string;
  externalId: string;
  url: string;
  title: string;
  company: string;
  location?: string;
  salaryText?: string;
  descriptionSnippet?: string;
  postedAt?: number;
  discoveredAt: number;
  scrapeRunId?: string;
  rawPayload?: unknown;
  createdAt: number;
  updatedAt: number;
  latestRanking: {
    scoreOverall: number;
  } | null;
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
        v.literal('postedAtDesc'),
        v.literal('scoreDesc')
      )
    ),
    limit: v.optional(v.number()),
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

      if (sortBy === 'postedAtDesc') {
        return (b.postedAt ?? -1) - (a.postedAt ?? -1);
      }

      return b.discoveredAt - a.discoveredAt;
    });

    const limit = args.limit && args.limit > 0 ? args.limit : 200;
    return postingsWithRanking.slice(0, limit);
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
