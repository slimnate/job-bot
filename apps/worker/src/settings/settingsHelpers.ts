import {
  InvalidAppSettingError,
  MissingAppSettingError,
  parseAppSettingValue,
} from '@job-bot/shared';

import { getWorkerSettingsCache, tryGetWorkerSettingsCache } from './settingsCache.js';

/**
 * Resolved raw string for an allowlisted key (env overrides stored Convex values).
 */
export function requireSettingRaw(key: string): string {
  const cache = tryGetWorkerSettingsCache();
  if (!cache) {
    throw new MissingAppSettingError(
      key,
      `Worker settings cache not initialized; cannot read '${key}'.`
    );
  }
  return cache.getRaw(key);
}

export function getSettingBool(key: string): boolean {
  const parsed = parseAppSettingValue(key, requireSettingRaw(key));
  if (typeof parsed !== 'boolean') {
    throw new InvalidAppSettingError(key, requireSettingRaw(key), `Expected boolean for '${key}'.`);
  }
  return parsed;
}

export function getSettingNumber(key: string): number {
  const raw = requireSettingRaw(key);
  const parsed = parseAppSettingValue(key, raw);
  if (typeof parsed === 'number') {
    return parsed;
  }
  if (parsed === '') {
    throw new InvalidAppSettingError(key, raw, `Expected number for '${key}' but value is empty.`);
  }
  throw new InvalidAppSettingError(key, raw, `Expected number for '${key}'.`);
}

export function getSettingString(key: string): string {
  const raw = requireSettingRaw(key);
  const parsed = parseAppSettingValue(key, raw);
  return typeof parsed === 'string' ? parsed : String(parsed);
}

/** Optional catalog keys may resolve to an empty string. */
export function getOptionalSettingString(key: string): string {
  return requireSettingRaw(key);
}
