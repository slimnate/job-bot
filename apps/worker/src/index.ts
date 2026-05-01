import { workerLog } from './log.js';
import { WorkerOrchestrator } from './orchestrator.js';
import { loadSchedulerConfigFromEnv, WorkerScheduler } from './scheduler.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var '${name}'`);
  }
  return value;
}

export function createWorkerRuntime(): WorkerScheduler {
  const convexUrl = requireEnv('CONVEX_URL');
  const concurrencyRaw = Number(process.env.WORKER_QUEUE_CONCURRENCY ?? '2');
  const concurrency = Number.isFinite(concurrencyRaw) && concurrencyRaw > 0 ? concurrencyRaw : 2;

  const orchestrator = new WorkerOrchestrator({
    convexUrl,
    concurrency,
  });
  const schedulerConfig = loadSchedulerConfigFromEnv(process.env);
  return new WorkerScheduler(orchestrator, schedulerConfig);
}

export function startWorker(): WorkerScheduler {
  const scheduler = createWorkerRuntime();
  scheduler.start();
  workerLog.info('worker.scheduler_started', {});
  return scheduler;
}

if (process.env.NODE_ENV !== 'test') {
  const runtime = startWorker();

  const stop = () => {
    runtime.stop();
    workerLog.info('worker.stopped', {});
    process.exit(0);
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
