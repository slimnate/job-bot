#!/usr/bin/env node
/**
 * Queues a LinkedIn scrape (`runs.trigger`), runs the worker **in-process** when no worker is
 * listening on the HTTP trigger port, calls `scheduler.runNow()`, waits for the run to finish, then
 * shuts the worker down.
 *
 * **Queue hygiene:** Before doing work, cancels all **queued** Convex rows with `source: linkedin`.
 * On most exits (error, full wait, or Ctrl+C), runs the same cleanup again. With `--no-wait` and
 * a clean exit, cleanup is skipped so the run you just queued is not cancelled. If `--no-start-worker`
 * and the trigger POST fails (run left queued on purpose), exit cleanup also skips cancel.
 *
 * Requires CONVEX_URL (see `.env.local`). Optional: WORKER_HTTP_TRIGGER_PORT / WORKER_TRIGGER_URL
 * when using an **already-running** worker (`--no-start-worker` or probe succeeds).
 *
 * Usage:
 *   node --env-file=.env.local scripts/trigger-linkedin-run.mjs
 *   npm run trigger:linkedin -- --query "optional keywords"
 *   npm run trigger:linkedin -- --query "optional keywords" --location "Austin, TX"
 *   npm run trigger:linkedin -- --query "optional keywords" --geo-id 90000096
 *
 * Flags:
 *   --no-start-worker     Do not import/start the worker; only queue + POST /trigger (needs a worker elsewhere).
 *   --skip-worker-build   Skip `npm run build --workspace=@job-bot/worker` before importing the worker.
 *   --no-wait             Do not poll Convex until the scrape run reaches a terminal status (exit right after trigger).
 *
 * Location: use either `--location` (free text) or `--geo-id` (LinkedIn numeric geo); if both are passed, `--geo-id` wins.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ConvexHttpClient } from 'convex/browser';

import { api } from '../convex/_generated/api.js';

const DEFAULT_TRIGGER_PORT = 3999;
const REMOTE_TRIGGER_WAIT_MS = 90_000;
const DEFAULT_RUN_WAIT_MS = 45 * 60 * 1000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const WORKER_DIST_INDEX = join(REPO_ROOT, 'apps/worker/dist/index.js');

function parseArgs(argv) {
  /** @type {{ query?: string; location?: string; geoId?: string; noStartWorker: boolean; skipWorkerBuild: boolean; noWait: boolean }} */
  const out = { noStartWorker: false, skipWorkerBuild: false, noWait: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--query' && argv[i + 1] !== undefined) {
      out.query = argv[i + 1];
      i++;
    } else if (argv[i] === '--location' && argv[i + 1] !== undefined) {
      out.location = argv[i + 1];
      i++;
    } else if (argv[i] === '--geo-id' && argv[i + 1] !== undefined) {
      out.geoId = argv[i + 1];
      i++;
    } else if (argv[i] === '--no-start-worker') {
      out.noStartWorker = true;
    } else if (argv[i] === '--skip-worker-build') {
      out.skipWorkerBuild = true;
    } else if (argv[i] === '--no-wait') {
      out.noWait = true;
    }
  }
  return out;
}

function workerTriggerUrl() {
  const explicit = process.env.WORKER_TRIGGER_URL?.trim();
  if (explicit) {
    return explicit;
  }
  const portRaw = process.env.WORKER_HTTP_TRIGGER_PORT?.trim();
  const port = portRaw ? Number.parseInt(portRaw, 10) : DEFAULT_TRIGGER_PORT;
  if (!Number.isFinite(port) || port <= 0) {
    return `http://127.0.0.1:${DEFAULT_TRIGGER_PORT}/trigger`;
  }
  return `http://127.0.0.1:${port}/trigger`;
}

async function probeWorkerTrigger(triggerUrl) {
  try {
    const res = await fetch(triggerUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(4000),
    });
    return res.status === 204;
  } catch {
    return false;
  }
}

async function waitForRemoteTrigger(triggerUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeWorkerTrigger(triggerUrl)) {
      return;
    }
    await new Promise((r) => setTimeout(r, 450));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for worker at ${triggerUrl}`);
}

function buildWorkerIfNeeded(skipBuild) {
  if (skipBuild) {
    return;
  }
  console.log('Building worker…');
  execSync('npm run build --workspace=@job-bot/worker', {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: process.env,
  });
}

/** Loads compiled worker and starts scheduler + optional HTTP trigger in this Node process. */
async function startEmbeddedWorker() {
  if (!existsSync(WORKER_DIST_INDEX)) {
    throw new Error(
      `Missing ${WORKER_DIST_INDEX}. Run npm run build --workspace=@job-bot/worker (omit --skip-worker-build).`
    );
  }
  const workerMod = await import(pathToFileURL(WORKER_DIST_INDEX).href);
  const startWorker = workerMod.startWorker;
  if (typeof startWorker !== 'function') {
    throw new Error('Worker module did not export startWorker()');
  }
  return startWorker();
}

async function postTrigger(triggerUrl) {
  const res = await fetch(triggerUrl, { method: 'POST' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Worker trigger failed: ${res.status} ${res.statusText} ${text}`);
  }
  console.log(`Worker tick OK (${triggerUrl})`);
}

function runWaitMs() {
  const raw = process.env.TRIGGER_LINKEDIN_RUN_TIMEOUT_MS?.trim();
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }
  return DEFAULT_RUN_WAIT_MS;
}

/**
 * @param {import('convex/browser').ConvexHttpClient} client
 * @param {string} runId
 */
async function waitForRunTerminal(client, runId, timeoutMs) {
  const terminal = new Set(['succeeded', 'failed', 'cancelled']);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const doc = await client.query(api.runs.get, { runId });
    if (doc && terminal.has(doc.status)) {
      return doc;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Run ${runId} did not finish within ${timeoutMs}ms (set TRIGGER_LINKEDIN_RUN_TIMEOUT_MS)`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const convexUrl = process.env.CONVEX_URL?.trim();
  if (!convexUrl) {
    console.error('CONVEX_URL is not set. Add it to .env.local or export it.');
    process.exit(1);
  }

  const triggerUrl = workerTriggerUrl();
  const client = new ConvexHttpClient(convexUrl);

  /** @type {(() => Promise<void>) | null} */
  let stopEmbedded = null;

  let exitCleanupDone = false;

  /**
   * Optionally cancels queued LinkedIn rows in Convex, then stops the embedded worker once.
   * Idempotent so Ctrl+C and `finally` can both call it safely.
   *
   * @param {{ cancelQueuedLinkedIn?: boolean }} [opts] When `cancelQueuedLinkedIn` is false, only the worker is stopped (used with `--no-wait` so we do not revoke the run we just kicked off).
   */
  const runExitCleanup = async (reason, opts = {}) => {
    const cancelConvex = opts.cancelQueuedLinkedIn !== false;
    if (exitCleanupDone) {
      return;
    }
    exitCleanupDone = true;
    if (cancelConvex) {
      try {
        const { cancelled } = await client.mutation(api.runs.cancelQueuedLinkedIn, {});
        console.log(
          `${reason}: cancelled ${cancelled} queued LinkedIn scrape run(s) in Convex.`
        );
      } catch (err) {
        console.warn(
          `${reason}: cancelQueuedLinkedIn failed:`,
          err instanceof Error ? err.message : err
        );
      }
    }
    if (stopEmbedded) {
      console.log('Stopping worker…');
      try {
        await stopEmbedded();
      } catch (err) {
        console.warn('Worker shutdown:', err instanceof Error ? err.message : err);
      }
      stopEmbedded = null;
    }
  };

  process.once('SIGINT', async () => {
    await runExitCleanup('Interrupt (Ctrl+C)', { cancelQueuedLinkedIn: true });
    process.exit(130);
  });
  process.once('SIGTERM', async () => {
    await runExitCleanup('SIGTERM', { cancelQueuedLinkedIn: true });
    process.exit(143);
  });

  let exitCode = 0;
  /** When true, skip Convex cancel on exit so we do not revoke a run left queued on purpose (e.g. worker unreachable). */
  let suppressConvexExitCancel = false;

  try {
    {
      const { cancelled } = await client.mutation(api.runs.cancelQueuedLinkedIn, {});
      console.log(
        `Startup: cancelled ${cancelled} previously queued LinkedIn scrape run(s) (clean slate).`
      );
    }

    const remoteWorkerUp =
      options.noStartWorker || (await probeWorkerTrigger(triggerUrl));

    /** @type {{ runNow: () => Promise<void> } | null} */
    let scheduler = null;

    if (!remoteWorkerUp && !options.noStartWorker) {
      console.log('Starting worker in-process (logs below stream from worker code)…');
      buildWorkerIfNeeded(options.skipWorkerBuild);
      const started = await startEmbeddedWorker();
      stopEmbedded = started.stop;
      scheduler = started.scheduler;
    } else if (options.noStartWorker) {
      console.log('Using existing worker only (--no-start-worker); waiting until trigger is reachable…');
      await waitForRemoteTrigger(triggerUrl, REMOTE_TRIGGER_WAIT_MS);
    } else {
      console.log('Worker trigger already reachable; using existing worker process.');
    }

    if (options.location !== undefined && options.geoId !== undefined) {
      console.warn('Both --location and --geo-id were set; using --geo-id and ignoring --location.');
    }

    /** @type {Record<string, string>} */
    const sourceCriteria = {};
    if (options.query !== undefined) {
      sourceCriteria.search = options.query;
    }
    if (options.geoId !== undefined) {
      sourceCriteria.geoId = options.geoId;
    } else if (options.location !== undefined) {
      sourceCriteria.location = options.location;
    }

    const payload = {
      source: 'linkedin',
      ...(Object.keys(sourceCriteria).length > 0 ? { sourceCriteria } : {}),
    };

    const result = await client.mutation(api.runs.trigger, payload);
    console.log('Queued:', JSON.stringify(result, null, 2));

    const runId = result.runIds?.[0];
    if (!runId) {
      throw new Error('runs.trigger did not return runIds[0]');
    }

    if (scheduler) {
      console.log('Running scheduler tick to pick up queued runs (chains after startup tick if needed)…');
      await scheduler.runNow();
    } else {
      try {
        await postTrigger(triggerUrl);
      } catch (err) {
        const cause = err instanceof Error ? err.cause : undefined;
        const code =
          cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
            ? cause.code
            : undefined;
        if (code === 'ECONNREFUSED' && options.noStartWorker) {
          console.warn(
            `Could not reach worker at ${triggerUrl}. The run is still queued; start the worker or wait for the scheduler.`
          );
          suppressConvexExitCancel = true;
          return;
        }
        throw err;
      }
    }

    if (options.noWait) {
      return;
    }

    console.log('Waiting for run to finish…');
    const doc = await waitForRunTerminal(client, runId, runWaitMs());
    console.log(
      `Run done: status=${doc.status}${doc.logsSummary ? ` (${doc.logsSummary})` : ''}${doc.errorMessage ? ` error=${doc.errorMessage}` : ''}`
    );
    if (doc.stats) {
      console.log('Stats:', JSON.stringify(doc.stats));
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    exitCode = 1;
  } finally {
    const cancelQueuedLinkedIn =
      !suppressConvexExitCancel && (!options.noWait || exitCode !== 0);
    await runExitCleanup('On exit', { cancelQueuedLinkedIn });
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
