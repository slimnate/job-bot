import { v } from 'convex/values';
import { api } from './_generated/api.js';
import { internal } from './_generated/api.js';
import { internalAction, internalMutation, mutation, query } from './_generated/server.js';
import { computeNextRunAt } from '@job-bot/shared';
import { normalizeSourceCriteria, sourceDefinitions, sourceKeyValidator } from './sourceContract.js';

import type { Id } from './_generated/dataModel.js';
import type { MutationCtx } from './_generated/server.js';

const dailyScheduleValidator = v.object({
  kind: v.literal('daily'),
  timeOfDay: v.string(),
  timezone: v.string(),
});

const intervalScheduleValidator = v.object({
  kind: v.literal('interval'),
  intervalHours: v.number(),
});

const onceScheduleValidator = v.object({
  kind: v.literal('once'),
});

const scheduleValidator = v.union(dailyScheduleValidator, intervalScheduleValidator);

/** Accepts one-time runs in addition to recurring schedules (unified run dialog). */
const runScheduleValidator = v.union(
  onceScheduleValidator,
  dailyScheduleValidator,
  intervalScheduleValidator
);

const sourceCriteriaInputValidator = v.optional(v.record(v.string(), v.union(v.string(), v.null())));

function assertValidScheduleShape(schedule: { kind: 'daily'; timeOfDay: string; timezone: string } | { kind: 'interval'; intervalHours: number }): void {
  if (schedule.kind === 'interval') {
    if (!Number.isInteger(schedule.intervalHours) || schedule.intervalHours < 1 || schedule.intervalHours > 168) {
      throw new Error('Interval schedules must use whole hours between 1 and 168.');
    }
    return;
  }
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(schedule.timeOfDay.trim())) {
    throw new Error('Daily schedules require timeOfDay in HH:mm format.');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: schedule.timezone }).format(new Date());
  } catch {
    throw new Error('Daily schedules require a valid IANA timezone.');
  }
}

async function resolveCriteria(
  ctx: MutationCtx,
  args: {
    source: string;
    sourcePresetId?: Id<'source_presets'>;
    sourceCriteria?: Record<string, string | null>;
  }
): Promise<Record<string, string>> {
  let fromPreset: Record<string, string> = {};
  if (args.sourcePresetId) {
    const preset = await ctx.db.get(args.sourcePresetId);
    if (!preset) {
      throw new Error('Source preset not found.');
    }
    if (preset.source !== args.source) {
      throw new Error('Source preset does not match the selected source.');
    }
    fromPreset = preset.sourceCriteria;
  }
  return normalizeSourceCriteria(args.source, { ...fromPreset, ...args.sourceCriteria });
}

async function ensureEvaluatorIsActive(
  ctx: MutationCtx,
  evaluatorId: Id<'job_evaluators'> | undefined
): Promise<void> {
  if (!evaluatorId) {
    return;
  }
  const evaluator = await ctx.db.get(evaluatorId);
  if (!evaluator) {
    throw new Error('Evaluator not found.');
  }
  if (!evaluator.isActive) {
    throw new Error('That evaluator is not available for worker runs (turn on Active on the Evaluators page).');
  }
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('worker_schedules').withIndex('by_updated_at').order('desc').take(200);
  },
});

export const get = query({
  args: { id: v.id('worker_schedules') },
  handler: async (ctx, args) => await ctx.db.get(args.id),
});

/**
 * Unified create entry point for the worker run dialog.
 *
 * - `schedule.kind === 'once'`: enqueues a single `scrape_runs` row immediately
 *   (no `worker_schedules` row is persisted) and best-effort wakes the worker.
 *   Returns `{ kind: 'once', runId }`.
 * - daily / interval: persists a recurring `worker_schedules` row that the cron
 *   `tick` fires on cadence. Returns `{ kind: 'recurring', scheduleId }`.
 *
 * No user-defined name is stored; the UI derives a display label.
 */
export const create = mutation({
  args: {
    source: sourceKeyValidator,
    sourcePresetId: v.optional(v.id('source_presets')),
    sourceCriteria: sourceCriteriaInputValidator,
    evaluatorId: v.optional(v.id('job_evaluators')),
    enableRanking: v.boolean(),
    schedule: runScheduleValidator,
    isEnabled: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args
  ): Promise<
    | { kind: 'once'; runId: Id<'scrape_runs'> }
    | { kind: 'recurring'; scheduleId: Id<'worker_schedules'> }
  > => {
    if (!sourceDefinitions[args.source as keyof typeof sourceDefinitions]) {
      throw new Error(`Unsupported source '${args.source}'.`);
    }
    await ensureEvaluatorIsActive(ctx, args.evaluatorId);
    const normalizedCriteria = await resolveCriteria(ctx, args);

    if (args.schedule.kind === 'once') {
      const enqueue: { runId: Id<'scrape_runs'>; source: string } = await ctx.runMutation(
        internal.runs.enqueueOneTime,
        {
          source: args.source,
          sourceCriteria: normalizedCriteria,
          evaluatorId: args.evaluatorId,
          enableRanking: args.enableRanking,
        }
      );
      await ctx.scheduler.runAfter(0, internal.schedules.wakeWorker, {});
      return { kind: 'once', runId: enqueue.runId };
    }

    assertValidScheduleShape(args.schedule);
    const now = Date.now();
    const nextRunAt = computeNextRunAt(args.schedule, now);

    const scheduleId = await ctx.db.insert('worker_schedules', {
      isEnabled: args.isEnabled ?? true,
      source: args.source,
      sourcePresetId: args.sourcePresetId,
      sourceCriteria: Object.keys(normalizedCriteria).length > 0 ? normalizedCriteria : undefined,
      evaluatorId: args.evaluatorId,
      enableRanking: args.enableRanking,
      schedule: args.schedule,
      nextRunAt,
      createdAt: now,
      updatedAt: now,
    });
    return { kind: 'recurring', scheduleId };
  },
});

export const update = mutation({
  args: {
    id: v.id('worker_schedules'),
    source: sourceKeyValidator,
    sourcePresetId: v.optional(v.union(v.id('source_presets'), v.null())),
    sourceCriteria: sourceCriteriaInputValidator,
    evaluatorId: v.optional(v.union(v.id('job_evaluators'), v.null())),
    enableRanking: v.boolean(),
    schedule: scheduleValidator,
    isEnabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new Error('Schedule not found.');
    }
    if (!sourceDefinitions[args.source as keyof typeof sourceDefinitions]) {
      throw new Error(`Unsupported source '${args.source}'.`);
    }
    assertValidScheduleShape(args.schedule);
    const sourcePresetId = args.sourcePresetId ?? undefined;
    const evaluatorId = args.evaluatorId ?? undefined;
    await ensureEvaluatorIsActive(ctx, evaluatorId);
    const normalizedCriteria = await resolveCriteria(ctx, {
      source: args.source,
      sourcePresetId,
      sourceCriteria: args.sourceCriteria,
    });
    const now = Date.now();

    await ctx.db.patch(args.id, {
      isEnabled: args.isEnabled,
      source: args.source,
      sourcePresetId,
      sourceCriteria: Object.keys(normalizedCriteria).length > 0 ? normalizedCriteria : undefined,
      evaluatorId,
      enableRanking: args.enableRanking,
      schedule: args.schedule,
      nextRunAt: existing.nextRunAt <= now ? computeNextRunAt(args.schedule, now) : existing.nextRunAt,
      updatedAt: now,
    });
    return args.id;
  },
});

export const setEnabled = mutation({
  args: {
    id: v.id('worker_schedules'),
    isEnabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new Error('Schedule not found.');
    }
    const now = Date.now();
    await ctx.db.patch(args.id, {
      isEnabled: args.isEnabled,
      nextRunAt: args.isEnabled ? computeNextRunAt(existing.schedule, now) : existing.nextRunAt,
      updatedAt: now,
    });
    return args.id;
  },
});

export const remove = mutation({
  args: {
    id: v.id('worker_schedules'),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      return { deleted: false };
    }
    await ctx.db.delete(args.id);
    return { deleted: true };
  },
});

export const runNow = mutation({
  args: {
    id: v.id('worker_schedules'),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    runId: Id<'scrape_runs'>;
    source: string;
  }> => {
    const schedule = await ctx.db.get(args.id);
    if (!schedule) {
      throw new Error('Schedule not found.');
    }
    const sourceCriteria = await resolveCriteria(ctx, {
      source: schedule.source,
      sourcePresetId: schedule.sourcePresetId,
      sourceCriteria: schedule.sourceCriteria,
    });
    const enqueue: { runId: Id<'scrape_runs'>; source: string } = await ctx.runMutation(
      internal.runs.triggerFromSchedule,
      {
      scheduleId: schedule._id,
      evaluatorId: schedule.evaluatorId,
      source: schedule.source,
      sourceCriteria,
      enableRanking: schedule.enableRanking,
      }
    );
    const now = Date.now();
    await ctx.db.patch(schedule._id, {
      lastTriggeredAt: now,
      lastRunId: enqueue.runId,
      lastError: undefined,
      nextRunAt: computeNextRunAt(schedule.schedule, now),
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.schedules.wakeWorker, {});
    return enqueue;
  },
});

/**
 * Best-effort worker wake-up call. Safe to fail; worker interval polling still processes queued runs.
 */
export const wakeWorker = internalAction({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(api.appSettings.seedMissingSettings, {});
    const settings = await ctx.runQuery(internal.appSettings.getEffective, {});
    const triggerUrl = settings.VITE_WORKER_TRIGGER_URL?.trim();
    if (!triggerUrl) {
      return { attempted: false, reason: 'missing_trigger_url' as const };
    }
    try {
      const res = await fetch(triggerUrl, { method: 'POST' });
      return { attempted: true, ok: res.ok, status: res.status };
    } catch (error) {
      return {
        attempted: true,
        ok: false,
        status: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

/**
 * Cron-driven evaluator that enqueues due schedules and advances `nextRunAt`.
 */
export const tick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query('worker_schedules')
      .withIndex('by_enabled_and_next_run', (q) => q.eq('isEnabled', true).lte('nextRunAt', now))
      .take(50);

    let enqueued = 0;
    let skippedInFlight = 0;
    let failed = 0;

    for (const schedule of due) {
      try {
        const inFlightStatuses = ['queued', 'running', 'scraping', 'ranking'] as const;
        let hasInFlight = false;
        for (const status of inFlightStatuses) {
          const rows = await ctx.db
            .query('scrape_runs')
            .withIndex('by_schedule_and_status', (q) =>
              q.eq('scheduleId', schedule._id).eq('status', status)
            )
            .take(1);
          if (rows.length > 0) {
            hasInFlight = true;
            break;
          }
        }
        if (hasInFlight) {
          skippedInFlight += 1;
          await ctx.db.patch(schedule._id, {
            lastError: 'Skipped: schedule already has queued or in-progress work.',
            nextRunAt: computeNextRunAt(schedule.schedule, now),
            updatedAt: now,
          });
          continue;
        }

        const sourceCriteria = await resolveCriteria(ctx, {
          source: schedule.source,
          sourcePresetId: schedule.sourcePresetId,
          sourceCriteria: schedule.sourceCriteria,
        });

        const enqueue = await ctx.runMutation(internal.runs.triggerFromSchedule, {
          scheduleId: schedule._id,
          evaluatorId: schedule.evaluatorId,
          source: schedule.source,
          sourceCriteria,
          enableRanking: schedule.enableRanking,
        });
        enqueued += 1;
        await ctx.db.patch(schedule._id, {
          lastTriggeredAt: now,
          lastRunId: enqueue.runId,
          lastError: undefined,
          nextRunAt: computeNextRunAt(schedule.schedule, now),
          updatedAt: now,
        });
      } catch (error) {
        failed += 1;
        await ctx.db.patch(schedule._id, {
          lastError: error instanceof Error ? error.message : String(error),
          nextRunAt: computeNextRunAt(schedule.schedule, now),
          updatedAt: now,
        });
      }
    }

    if (enqueued > 0) {
      await ctx.scheduler.runAfter(0, internal.schedules.wakeWorker, {});
    }

    return {
      scanned: due.length,
      enqueued,
      skippedInFlight,
      failed,
    };
  },
});
