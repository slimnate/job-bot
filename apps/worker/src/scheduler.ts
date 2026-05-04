import { workerLog } from './log.js';
import { WorkerOrchestrator } from './orchestrator.js';

export type WorkerSchedulerConfig = {
  intervalMs: number;
  runOnStart: boolean;
};

export class WorkerScheduler {
  private readonly orchestrator: WorkerOrchestrator;
  private readonly config: WorkerSchedulerConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  /**
   * Serializes ticks so they never overlap and none are dropped. Startup / interval / runNow all
   * chain here; previously a concurrent tick was skipped and DB-queued runs could stay unpicked.
   */
  private tail: Promise<void> = Promise.resolve();

  constructor(orchestrator: WorkerOrchestrator, config: WorkerSchedulerConfig) {
    this.orchestrator = orchestrator;
    this.config = config;
  }

  start(): void {
    if (this.timer) {
      return;
    }

    if (this.config.runOnStart) {
      void this.enqueueTick('run_on_start');
    }

    this.timer = setInterval(() => {
      void this.enqueueTick('interval');
    }, this.config.intervalMs);
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  async runNow(): Promise<void> {
    await this.enqueueTick('run_now');
  }

  private enqueueTick(trigger: string): Promise<void> {
    const job = this.tail.then(async () => {
      const tickStartedAt = Date.now();
      try {
        await this.orchestrator.enqueueDbQueuedRuns();
        await this.orchestrator.enqueueScheduledRuns();
        const snapshot = this.orchestrator.queueSnapshot();
        workerLog.info('scheduler.tick.complete', {
          trigger,
          durationMs: Date.now() - tickStartedAt,
          ...snapshot,
        });
      } catch (error: unknown) {
        workerLog.error('scheduler.tick.failed', {
          trigger,
          durationMs: Date.now() - tickStartedAt,
          err: error instanceof Error ? error.message : 'Unknown scheduler error',
        });
      }
    });
    this.tail = job.catch(() => {});
    return job;
  }
}

export function loadSchedulerConfigFromEnv(
  env: Record<string, string | undefined>
): WorkerSchedulerConfig {
  const intervalMinutesRaw = env.WORKER_CRON_INTERVAL_MINUTES ?? '15';
  const parsed = Number(intervalMinutesRaw);
  const intervalMinutes = Number.isFinite(parsed) && parsed > 0 ? parsed : 15;

  return {
    intervalMs: intervalMinutes * 60 * 1000,
    runOnStart: env.WORKER_RUN_ON_START !== 'false',
  };
}
