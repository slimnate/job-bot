import { mutation, query } from './_generated/server.js';
import { api } from './_generated/api.js';
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

export const get = query({
  args: {
    runId: v.id('scrape_runs'),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.runId);
  },
});

export const trigger = mutation({
  args: {
    criteriaId: v.optional(v.id('job_criteria')),
    source: v.optional(v.string()),
    linkedinSearchQuery: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const criteria =
      (args.criteriaId ? await ctx.db.get(args.criteriaId) : null) ??
      (await ctx.db
        .query('job_criteria')
        .withIndex('by_is_active', (q) => q.eq('isActive', true))
        .first());

    /** Sources are no longer read from criteria; pass `source` explicitly or default to LinkedIn. */
    const resolvedSources = args.source ? [args.source] : ['linkedin'];

    const triggerRuns: Array<{ runId: Id<'scrape_runs'>; source: string }> = [];
    const runIds: Id<'scrape_runs'>[] = [];

    const linkedinQuery =
      args.linkedinSearchQuery === undefined
        ? undefined
        : args.linkedinSearchQuery.trim() === ''
          ? undefined
          : args.linkedinSearchQuery.trim();

    for (const source of resolvedSources) {
      const runId = await ctx.db.insert('scrape_runs', {
        criteriaId: criteria?._id,
        source,
        linkedinSearchQuery: linkedinQuery,
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
    linkedinSearchQuery: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) {
      throw new Error('Run not found');
    }
    if (run.status !== 'queued') {
      throw new Error('Only queued runs can be edited');
    }
    if (
      args.source === undefined &&
      args.criteriaId === undefined &&
      args.linkedinSearchQuery === undefined
    ) {
      return;
    }

    const now = Date.now();
    const patch: {
      source?: string;
      criteriaId?: typeof run.criteriaId;
      linkedinSearchQuery?: string | undefined;
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

    if (args.linkedinSearchQuery !== undefined) {
      if (args.linkedinSearchQuery === null || args.linkedinSearchQuery.trim() === '') {
        patch.linkedinSearchQuery = undefined;
      } else {
        patch.linkedinSearchQuery = args.linkedinSearchQuery.trim();
      }
    }

    await ctx.db.patch(args.runId, patch);
  },
});

/** Move a queued run to the head of the worker’s wait list (larger `startedAt` sorts first in `by_started_at` desc). */
/**
 * Marks every **queued** scrape run with `source === 'linkedin'` as `cancelled`.
 * Used by `scripts/trigger-linkedin-run.mjs` so aborted CLI sessions do not leave LinkedIn work stuck in queue.
 */
export const cancelQueuedLinkedIn = mutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query('scrape_runs')
      .withIndex('by_status', (q) => q.eq('status', 'queued'))
      .collect();
    const now = Date.now();
    let cancelled = 0;
    for (const run of rows) {
      if (run.source.trim().toLowerCase() !== 'linkedin') {
        continue;
      }
      await ctx.db.patch(run._id, {
        status: 'cancelled',
        logsSummary: 'Cancelled (LinkedIn trigger script queue cleanup)',
        updatedAt: now,
        endedAt: now,
      });
      cancelled++;
    }
    return { cancelled };
  },
});

export const bumpQueued = mutation({
  args: {
    runId: v.id('scrape_runs'),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) {
      throw new Error('Run not found');
    }
    if (run.status !== 'queued') {
      throw new Error('Only queued runs can be prioritized');
    }
    const now = Date.now();
    await ctx.db.patch(args.runId, {
      startedAt: now,
      updatedAt: now,
    });
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

/**
 * Marks a running run as stop-requested. The worker may finish in-flight work before terminal status.
 */
export const requestGracefulStop = mutation({
  args: {
    runId: v.id('scrape_runs'),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) {
      throw new Error('Run not found');
    }
    if (run.status !== 'running') {
      throw new Error('Only running runs can be stopped gracefully');
    }

    const now = Date.now();
    await ctx.db.patch(args.runId, {
      logsSummary: `Stop requested at ${new Date(now).toISOString()}; run will finish current pipeline before exit.`,
      updatedAt: now,
    });
    return { accepted: true };
  },
});

/**
 * Deletes one run and all log lines tied to it.
 */
export const deleteRunWithLogs = mutation({
  args: {
    runId: v.id('scrape_runs'),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) {
      return { deletedRun: false, deletedLogs: 0 };
    }

    let deletedLogs = 0;
    for (;;) {
      const logs = await ctx.db
        .query('run_log_lines')
        .withIndex('by_run_and_seq', (q) => q.eq('runId', args.runId))
        .take(200);
      if (logs.length === 0) {
        break;
      }
      for (const row of logs) {
        await ctx.db.delete(row._id);
        deletedLogs += 1;
      }
    }

    await ctx.db.delete(args.runId);
    return { deletedRun: true, deletedLogs };
  },
});

/**
 * Clears all run rows and all run log rows in bounded batches.
 * Schedules continuation while data remains.
 */
export const clearAllRunsAndLogs = mutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize =
      args.batchSize && args.batchSize > 0 ? Math.min(Math.floor(args.batchSize), 400) : 200;

    const logRows = await ctx.db.query('run_log_lines').take(batchSize);
    for (const row of logRows) {
      await ctx.db.delete(row._id);
    }

    const runRows = await ctx.db.query('scrape_runs').withIndex('by_started_at').take(batchSize);
    for (const row of runRows) {
      await ctx.db.delete(row._id);
    }

    const hasMoreLogs = (await ctx.db.query('run_log_lines').take(1)).length > 0;
    const hasMoreRuns = (await ctx.db.query('scrape_runs').withIndex('by_started_at').take(1)).length > 0;
    const hasMore = hasMoreLogs || hasMoreRuns;

    if (hasMore) {
      await ctx.scheduler.runAfter(0, api.runs.clearAllRunsAndLogs, { batchSize });
    }

    return {
      deletedRuns: runRows.length,
      deletedLogs: logRows.length,
      hasMore,
    };
  },
});
