import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ConvexHttpClient } from 'convex/browser';

import { initWorkerChromeFromEnv } from './chromeSession.js';
import { workerLog } from './log.js';
import { parseLinkedInDebugSteps } from './sources/linkedinDebugSteps.js';
import { WorkerOrchestrator } from './orchestrator.js';
import { loadSchedulerConfigFromEnv, WorkerScheduler } from './scheduler.js';
import { startWorkerTriggerServer, stopWorkerTriggerServer } from './workerTriggerServer.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var '${name}'`);
  }
  return value;
}

/**
 * Parses common boolean-style env values (`1/0`, `true/false`, `yes/no`, `on/off`).
 * Returns `defaultValue` when the value is missing or unrecognized.
 */
function parseEnvBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  const lower = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(lower)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(lower)) {
    return false;
  }
  return defaultValue;
}

export function createWorkerRuntime(): WorkerScheduler {
  const convexUrl = requireEnv('CONVEX_URL');
  const concurrencyRaw = Number(process.env.WORKER_QUEUE_CONCURRENCY ?? '2');
  const concurrency = Number.isFinite(concurrencyRaw) && concurrencyRaw > 0 ? concurrencyRaw : 2;
  const enableLlmRanking = parseEnvBool(process.env.WORKER_ENABLE_LLM_RANKING, true);

  const orchestrator = new WorkerOrchestrator({
    convexUrl,
    concurrency,
    enableLlmRanking,
  });
  const convex = new ConvexHttpClient(convexUrl);
  const schedulerConfig = loadSchedulerConfigFromEnv(process.env, { convex });
  return new WorkerScheduler(orchestrator, schedulerConfig);
}

function parseTriggerServerPort(env: NodeJS.ProcessEnv): number | null {
  const raw = env.WORKER_HTTP_TRIGGER_PORT;
  if (raw === undefined || raw.trim() === '') {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function startWorker(): Promise<{
  scheduler: WorkerScheduler;
  stop: () => Promise<void>;
}> {
  const chromeSession = await initWorkerChromeFromEnv(process.env);
  const scheduler = createWorkerRuntime();
  scheduler.start();
  workerLog.info('worker.scheduler_started', {
    chrome: chromeSession ? 'deferred_until_linkedin' : 'disabled',
  });
  workerLog.info('linkedin.debug_steps', {
    mode: parseLinkedInDebugSteps(process.env),
    WORKER_LINKEDIN_DEBUG_STEPS: process.env.WORKER_LINKEDIN_DEBUG_STEPS ?? null,
  });

  const triggerPort = parseTriggerServerPort(process.env);
  const triggerServer =
    triggerPort !== null
      ? startWorkerTriggerServer(scheduler, triggerPort, { convexUrl: requireEnv('CONVEX_URL') })
      : undefined;

  const stop = async () => {
    scheduler.stop();
    await stopWorkerTriggerServer(triggerServer);
    await chromeSession?.stop();
    workerLog.info('worker.stopped', {});
  };

  return { scheduler, stop };
}

/** True when Node was started with this file as the entry script (not when another module imports us). */
function isWorkerCliEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    const resolvedEntry = path.resolve(entry);
    const thisFile = path.normalize(fileURLToPath(import.meta.url));
    return path.normalize(resolvedEntry) === thisFile;
  } catch {
    return false;
  }
}

if (process.env.NODE_ENV !== 'test' && isWorkerCliEntry()) {
  void startWorker()
    .then(({ stop }) => {
      let stopping: Promise<void> | undefined;
      const onSignal = () => {
        if (stopping) {
          return;
        }
        stopping = stop().then(() => process.exit(0));
      };
      process.on('SIGINT', onSignal);
      process.on('SIGTERM', onSignal);
    })
    .catch((err: unknown) => {
      workerLog.error('worker.bootstrap_failed', {
        err: err instanceof Error ? err.message : 'Unknown error',
      });
      process.exit(1);
    });
}
