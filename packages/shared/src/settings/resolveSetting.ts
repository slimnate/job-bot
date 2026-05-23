import {
  getAppSettingDefinition,
  type AppSettingDefinition,
} from './appSettingDefinitions.js';
import { APP_SETTING_KEYS } from './systemSettingDefaults.js';

export type SettingSource = 'env' | 'convex';

/** Where a non-empty env override comes from when shown in the Settings UI. */
export type SettingEnvSource = 'worker' | 'convex' | null;

/** Thrown when a required setting is missing from env and Convex stored values. */
export class MissingAppSettingError extends Error {
  constructor(
    public readonly key: string,
    message?: string
  ) {
    super(
      message ??
        `Missing app setting '${key}': set it in Settings, seed via seedMissingSettings, or set the env var.`
    );
    this.name = 'MissingAppSettingError';
  }
}

/** Thrown when a stored/env raw string cannot be parsed for its catalog type. */
export class InvalidAppSettingError extends Error {
  constructor(
    public readonly key: string,
    public readonly raw: string,
    message: string
  ) {
    super(message);
    this.name = 'InvalidAppSettingError';
  }
}

/**
 * When both worker and Convex runtime set the same key, worker wins (matches runtime merge).
 */
export function resolveSettingEnvSource(
  key: string,
  convexEnv: Record<string, string | undefined>,
  workerOverrides: Record<string, string> | undefined
): SettingEnvSource {
  const fromWorker = workerOverrides ? hasEnvOverride(key, workerOverrides) : false;
  const fromConvex = hasEnvOverride(key, convexEnv);
  if (!fromWorker && !fromConvex) {
    return null;
  }
  if (fromWorker) {
    return 'worker';
  }
  return 'convex';
}

export type ResolveSettingInput = {
  env: Record<string, string | undefined>;
  stored: Record<string, string | undefined> | null | undefined;
};

/**
 * Returns whether a non-empty env value is set for this key (used for UI badges).
 */
export function hasEnvOverride(key: string, env: Record<string, string | undefined>): boolean {
  const raw = env[key];
  return raw !== undefined && raw.trim() !== '';
}

/**
 * Resolves the raw string value: env (non-empty) > stored (key present, including optional empty).
 * Throws {@link MissingAppSettingError} when the key is absent from stored and not optional.
 */
export function resolveSettingRaw(key: string, input: ResolveSettingInput): { value: string; source: SettingSource } {
  const def = getAppSettingDefinition(key);

  const envRaw = input.env[key];
  if (envRaw !== undefined && envRaw.trim() !== '') {
    return { value: envRaw.trim(), source: 'env' };
  }

  const storedRaw = input.stored?.[key];
  if (storedRaw !== undefined) {
    return { value: storedRaw.trim(), source: 'convex' };
  }

  if (def?.optional) {
    return { value: '', source: 'convex' };
  }

  throw new MissingAppSettingError(key);
}

function parseEnvBoolStrict(raw: string, key: string): boolean {
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') {
    return true;
  }
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') {
    return false;
  }
  throw new InvalidAppSettingError(
    key,
    raw,
    `Invalid boolean for '${key}': ${JSON.stringify(raw)}. Use true/false, 1/0, yes/no, or on/off.`
  );
}

function parsePositiveIntStrict(raw: string, key: string): number {
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new InvalidAppSettingError(
      key,
      raw,
      `Invalid positive integer for '${key}': ${JSON.stringify(raw)}.`
    );
  }
  return n;
}

function parseNonNegativeIntStrict(raw: string, key: string): number {
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new InvalidAppSettingError(
      key,
      raw,
      `Invalid non-negative integer for '${key}': ${JSON.stringify(raw)}.`
    );
  }
  return n;
}

function clampNumber(n: number, def: AppSettingDefinition): number {
  let v = n;
  if (def.min !== undefined) {
    v = Math.max(def.min, v);
  }
  if (def.max !== undefined) {
    v = Math.min(def.max, v);
  }
  return v;
}

/**
 * Parses a resolved raw string according to the catalog definition.
 * Invalid values throw {@link InvalidAppSettingError}.
 */
export function parseAppSettingValue(key: string, raw: string): string | number | boolean {
  const def = getAppSettingDefinition(key);
  if (!def) {
    return raw;
  }

  switch (def.type) {
    case 'boolean':
      return parseEnvBoolStrict(raw, key);
    case 'number': {
      if (def.optional && raw.trim() === '') {
        return '';
      }
      const base =
        def.min !== undefined && def.min >= 0
          ? parseNonNegativeIntStrict(raw, key)
          : parsePositiveIntStrict(raw, key);
      return clampNumber(base, def);
    }
    case 'enum': {
      const allowed = new Set(def.enumOptions?.map((o) => o.value) ?? []);
      if (allowed.has(raw)) {
        return raw;
      }
      throw new InvalidAppSettingError(
        key,
        raw,
        `Invalid enum for '${key}': ${JSON.stringify(raw)}. Allowed: ${[...allowed].join(', ')}.`
      );
    }
    case 'evaluator_id':
    case 'string':
      return raw;
    default:
      return raw;
  }
}

/**
 * Resolves and parses a single setting to its runtime type.
 */
export function resolveAppSetting(
  key: string,
  input: ResolveSettingInput
): { value: string | number | boolean; raw: string; source: SettingSource } {
  const { value: raw, source } = resolveSettingRaw(key, input);
  const value = parseAppSettingValue(key, raw);
  return { value, raw, source };
}

/**
 * Builds a map of all allowlisted keys to resolved raw strings (for worker/action merge).
 */
export function resolveAllSettingsRaw(input: ResolveSettingInput): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of APP_SETTING_KEYS) {
    out[key] = resolveSettingRaw(key, input).value;
  }
  return out;
}
