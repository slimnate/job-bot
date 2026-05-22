import { ConvexHttpClient } from 'convex/browser';

import { api } from './convexBridge/api.js';
import { isSchedulerDebug } from './debugFlags.js';
import { workerLog } from './log.js';
import { WorkerOrchestrator } from './orchestrator.js';

export type WorkerSchedulerConfig = {
  intervalMs: number;
  runOnStart: boolean;
  /**
   * Convex client used to persist scheduler status for the dashboard. Required so the
   * UI can render a reactive view backed by `worker_scheduler_status` and detect
   * staleness via the heartbeat field.
   */
  convex: ConvexHttpClient;
  /**
   * Stable identifier for this worker process, used as the singleton key in
   * `worker_scheduler_status`. Defaults to `'default'` when the env var is unset.
   */
  workerId: string;
};

/** Serializable snapshot for `GET /scheduler` and dashboards. */
export type WorkerSchedulerStatus = {
  intervalMs: number;
  intervalMinutes: number;
  runOnStart: boolean;
  /** When `start()` was called; null before start. */
  schedulerStartedAt: number | null;
  /** Wall-clock time of the latest `setInterval` callback (not `run_on_start` / `run_now`). */
  lastIntervalRingAt: number | null;
  /** When the last tick finished successfully (any trigger). */
  lastTickCompletedAt: number | null;
  lastTickTrigger: string | null;
  lastTickDurationMs: number | null;
  lastTickQueueSnapshot: { queued: number; running: number } | null;
  /** Estimated wall time of the next interval-driven tick (`lastIntervalRingAt + intervalMs`), or first ring if none yet. */
  nextIntervalTickAt: number | null;
  timerActive: boolean;
  tickInFlight: boolean;
  lastTickFailedAt: number | null;
  lastTickError: string | null;
};

/**
 * How often the scheduler writes a heartbeat to Convex while the timer is active.
 * Paired with the dashboard's staleness threshold (~90s). The scheduler cron itself
 * runs every 15+ minutes, so sub-minute heartbeats are unnecessary write/bandwidth load.
 */
const HEARTBEAT_INTERVAL_MS = 30_000;

export class WorkerScheduler {
  private readonly orchestrator: WorkerOrchestrator;
  private readonly config: WorkerSchedulerConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * Serializes ticks so they never overlap and none are dropped. Startup / interval / runNow all
   * chain here; previously a concurrent tick was skipped and DB-queued runs could stay unpicked.
   */
  private tail: Promise<void> = Promise.resolve();
  private schedulerStartedAt: number | null = null;
  private lastIntervalRingAt: number | null = null;
  private lastTickCompletedAt: number | null = null;
  private lastTickTrigger: string | null = null;
  private lastTickDurationMs: number | null = null;
  private lastTickQueueSnapshot: { queued: number; running: number } | null = null;
  private tickInFlight = false;
  private lastTickFailedAt: number | null = null;
  private lastTickError: string | null = null;
  /**
   * Guard so a slow Convex roundtrip doesn't cause heartbeats to pile up. When a flush is in
   * flight, subsequent heartbeat ticks are dropped (next ring will pick up the latest state).
   */
  private statusFlushInFlight = false;

  constructor(orchestrator: WorkerOrchestrator, config: WorkerSchedulerConfig) {
    this.orchestrator = orchestrator;
    this.config = config;
  }

  /**
   * Current scheduler state for HTTP `/scheduler` and ops visibility.
   */
  getStatus(): WorkerSchedulerStatus {
    const intervalMinutes = Math.round(this.config.intervalMs / 60_000);
    return {
      intervalMs: this.config.intervalMs,
      intervalMinutes,
      runOnStart: this.config.runOnStart,
      schedulerStartedAt: this.schedulerStartedAt,
      lastIntervalRingAt: this.lastIntervalRingAt,
      lastTickCompletedAt: this.lastTickCompletedAt,
      lastTickTrigger: this.lastTickTrigger,
      lastTickDurationMs: this.lastTickDurationMs,
      lastTickQueueSnapshot: this.lastTickQueueSnapshot,
      nextIntervalTickAt: this.computeNextIntervalTickAt(),
      timerActive: this.timer !== null,
      tickInFlight: this.tickInFlight,
      lastTickFailedAt: this.lastTickFailedAt,
      lastTickError: this.lastTickError,
    };
  }

  private computeNextIntervalTickAt(): number | null {
    if (!this.timer || this.schedulerStartedAt === null) {
      return null;
    }
    if (this.lastIntervalRingAt !== null) {
      return this.lastIntervalRingAt + this.config.intervalMs;
    }
    return this.schedulerStartedAt + this.config.intervalMs;
  }

  start(): void {
    if (this.timer) {
      return;
    }

    this.schedulerStartedAt = Date.now();

    if (this.config.runOnStart) {
      void this.enqueueTick('run_on_start');
    }

    this.timer = setInterval(() => {
      this.lastIntervalRingAt = Date.now();
      void this.enqueueTick('interval');
    }, this.config.intervalMs);

    this.heartbeatTimer = setInterval(() => {
      void this.flushStatus();
    }, HEARTBEAT_INTERVAL_MS);

    void this.flushStatus();
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    void this.flushStatus();
  }

  async runNow(): Promise<void> {
    await this.enqueueTick('run_now');
  }

  private enqueueTick(trigger: string): Promise<void> {
    const job = this.tail.then(async () => {
      this.tickInFlight = true;
      void this.flushStatus();
      const tickStartedAt = Date.now();
      if (isSchedulerDebug()) {
        workerLog.debug('scheduler.tick.begin', {
          trigger,
          tickInFlight: this.tickInFlight,
          queueSnapshot: this.orchestrator.queueSnapshot(),
        });
      }
      try {
        /**
         * Manual queueing mode: only consume runs that already exist in Convex queue.
         * Do not auto-create new runs from scheduler ticks.
         */
        await this.orchestrator.enqueueDbQueuedRuns();
        const snapshot = this.orchestrator.queueSnapshot();
        const completedAt = Date.now();
        this.lastTickCompletedAt = completedAt;
        this.lastTickTrigger = trigger;
        this.lastTickDurationMs = completedAt - tickStartedAt;
        this.lastTickQueueSnapshot = snapshot;
        this.lastTickFailedAt = null;
        this.lastTickError = null;
        workerLog.info('scheduler.tick.complete', {
          trigger,
          durationMs: completedAt - tickStartedAt,
          ...snapshot,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown scheduler error';
        this.lastTickFailedAt = Date.now();
        this.lastTickError = message;
        workerLog.error('scheduler.tick.failed', {
          trigger,
          durationMs: Date.now() - tickStartedAt,
          err: message,
        });
      } finally {
        this.tickInFlight = false;
        void this.flushStatus();
      }
    });
    this.tail = job.catch(() => {});
    return job;
  }

  /**
   * Persists the current status snapshot (plus a fresh `heartbeatAt`) to Convex.
   * Failures are logged as warnings and never bubble — Convex being briefly
   * unreachable must not crash the worker. The `statusFlushInFlight` guard
   * prevents heartbeats from queuing up when Convex is slow.
   */
  private async flushStatus(): Promise<void> {
    if (this.statusFlushInFlight) {
      if (isSchedulerDebug()) {
        workerLog.debug('scheduler.status_flush_skipped', { reason: 'statusFlushInFlight' });
      }
      return;
    }
    this.statusFlushInFlight = true;
    try {
      const snapshot = this.getStatus();
      await this.config.convex.mutation(api.workerScheduler.upsertStatus, {
        workerId: this.config.workerId,
        ...snapshot,
        heartbeatAt: Date.now(),
      });
    } catch (error: unknown) {
      workerLog.warn('scheduler.status_flush_failed', {
        err: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      this.statusFlushInFlight = false;
    }
  }
}

export function loadSchedulerConfigFromEnv(
  env: Record<string, string | undefined>,
  deps: { convex: ConvexHttpClient }
): WorkerSchedulerConfig {
  const intervalMinutesRaw = env.WORKER_CRON_INTERVAL_MINUTES ?? '15';
  const parsed = Number(intervalMinutesRaw);
  const intervalMinutes = Number.isFinite(parsed) && parsed > 0 ? parsed : 15;

  const workerIdRaw = env.WORKER_ID?.trim();
  const workerId = workerIdRaw && workerIdRaw.length > 0 ? workerIdRaw : 'default';

  return {
    intervalMs: intervalMinutes * 60 * 1000,
    runOnStart: env.WORKER_RUN_ON_START !== 'false',
    convex: deps.convex,
    workerId,
  };
}
