import { internalMutation, mutation, query } from './_generated/server.js';
import { api } from './_generated/api.js';
import { v } from 'convex/values';
import { deleteScrapeRunPostingsForRun } from './scrapeRunPostingsHelpers.js';
import { normalizeSourceCriteria, sourceDefinitions, sourceKeyValidator } from './sourceContract.js';

import type { Doc, Id } from './_generated/dataModel.js';
import type { MutationCtx } from './_generated/server.js';

const statsValidator = v.object({
  discoveredCount: v.number(),
  dedupedCount: v.number(),
  insertedCount: v.number(),
  rankedCount: v.number(),
  errorCount: v.number(),
});

const runStatusValidator = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('scraping'),
  v.literal('ranking'),
  v.literal('succeeded'),
  v.literal('failed'),
  v.literal('cancelled')
);

/** Statuses that mean a run has not reached a terminal state yet. */
const nonTerminalRunStatuses = new Set([
  'queued',
  'running',
  'scraping',
  'ranking',
]);

type TriggeredBy = 'manual' | 'schedule';

/**
 * Resolves a run evaluator and enforces that selected evaluators remain active.
 */
async function resolveRunEvaluator(
  ctx: MutationCtx,
  evaluatorId: Id<'job_evaluators'> | undefined
): Promise<Doc<'job_evaluators'> | null> {
  if (!evaluatorId) {
    return null;
  }
  const row = await ctx.db.get(evaluatorId);
  if (!row) {
    throw new Error('Evaluator not found.');
  }
  if (!row.isActive) {
    throw new Error(
      'That evaluator is not available for worker runs (turn on Active on the Evaluators page), or clear evaluator to use this worker’s default.'
    );
  }
  return row;
}

/**
 * Inserts one queued scrape run after validating source config and criteria.
 */
async function insertQueuedRun(
  ctx: MutationCtx,
  args: {
    source: string;
    sourceCriteria?: Record<string, string | null>;
    evaluatorId?: Id<'job_evaluators'>;
    scheduleId?: Id<'worker_schedules'>;
    triggeredBy: TriggeredBy;
    enableRanking?: boolean;
    now: number;
  }
): Promise<Id<'scrape_runs'>> {
  const source = args.source.trim().toLowerCase();
  if (!sourceDefinitions[source as keyof typeof sourceDefinitions]) {
    throw new Error(`Unsupported source '${source}'.`);
  }
  const sourceConfig = await ctx.db
    .query('job_sources')
    .withIndex('by_source', (q) => q.eq('source', source))
    .unique();
  if (sourceConfig && !sourceConfig.isEnabled) {
    throw new Error(`Source '${source}' is disabled.`);
  }

  const evaluatorForRun = await resolveRunEvaluator(ctx, args.evaluatorId);
  const normalizedCriteria = normalizeSourceCriteria(source, args.sourceCriteria);

  return await ctx.db.insert('scrape_runs', {
    evaluatorId: evaluatorForRun?._id,
    scheduleId: args.scheduleId,
    triggeredBy: args.triggeredBy,
    enableRanking: args.enableRanking,
    source,
    sourceCriteria: Object.keys(normalizedCriteria).length > 0 ? normalizedCriteria : undefined,
    status: 'queued',
    startedAt: args.now,
    createdAt: args.now,
    updatedAt: args.now,
  });
}

export const list = query({
  args: {
    source: v.optional(sourceKeyValidator),
    status: v.optional(runStatusValidator),
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
    evaluatorId: v.optional(v.id('job_evaluators')),
    source: v.optional(sourceKeyValidator),
    sourceCriteria: v.optional(v.record(v.string(), v.union(v.string(), v.null()))),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const evaluatorForRun = await resolveRunEvaluator(ctx, args.evaluatorId);

    const resolvedSources = args.source ? [args.source.trim().toLowerCase()] : ['linkedin'];

    const triggerRuns: Array<{ runId: Id<'scrape_runs'>; source: string }> = [];
    const runIds: Id<'scrape_runs'>[] = [];

    for (const source of resolvedSources) {
      const runId = await insertQueuedRun(ctx, {
        source,
        sourceCriteria: args.sourceCriteria,
        evaluatorId: evaluatorForRun?._id,
        triggeredBy: 'manual',
        now,
      });
      runIds.push(runId);
      triggerRuns.push({ runId, source });
    }

    return {
      evaluatorId: evaluatorForRun?._id ?? null,
      runIds,
      runs: triggerRuns,
    };
  },
});

/**
 * Internal enqueue path used by recurring schedules.
 */
export const triggerFromSchedule = internalMutation({
  args: {
    scheduleId: v.id('worker_schedules'),
    evaluatorId: v.optional(v.id('job_evaluators')),
    source: sourceKeyValidator,
    sourceCriteria: v.optional(v.record(v.string(), v.union(v.string(), v.null()))),
    enableRanking: v.boolean(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const runId = await insertQueuedRun(ctx, {
      source: args.source,
      sourceCriteria: args.sourceCriteria,
      evaluatorId: args.evaluatorId,
      scheduleId: args.scheduleId,
      triggeredBy: 'schedule',
      enableRanking: args.enableRanking,
      now,
    });
    return { runId, source: args.source };
  },
});

/**
 * Internal enqueue path for one-time runs created through the unified run dialog.
 * Inserts a single queued `scrape_runs` row tagged `manual` (no schedule row is
 * persisted) and carries the per-run ranking override from the dialog.
 */
export const enqueueOneTime = internalMutation({
  args: {
    evaluatorId: v.optional(v.id('job_evaluators')),
    source: sourceKeyValidator,
    sourceCriteria: v.optional(v.record(v.string(), v.union(v.string(), v.null()))),
    enableRanking: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const runId = await insertQueuedRun(ctx, {
      source: args.source,
      sourceCriteria: args.sourceCriteria,
      evaluatorId: args.evaluatorId,
      triggeredBy: 'manual',
      enableRanking: args.enableRanking,
      now,
    });
    return { runId, source: args.source };
  },
});

export const updateQueued = mutation({
  args: {
    runId: v.id('scrape_runs'),
    source: v.optional(v.string()),
    evaluatorId: v.optional(v.union(v.id('job_evaluators'), v.null())),
    sourceCriteria: v.optional(v.record(v.string(), v.union(v.string(), v.null()))),
    enableRanking: v.optional(v.boolean()),
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
      args.evaluatorId === undefined &&
      args.sourceCriteria === undefined &&
      args.enableRanking === undefined
    ) {
      return;
    }

    const now = Date.now();
    const patch: {
      source?: string;
      evaluatorId?: typeof run.evaluatorId;
      sourceCriteria?: Record<string, string> | undefined;
      enableRanking?: boolean;
      updatedAt: number;
    } = { updatedAt: now };

    if (args.enableRanking !== undefined) {
      patch.enableRanking = args.enableRanking;
    }

    if (args.source !== undefined) {
      const trimmed = args.source.trim();
      if (!trimmed) {
        throw new Error('Source cannot be empty');
      }
      patch.source = trimmed;
    }

    if (args.evaluatorId !== undefined) {
      if (args.evaluatorId === null) {
        patch.evaluatorId = undefined;
      } else {
        const evaluatorRow = await ctx.db.get(args.evaluatorId);
        if (!evaluatorRow) {
          throw new Error('Evaluator not found');
        }
        if (!evaluatorRow.isActive) {
          throw new Error(
            'That evaluator is not available for worker runs (turn on Active on the Evaluators page), or clear evaluator to use this worker’s default at run time.'
          );
        }
        patch.evaluatorId = args.evaluatorId;
      }
    }

    if (args.sourceCriteria !== undefined) {
      const source = patch.source ?? run.source;
      const normalized = normalizeSourceCriteria(source, args.sourceCriteria);
      patch.sourceCriteria = Object.keys(normalized).length > 0 ? normalized : undefined;
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
    status: runStatusValidator,
    logsSummary: v.optional(v.string()),
    stats: v.optional(statsValidator),
    errorMessage: v.optional(v.string()),
    endedAt: v.optional(v.number()),
    rankingBatchIndex: v.optional(v.number()),
    rankingBatchTotal: v.optional(v.number()),
    linkedinSearchStrategy: v.optional(
      v.union(
        v.literal('ui'),
        v.literal('url_fallback'),
        v.literal('search_url'),
        v.literal('preferences_hub')
      )
    ),
    usedLinkedinUrlFallback: v.optional(v.boolean()),
    linkedinFallbackReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: {
      status: typeof args.status;
      logsSummary?: string;
      stats?: typeof args.stats;
      errorMessage?: string;
      endedAt?: number;
      rankingBatchIndex?: number;
      rankingBatchTotal?: number;
      linkedinSearchStrategy?: typeof args.linkedinSearchStrategy;
      usedLinkedinUrlFallback?: boolean;
      linkedinFallbackReason?: string;
      updatedAt: number;
    } = {
      status: args.status,
      logsSummary: args.logsSummary,
      stats: args.stats,
      errorMessage: args.errorMessage,
      linkedinSearchStrategy: args.linkedinSearchStrategy,
      usedLinkedinUrlFallback: args.usedLinkedinUrlFallback,
      linkedinFallbackReason: args.linkedinFallbackReason,
      updatedAt: Date.now(),
    };

    if (nonTerminalRunStatuses.has(args.status)) {
      patch.endedAt = args.endedAt;
    } else {
      patch.endedAt = args.endedAt ?? Date.now();
    }

    if (args.status === 'ranking') {
      if (args.rankingBatchIndex !== undefined) {
        patch.rankingBatchIndex = args.rankingBatchIndex;
      }
      if (args.rankingBatchTotal !== undefined) {
        patch.rankingBatchTotal = args.rankingBatchTotal;
      }
    } else {
      patch.rankingBatchIndex = undefined;
      patch.rankingBatchTotal = undefined;
    }

    await ctx.db.patch(args.runId, patch);
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
    if (run.status !== 'running' && run.status !== 'scraping' && run.status !== 'ranking') {
      throw new Error('Only in-progress runs can be stopped gracefully');
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

    const deletedRunLinks = await deleteScrapeRunPostingsForRun(ctx, args.runId);

    await ctx.db.delete(args.runId);
    return { deletedRun: true, deletedLogs, deletedRunLinks };
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

    const runLinkRows = await ctx.db.query('scrape_run_postings').take(batchSize);
    for (const row of runLinkRows) {
      await ctx.db.delete(row._id);
    }

    const runRows = await ctx.db.query('scrape_runs').withIndex('by_started_at').take(batchSize);
    for (const row of runRows) {
      await ctx.db.delete(row._id);
    }

    const hasMoreLogs = (await ctx.db.query('run_log_lines').take(1)).length > 0;
    const hasMoreRunLinks = (await ctx.db.query('scrape_run_postings').take(1)).length > 0;
    const hasMoreRuns = (await ctx.db.query('scrape_runs').withIndex('by_started_at').take(1)).length > 0;
    const hasMore = hasMoreLogs || hasMoreRunLinks || hasMoreRuns;

    if (hasMore) {
      await ctx.scheduler.runAfter(0, api.runs.clearAllRunsAndLogs, { batchSize });
    }

    return {
      deletedRuns: runRows.length,
      deletedLogs: logRows.length,
      deletedRunLinks: runLinkRows.length,
      hasMore,
    };
  },
});
