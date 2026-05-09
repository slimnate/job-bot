import { mutation, query } from './_generated/server.js';
import { v } from 'convex/values';

/**
 * Default `workerId` for the scheduler status row when callers don't pass one.
 * The system currently runs a single worker process; using a stable key keeps
 * the row count at one and lets us extend to multi-worker setups later without
 * a schema change.
 */
const DEFAULT_WORKER_ID = 'default';

/**
 * Validators for the nullable runtime fields of `WorkerSchedulerStatus`. We use
 * `v.union(..., v.null())` instead of `v.optional(...)` so the worker can
 * serialize `WorkerSchedulerStatus` directly without filtering keys.
 */
const nullableNumber = v.union(v.number(), v.null());
const nullableString = v.union(v.string(), v.null());
const nullableQueueSnapshot = v.union(
  v.object({ queued: v.number(), running: v.number() }),
  v.null()
);

/**
 * Reactive read of the persisted scheduler status for the given worker.
 * Returns `null` when the worker has never written a status row yet.
 *
 * We intentionally do NOT compute staleness here (Convex queries must avoid
 * `Date.now()` because it breaks query caching/reactivity). The dashboard
 * compares `heartbeatAt` to a client-side ticker.
 */
export const getStatus = query({
  args: {
    workerId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const workerId = args.workerId ?? DEFAULT_WORKER_ID;
    const row = await ctx.db
      .query('worker_scheduler_status')
      .withIndex('by_worker_id', (q) => q.eq('workerId', workerId))
      .unique();
    return row;
  },
});

/**
 * Worker-side write path: upserts the singleton status row for the worker.
 * Called on scheduler start/stop, tick boundaries, and the 5s heartbeat
 * interval — see `WorkerScheduler.flushStatus` in `apps/worker/src/scheduler.ts`.
 *
 * Edge cases:
 * - First call inserts; subsequent calls patch in place so we don't grow rows.
 * - All nullable runtime fields must be present (use `null`, not `undefined`)
 *   so a clean state (e.g. before the first tick) round-trips correctly.
 */
export const upsertStatus = mutation({
  args: {
    workerId: v.optional(v.string()),
    intervalMs: v.number(),
    intervalMinutes: v.number(),
    runOnStart: v.boolean(),
    schedulerStartedAt: nullableNumber,
    lastIntervalRingAt: nullableNumber,
    lastTickCompletedAt: nullableNumber,
    lastTickTrigger: nullableString,
    lastTickDurationMs: nullableNumber,
    lastTickQueueSnapshot: nullableQueueSnapshot,
    nextIntervalTickAt: nullableNumber,
    timerActive: v.boolean(),
    tickInFlight: v.boolean(),
    lastTickFailedAt: nullableNumber,
    lastTickError: nullableString,
    heartbeatAt: v.number(),
  },
  handler: async (ctx, args) => {
    const { workerId: workerIdArg, ...status } = args;
    const workerId = workerIdArg ?? DEFAULT_WORKER_ID;
    const now = Date.now();

    const existing = await ctx.db
      .query('worker_scheduler_status')
      .withIndex('by_worker_id', (q) => q.eq('workerId', workerId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...status,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert('worker_scheduler_status', {
      workerId,
      ...status,
      updatedAt: now,
    });
  },
});
