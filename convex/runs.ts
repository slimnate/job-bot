import { mutation, query } from './_generated/server.js';
import { v } from 'convex/values';

import type { Id } from './_generated/dataModel.js';

const statsValidator = v.object({
  discoveredCount: v.number(),
  dedupedCount: v.number(),
  insertedCount: v.number(),
  rankedCount: v.number(),
  errorCount: v.number(),
});

export const list = query({
  args: {
    source: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal('queued'),
        v.literal('running'),
        v.literal('succeeded'),
        v.literal('failed'),
        v.literal('cancelled')
      )
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const runs = args.source
      ? await ctx.db
          .query('scrape_runs')
          .withIndex('by_source_started_at', (q) => q.eq('source', args.source!))
          .order('desc')
          .collect()
      : await ctx.db.query('scrape_runs').withIndex('by_started_at').order('desc').collect();

    const statusFiltered = args.status ? runs.filter((run) => run.status === args.status) : runs;
    const limit = args.limit && args.limit > 0 ? args.limit : 50;

    return statusFiltered.slice(0, limit);
  },
});

export const trigger = mutation({
  args: {
    criteriaId: v.optional(v.id('job_criteria')),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const criteria =
      (args.criteriaId ? await ctx.db.get(args.criteriaId) : null) ??
      (await ctx.db
        .query('job_criteria')
        .withIndex('by_is_active', (q) => q.eq('isActive', true))
        .first());

    const resolvedSources = args.source
      ? [args.source]
      : (criteria?.targetSources.length ? criteria.targetSources : ['manual']);

    const triggerRuns: Array<{ runId: Id<'scrape_runs'>; source: string }> = [];
    const runIds: Id<'scrape_runs'>[] = [];

    for (const source of resolvedSources) {
      const runId = await ctx.db.insert('scrape_runs', {
        criteriaId: criteria?._id,
        source,
        status: 'queued',
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      runIds.push(runId);
      triggerRuns.push({ runId, source });
    }

    return {
      criteriaId: criteria?._id ?? null,
      runIds,
      runs: triggerRuns,
    };
  },
});

export const updateQueued = mutation({
  args: {
    runId: v.id('scrape_runs'),
    source: v.optional(v.string()),
    criteriaId: v.optional(v.union(v.id('job_criteria'), v.null())),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) {
      throw new Error('Run not found');
    }
    if (run.status !== 'queued') {
      throw new Error('Only queued runs can be edited');
    }
    if (args.source === undefined && args.criteriaId === undefined) {
      return;
    }

    const now = Date.now();
    const patch: {
      source?: string;
      criteriaId?: typeof run.criteriaId;
      updatedAt: number;
    } = { updatedAt: now };

    if (args.source !== undefined) {
      const trimmed = args.source.trim();
      if (!trimmed) {
        throw new Error('Source cannot be empty');
      }
      patch.source = trimmed;
    }

    if (args.criteriaId !== undefined) {
      if (args.criteriaId === null) {
        patch.criteriaId = undefined;
      } else {
        const criterion = await ctx.db.get(args.criteriaId);
        if (!criterion) {
          throw new Error('Criteria not found');
        }
        patch.criteriaId = args.criteriaId;
      }
    }

    await ctx.db.patch(args.runId, patch);
  },
});

export const updateStatus = mutation({
  args: {
    runId: v.id('scrape_runs'),
    status: v.union(
      v.literal('queued'),
      v.literal('running'),
      v.literal('succeeded'),
      v.literal('failed'),
      v.literal('cancelled')
    ),
    logsSummary: v.optional(v.string()),
    stats: v.optional(statsValidator),
    errorMessage: v.optional(v.string()),
    endedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      status: args.status,
      logsSummary: args.logsSummary,
      stats: args.stats,
      errorMessage: args.errorMessage,
      endedAt: args.endedAt ?? (args.status === 'running' || args.status === 'queued' ? undefined : Date.now()),
      updatedAt: Date.now(),
    });
  },
});
