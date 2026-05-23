import { APP_SETTING_KEYS, isAppSettingKey } from '@job-bot/shared';
import { v } from 'convex/values';
import type { MutationCtx, QueryCtx } from './_generated/server.js';
import { mutation, query } from './_generated/server.js';

/**
 * Default `workerId` when callers do not pass one (matches `worker_scheduler_status`).
 */
export const DEFAULT_WORKER_ID = 'default';

/**
 * Reactive read of env overrides reported by a worker process (allowlisted keys only).
 */
export const getByWorkerId = query({
  args: {
    workerId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const workerId = args.workerId ?? DEFAULT_WORKER_ID;
    return await ctx.db
      .query('worker_settings_env')
      .withIndex('by_worker_id', (q) => q.eq('workerId', workerId))
      .unique();
  },
});

/**
 * Worker heartbeat: upserts allowlisted non-empty env vars from the worker process.
 * Never stores secrets — keys must be in `APP_SETTING_KEYS`.
 */
export const upsertFromWorker = mutation({
  args: {
    workerId: v.optional(v.string()),
    envOverrides: v.record(v.string(), v.string()),
    reportedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const workerId = args.workerId ?? DEFAULT_WORKER_ID;
    const sanitized: Record<string, string> = {};
    for (const [key, value] of Object.entries(args.envOverrides)) {
      if (!isAppSettingKey(key)) {
        continue;
      }
      if (value.trim() !== '') {
        sanitized[key] = value.trim();
      }
    }

    const existing = await ctx.db
      .query('worker_settings_env')
      .withIndex('by_worker_id', (q) => q.eq('workerId', workerId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        envOverrides: sanitized,
        reportedAt: args.reportedAt,
        updatedAt: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert('worker_settings_env', {
      workerId,
      envOverrides: sanitized,
      reportedAt: args.reportedAt,
      updatedAt: Date.now(),
    });
  },
});
