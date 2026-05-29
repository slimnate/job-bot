import type { ChildProcess } from 'node:child_process';
import { access, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import {
  CdpChromeDriver,
  launchChromeWithRemoteDebugging,
  type ChromeDriver,
} from '@job-bot/agent-core';
import { parseAppSettingValue } from '@job-bot/shared';

import { isScrapeDebug } from './debugFlags.js';
import { workerLog } from './log.js';
import { resolveWorkerIdFromEnv } from './settings/settingsCache.js';
import { resolveChromeUserDataDir } from './workerPaths.js';

export type WorkerChromeSessionOptions = {
  /** When true, start Chrome and connect over CDP. */
  enabled: boolean;
  /** When false, spawn a visible window (for debugging scrapers). */
  headless: boolean;
  /** When true (default), spawn Chrome. When false, connect to an existing DevTools port. */
  manageChrome: boolean;
  /**
   * When true (default), close/detach Chrome after each LinkedIn scrape run.
   * Disable for local debugging sessions where you want to keep the browser instance alive.
   */
  autoCleanupAfterLinkedInScrape: boolean;
  port: number;
  /** Persistent Chrome profile (cookies, LinkedIn session). */
  userDataDir: string;
  executablePath?: string;
};

const STALE_CHROME_LOCK_FILES = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'] as const;

function requireResolved(env: Record<string, string | undefined>, key: string): string {
  const raw = env[key];
  if (raw === undefined) {
    throw new Error(`Missing '${key}' in worker settings (seed app_settings or set env)`);
  }
  return raw;
}

/** Env-only key (not in app settings catalog); conventional default when unset. */
function parseEnvOnlyBool(value: string | undefined, whenUnset: boolean): boolean {
  if (value === undefined || value.trim() === '') {
    return whenUnset;
  }
  const lower = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(lower)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(lower)) {
    return false;
  }
  throw new Error(`Invalid boolean env value: ${JSON.stringify(value)}`);
}

export function loadWorkerChromeSessionOptionsFromEnv(
  env: Record<string, string | undefined>
): WorkerChromeSessionOptions {
  const port = parseAppSettingValue(
    'WORKER_CHROME_PORT',
    requireResolved(env, 'WORKER_CHROME_PORT')
  ) as number;

  const userDataDirRaw = requireResolved(env, 'WORKER_CHROME_USER_DATA_DIR');
  const workerId = resolveWorkerIdFromEnv();

  return {
    enabled: parseAppSettingValue(
      'WORKER_USE_CHROME',
      requireResolved(env, 'WORKER_USE_CHROME')
    ) as boolean,
    headless: parseAppSettingValue(
      'WORKER_CHROME_HEADLESS',
      requireResolved(env, 'WORKER_CHROME_HEADLESS')
    ) as boolean,
    manageChrome: parseEnvOnlyBool(env.WORKER_MANAGE_CHROME, true),
    autoCleanupAfterLinkedInScrape: parseAppSettingValue(
      'WORKER_AUTO_CLEANUP_CHROME',
      requireResolved(env, 'WORKER_AUTO_CLEANUP_CHROME')
    ) as boolean,
    port,
    userDataDir: resolveChromeUserDataDir(userDataDirRaw, workerId),
    executablePath: env.CHROME_PATH,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDevToolsEndpoint(port: number, timeoutMs: number): Promise<void> {
  const url = `http://127.0.0.1:${port}/json/version`;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        return;
      }
    } catch {
      /* Chrome still booting */
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for Chrome DevTools on port ${port}`);
}

/**
 * Chrome may leave lock files after a crash; remove them when no managed process is running.
 */
async function clearStaleChromeProfileLocks(userDataDir: string): Promise<void> {
  const removed: string[] = [];
  for (const name of STALE_CHROME_LOCK_FILES) {
    const filePath = join(userDataDir, name);
    try {
      await access(filePath);
      await unlink(filePath);
      removed.push(name);
    } catch {
      /* file absent */
    }
  }
  if (removed.length > 0) {
    workerLog.info('chrome.session', {
      phase: 'stale_lock_cleanup',
      userDataDir,
      removed,
    });
  }
}

async function prepareChromeProfileDir(userDataDir: string): Promise<void> {
  await mkdir(userDataDir, { recursive: true });
  await clearStaleChromeProfileLocks(userDataDir);
}

export class WorkerChromeSession {
  private readonly options: WorkerChromeSessionOptions;
  private readonly driver: CdpChromeDriver;
  private child: ChildProcess | null = null;
  private started = false;

  constructor(options: WorkerChromeSessionOptions) {
    this.options = options;
    this.driver = new CdpChromeDriver({
      host: '127.0.0.1',
      port: options.port,
    });
  }

  getDriver(): ChromeDriver {
    return this.driver;
  }

  /** True when the worker is configured to spawn and own the Chrome process. */
  isManagedChrome(): boolean {
    return this.options.manageChrome;
  }

  private async spawnManagedChrome(phase: 'spawn' | 'respawn'): Promise<void> {
    await prepareChromeProfileDir(this.options.userDataDir);
    workerLog.info('chrome.session', {
      phase,
      port: this.options.port,
      headless: this.options.headless,
      userDataDir: this.options.userDataDir,
    });
    this.child = await launchChromeWithRemoteDebugging({
      port: this.options.port,
      headless: this.options.headless,
      userDataDir: this.options.userDataDir,
      executablePath: this.options.executablePath,
    });
    this.child.once('exit', (code, signal) => {
      void this.onChromeProcessExit(code, signal);
    });
    await waitForDevToolsEndpoint(this.options.port, 45_000);
  }

  /**
   * Chrome can exit while the worker keeps running; CDP then throws "WebSocket is not open".
   * Call this before LinkedIn (CDP) scrapes so we reconnect or respawn managed Chrome as needed.
   */
  async ensureReadyForScrape(): Promise<void> {
    if (!this.options.enabled) {
      return;
    }

    const pingOk =
      this.started &&
      this.driver.isConnected() &&
      (await this.pingDriver().catch(() => false));
    if (pingOk) {
      if (isScrapeDebug()) {
        workerLog.debug('chrome.session.ping_ok', { port: this.options.port });
      }
      return;
    }

    if (isScrapeDebug()) {
      workerLog.debug('chrome.session.reconnect', {
        manageChrome: this.options.manageChrome,
        hadStarted: this.started,
      });
    }

    await this.driver.disconnect().catch(() => {});
    this.started = false;

    if (this.options.manageChrome) {
      const chromeStillRunning = this.child !== null && this.child.exitCode === null;
      if (!chromeStillRunning) {
        if (this.child) {
          this.child.removeAllListeners('exit');
        }
        this.child = null;
        await this.spawnManagedChrome('respawn');
      } else {
        await waitForDevToolsEndpoint(this.options.port, 5000);
      }
    } else {
      workerLog.info('chrome.session', {
        phase: 'reconnect_attach',
        port: this.options.port,
      });
      await waitForDevToolsEndpoint(this.options.port, 15_000);
    }

    await this.driver.connect();
    this.started = true;
    workerLog.info('chrome.session', { phase: 'cdp_connected', port: this.options.port });
  }

  private async pingDriver(): Promise<boolean> {
    await this.driver.evaluate('void 0');
    return true;
  }

  private async onChromeProcessExit(
    code: number | null | undefined,
    signal: NodeJS.Signals | null | undefined
  ): Promise<void> {
    workerLog.warn('chrome.session', {
      phase: 'child_exit',
      code,
      signal,
    });
    await this.driver.disconnect().catch(() => {});
    this.started = false;
    this.child = null;
  }

  async start(): Promise<void> {
    if (!this.options.enabled || this.started) {
      return;
    }

    if (this.options.manageChrome) {
      await this.spawnManagedChrome('spawn');
    } else {
      workerLog.info('chrome.session', {
        phase: 'connect_only',
        port: this.options.port,
        hint: 'Expect Chrome already running with remote debugging on this port',
      });
      await waitForDevToolsEndpoint(this.options.port, 5000);
    }

    await this.driver.connect();
    this.started = true;
    workerLog.info('chrome.session', { phase: 'cdp_connected', port: this.options.port });
  }

  async stop(): Promise<void> {
    if (!this.started && !this.child) {
      return;
    }
    await this.driver.disconnect().catch(() => {});
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
    this.started = false;
    workerLog.info('chrome.session', {
      phase: 'stopped',
      userDataDir: this.options.userDataDir,
    });
  }

  /**
   * End-of-run LinkedIn cleanup:
   * - managed Chrome: fully stop the spawned browser process
   * - attached Chrome: disconnect CDP only (do not kill a user-owned browser)
   */
  async closeAfterLinkedInScrape(): Promise<void> {
    if (!this.options.enabled) {
      return;
    }
    if (isScrapeDebug()) {
      workerLog.debug('chrome.session.before_cleanup', {
        autoCleanup: this.options.autoCleanupAfterLinkedInScrape,
        manageChrome: this.options.manageChrome,
        port: this.options.port,
      });
    }
    if (!this.options.autoCleanupAfterLinkedInScrape) {
      workerLog.info('chrome.session', {
        phase: 'cleanup_skipped_after_scrape',
        port: this.options.port,
      });
      return;
    }
    if (this.options.manageChrome) {
      await this.stop();
      return;
    }

    await this.driver.disconnect().catch(() => {});
    this.started = false;
    workerLog.info('chrome.session', {
      phase: 'detached_after_scrape',
      port: this.options.port,
    });
  }
}

let sharedSession: WorkerChromeSession | null = null;

/**
 * Registers a shared Chrome session when `WORKER_USE_CHROME=1`, without spawning Chrome yet.
 * Chrome starts on the first LinkedIn scrape via `ensureWorkerChromeForLinkedIn` → `ensureReadyForScrape`.
 */
export async function initWorkerChromeFromEnv(env: NodeJS.ProcessEnv): Promise<WorkerChromeSession | null> {
  const options = loadWorkerChromeSessionOptionsFromEnv(env);
  if (!options.enabled) {
    return null;
  }
  const session = new WorkerChromeSession(options);
  sharedSession = session;
  return session;
}

export function getWorkerChromeSession(): WorkerChromeSession | null {
  return sharedSession;
}

export function getWorkerChromeDriver(): ChromeDriver | null {
  return sharedSession?.getDriver() ?? null;
}

/** No-op if Chrome is disabled or no session; otherwise reconnects CDP / respawns Chrome if needed. */
export async function ensureWorkerChromeForLinkedIn(): Promise<void> {
  await sharedSession?.ensureReadyForScrape();
}

/**
 * Per-run teardown for LinkedIn scrapes. Safe to call even if Chrome is disabled.
 */
export async function closeWorkerChromeAfterLinkedInScrape(): Promise<void> {
  await sharedSession?.closeAfterLinkedInScrape();
}

/** Stops managed Chrome and clears the shared session (worker shutdown only). */
export async function shutdownWorkerChromeSession(): Promise<void> {
  await sharedSession?.stop();
  sharedSession = null;
}
