#!/usr/bin/env node
/**
 * Queues a Greenhouse scrape (`runs.trigger`), runs the worker in-process when no worker is
 * listening on the HTTP trigger port, calls `scheduler.runNow()`, and waits for completion.
 *
 * Usage:
 *   node --env-file=.env.local scripts/trigger-greenhouse-run.mjs --board-token stripe
 *   npm run trigger:greenhouse -- --board-token stripe --keyword engineer
 *
 * Flags:
 *   --board-token (required)  Greenhouse board token or careers URL
 *   --keyword                   Optional client-side filter
 *   --department                Optional department name filter
 *   --office                    Optional office name filter
 *   --include-prospects         Include prospect posts (internal_job_id null)
 *   --no-start-worker           Only queue + POST /trigger (worker must be running elsewhere)
 *   --skip-worker-build         Skip worker build before embedded start
 *   --no-wait                   Exit after trigger without polling run status
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ConvexHttpClient } from 'convex/browser';

import { api } from '../convex/_generated/api.js';

const DEFAULT_TRIGGER_PORT = 3999;
const REMOTE_TRIGGER_WAIT_MS = 90_000;
const DEFAULT_RUN_WAIT_MS = 10 * 60 * 1000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const WORKER_DIST_INDEX = join(REPO_ROOT, 'apps/worker/dist/index.js');

function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {
    noStartWorker: false,
    skipWorkerBuild: false,
    noWait: false,
    includeProspects: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--board-token' && argv[i + 1] !== undefined) {
      out.boardToken = argv[i + 1];
      i++;
    } else if (arg === '--keyword' && argv[i + 1] !== undefined) {
      out.keyword = argv[i + 1];
      i++;
    } else if (arg === '--department' && argv[i + 1] !== undefined) {
      out.department = argv[i + 1];
      i++;
    } else if (arg === '--office' && argv[i + 1] !== undefined) {
      out.office = argv[i + 1];
      i++;
    } else if (arg === '--include-prospects') {
      out.includeProspects = true;
    } else if (arg === '--no-start-worker') {
      out.noStartWorker = true;
    } else if (arg === '--skip-worker-build') {
      out.skipWorkerBuild = true;
    } else if (arg === '--no-wait') {
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
  const raw = process.env.TRIGGER_GREENHOUSE_RUN_TIMEOUT_MS?.trim();
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }
  return DEFAULT_RUN_WAIT_MS;
}

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
  throw new Error(`Run ${runId} did not finish within ${timeoutMs}ms (set TRIGGER_GREENHOUSE_RUN_TIMEOUT_MS)`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!options.boardToken || typeof options.boardToken !== 'string') {
    console.error('--board-token is required (e.g. stripe or https://boards.greenhouse.io/stripe).');
    process.exit(1);
  }

  const convexUrl = process.env.CONVEX_URL?.trim();
  if (!convexUrl) {
    console.error('CONVEX_URL is not set. Add it to .env.local or export it.');
    process.exit(1);
  }

  const triggerUrl = workerTriggerUrl();
  const client = new ConvexHttpClient(convexUrl);

  /** @type {(() => Promise<void>) | null} */
  let stopEmbedded = null;

  let exitCode = 0;

  try {
    const remoteWorkerUp =
      options.noStartWorker || (await probeWorkerTrigger(triggerUrl));

    /** @type {{ runNow: () => Promise<void> } | null} */
    let scheduler = null;

    if (!remoteWorkerUp && !options.noStartWorker) {
      console.log('Starting worker in-process…');
      buildWorkerIfNeeded(options.skipWorkerBuild);
      const started = await startEmbeddedWorker();
      stopEmbedded = started.stop;
      scheduler = started.scheduler;
    } else if (options.noStartWorker) {
      console.log('Using existing worker only (--no-start-worker)…');
      await waitForRemoteTrigger(triggerUrl, REMOTE_TRIGGER_WAIT_MS);
    } else {
      console.log('Worker trigger already reachable.');
    }

    /** @type {Record<string, string>} */
    const sourceCriteria = { boardToken: options.boardToken };
    if (typeof options.keyword === 'string') {
      sourceCriteria.keyword = options.keyword;
    }
    if (typeof options.department === 'string') {
      sourceCriteria.department = options.department;
    }
    if (typeof options.office === 'string') {
      sourceCriteria.office = options.office;
    }
    if (options.includeProspects) {
      sourceCriteria.includeProspects = 'true';
    }

    const result = await client.mutation(api.runs.trigger, {
      source: 'greenhouse',
      sourceCriteria,
    });
    console.log('Queued:', JSON.stringify(result, null, 2));

    const runId = result.runIds?.[0];
    if (!runId) {
      throw new Error('runs.trigger did not return runIds[0]');
    }

    if (scheduler) {
      await scheduler.runNow();
    } else {
      await postTrigger(triggerUrl);
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
    if (stopEmbedded) {
      console.log('Stopping worker…');
      try {
        await stopEmbedded();
      } catch (err) {
        console.warn('Worker shutdown:', err instanceof Error ? err.message : err);
      }
    }
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
