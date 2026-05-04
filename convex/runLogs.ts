import { mutation, query } from './_generated/server.js';
import { v } from 'convex/values';

const logEntry = v.object({
  seq: v.number(),
  line: v.string(),
});

/**
 * Inserts a batch of log lines for a run. The worker assigns `seq` monotonically per run.
 * Chunks may be split across several mutation calls to stay under argument size limits.
 */
export const appendBatch = mutation({
  args: {
    runId: v.id('scrape_runs'),
    entries: v.array(logEntry),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) {
      throw new Error('Run not found');
    }
    for (const entry of args.entries) {
      await ctx.db.insert('run_log_lines', {
        runId: args.runId,
        seq: entry.seq,
        line: entry.line,
      });
    }
  },
});

/**
 * Returns log lines for a run, ordered by `seq` (ascending). Cap keeps reads bounded.
 */
export const listByRun = query({
  args: {
    runId: v.id('scrape_runs'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const cap = args.limit && args.limit > 0 ? Math.min(args.limit, 10_000) : 5_000;
    return await ctx.db
      .query('run_log_lines')
      .withIndex('by_run_and_seq', (q) => q.eq('runId', args.runId))
      .order('asc')
      .take(cap);
  },
});
