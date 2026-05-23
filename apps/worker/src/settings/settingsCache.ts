import {
  resolveAllSettingsRaw,
  resolveSettingRaw,
  type ResolveSettingInput,
} from '@job-bot/shared';
import type { ConvexHttpClient } from 'convex/browser';

import { api } from '../convexBridge/api.js';
import { workerLog } from '../log.js';
import { reportWorkerEnvOverrides } from './reportWorkerEnv.js';

/**
 * In-memory cache of Convex app settings merged with process.env (env wins when non-empty).
 * Refreshed on worker start and on scheduler heartbeat (~30s).
 */
export class WorkerSettingsCache {
  private stored: Record<string, string> = {};
  private lastRefreshAt = 0;

  constructor(
    private readonly convex: ConvexHttpClient,
    private readonly workerId: string
  ) {}

  /**
   * Loads stored values from Convex, merges with `process.env`, and reports
   * allowlisted env overrides for the Settings UI.
   */
  async refresh(): Promise<void> {
    await this.convex.mutation(api.appSettings.seedMissingSettings, {});
    const row = await this.convex.query(api.appSettings.get, {});
    this.stored = row.values;
    this.lastRefreshAt = Date.now();
    try {
      await reportWorkerEnvOverrides(this.convex, this.workerId);
    } catch (error: unknown) {
      workerLog.warn('worker.settings_env_report_failed', {
        err: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  get lastRefreshedAt(): number {
    return this.lastRefreshAt;
  }

  private input(): ResolveSettingInput {
    return {
      env: process.env,
      stored: this.stored,
    };
  }

  /** Resolved raw string for an allowlisted key. */
  getRaw(key: string): string {
    return resolveSettingRaw(key, this.input()).value;
  }

  /** Map of all allowlisted keys to resolved raw strings. */
  getAllResolvedRaw(): Record<string, string> {
    return resolveAllSettingsRaw(this.input());
  }

  /**
   * Env-like record for modules that read string keys (LinkedIn scrape, etc.).
   * Includes resolved app settings plus env-only keys from process.env unchanged.
   */
  getEnvRecord(): Record<string, string | undefined> {
    const resolved = this.getAllResolvedRaw();
    return {
      ...process.env,
      ...resolved,
    };
  }
}

let globalCache: WorkerSettingsCache | null = null;

export function initWorkerSettingsCache(
  convex: ConvexHttpClient,
  workerId: string
): WorkerSettingsCache {
  const cache = new WorkerSettingsCache(convex, workerId);
  globalCache = cache;
  return cache;
}

export function resolveWorkerIdFromEnv(): string {
  const raw = process.env.WORKER_ID?.trim();
  return raw && raw.length > 0 ? raw : 'default';
}

export function getWorkerSettingsCache(): WorkerSettingsCache {
  if (!globalCache) {
    throw new Error('Worker settings cache not initialized');
  }
  return globalCache;
}

/** Safe read when cache may not exist (tests). */
export function tryGetWorkerSettingsCache(): WorkerSettingsCache | null {
  return globalCache;
}
