import { mutation, query } from './_generated/server.js';
import { v } from 'convex/values';

const rankingResultValidator = v.object({
  postingId: v.id('job_postings'),
  rank: v.number(),
  scoreOverall: v.number(),
  reasoningSummary: v.string(),
  criteriaMatch: v.any(),
  redFlags: v.optional(v.array(v.string())),
});

export const listForPosting = query({
  args: {
    postingId: v.id('job_postings'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit && args.limit > 0 ? args.limit : 20;
    return ctx.db
      .query('job_rankings')
      .withIndex('by_posting_ranked_at', (q) => q.eq('postingId', args.postingId))
      .order('desc')
      .take(limit);
  },
});

export const recompute = mutation({
  args: {
    criteriaId: v.optional(v.id('job_criteria')),
    source: v.optional(v.string()),
    limit: v.optional(v.number()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const criteria =
      (args.criteriaId ? await ctx.db.get(args.criteriaId) : null) ??
      (await ctx.db
        .query('job_criteria')
        .withIndex('by_is_active', (q) => q.eq('isActive', true))
        .first());

    const postings = args.source
      ? await ctx.db
          .query('job_postings')
          .withIndex('by_source_external_id', (q) => q.eq('source', args.source!))
          .collect()
      : await ctx.db.query('job_postings').collect();

    const ordered = postings.sort((a, b) => b.discoveredAt - a.discoveredAt);
    const limit = args.limit && args.limit > 0 ? args.limit : 100;
    const candidatePostings = ordered.slice(0, limit);

    return {
      criteria,
      model: args.model ?? 'llm-default',
      candidates: candidatePostings,
    };
  },
});

export const upsertResults = mutation({
  args: {
    criteriaId: v.optional(v.id('job_criteria')),
    scrapeRunId: v.optional(v.id('scrape_runs')),
    model: v.string(),
    rankedAt: v.optional(v.number()),
    rankings: v.array(rankingResultValidator),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const rankedAt = args.rankedAt ?? now;
    const merged = new Map<
      string,
      (typeof args.rankings)[number]
    >();

    for (const ranking of args.rankings) {
      const key = ranking.postingId;
      const prior = merged.get(key);
      if (!prior || ranking.rank < prior.rank) {
        merged.set(key, ranking);
      }
    }

    const deduped = args.rankings.length - merged.size;

    for (const ranking of merged.values()) {
      await ctx.db.insert('job_rankings', {
        postingId: ranking.postingId,
        criteriaId: args.criteriaId,
        scrapeRunId: args.scrapeRunId,
        rank: ranking.rank,
        scoreOverall: ranking.scoreOverall,
        model: args.model,
        reasoningSummary: ranking.reasoningSummary,
        criteriaMatchJson: ranking.criteriaMatch,
        redFlags: ranking.redFlags,
        rankedAt,
        createdAt: now,
        updatedAt: now,
      });
    }

    return {
      saved: merged.size,
      rankedAt,
      inputCount: args.rankings.length,
      dedupedInBatch: deduped,
    };
  },
});
