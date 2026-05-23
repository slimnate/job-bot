import {
  APP_SETTING_KEYS,
  buildSeedPatch,
  getAppSettingDefinition,
  getSystemDefault,
  hasEnvOverride,
  InvalidAppSettingError,
  isAppSettingKey,
  listAppSettingDefinitionsForUi,
  parseAppSettingValue,
  resolveAllSettingsRaw,
  resolveSettingEnvSource,
  resolveSettingRaw,
  type AppSettingDefinition,
  type AppSettingKey,
} from '@job-bot/shared';
import { v } from 'convex/values';
import type { MutationCtx, QueryCtx } from './_generated/server.js';
import { internalQuery, mutation, query } from './_generated/server.js';
import { DEFAULT_WORKER_ID } from './workerSettingsEnv.js';

const GLOBAL_SCOPE = 'global' as const;

/** Reads process env in Convex runtime (actions/queries on server). */
function readProcessEnv(key: string): string | undefined {
  const proc = (globalThis as Record<string, unknown>)['process'] as
    | { env?: Record<string, string | undefined> }
    | undefined;
  const raw = proc?.env?.[key];
  return typeof raw === 'string' ? raw : undefined;
}

function buildProcessEnvRecord(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const key of APP_SETTING_KEYS) {
    env[key] = readProcessEnv(key);
  }
  return env;
}

async function getGlobalRow(ctx: QueryCtx | MutationCtx) {
  return await ctx.db
    .query('app_settings')
    .withIndex('by_scope', (q) => q.eq('scope', GLOBAL_SCOPE))
    .unique();
}

/**
 * Ensures the global row exists and any missing catalog keys are seeded from system defaults.
 */
async function ensureSeededGlobalRow(ctx: MutationCtx) {
  const existing = await getGlobalRow(ctx);
  const patch = buildSeedPatch(existing?.values);
  const now = Date.now();

  if (Object.keys(patch).length === 0) {
    if (existing) {
      return { row: existing, seeded: false, updatedAt: existing.updatedAt };
    }
    await ctx.db.insert('app_settings', {
      scope: GLOBAL_SCOPE,
      values: patch,
      updatedAt: now,
    });
    const row = await getGlobalRow(ctx);
    if (!row) {
      throw new Error('Failed to create app_settings row');
    }
    return { row, seeded: true, updatedAt: now };
  }

  if (!existing) {
    await ctx.db.insert('app_settings', {
      scope: GLOBAL_SCOPE,
      values: patch,
      updatedAt: now,
    });
    const row = await getGlobalRow(ctx);
    if (!row) {
      throw new Error('Failed to create app_settings row');
    }
    return { row, seeded: true, updatedAt: now };
  }

  await ctx.db.patch(existing._id, {
    values: { ...existing.values, ...patch },
    updatedAt: now,
  });
  const row = await getGlobalRow(ctx);
  if (!row) {
    throw new Error('Failed to patch app_settings row');
  }
  return { row, seeded: true, updatedAt: now };
}

/**
 * Raw stored values for the global settings row (empty object when never saved).
 */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const row = await getGlobalRow(ctx);
    return {
      values: row?.values ?? {},
      updatedAt: row?.updatedAt ?? 0,
    };
  },
});

const fieldMetaValidator = v.object({
  key: v.string(),
  label: v.string(),
  hint: v.string(),
  type: v.union(
    v.literal('boolean'),
    v.literal('number'),
    v.literal('string'),
    v.literal('enum'),
    v.literal('evaluator_id')
  ),
  section: v.string(),
  systemDefault: v.string(),
  storedValue: v.string(),
  effectiveValue: v.string(),
  source: v.union(v.literal('env'), v.literal('convex')),
  envOverrideActive: v.boolean(),
  envSource: v.union(v.literal('worker'), v.literal('convex'), v.null()),
  workerEnvReportedAt: v.union(v.number(), v.null()),
  min: v.optional(v.number()),
  max: v.optional(v.number()),
  optional: v.optional(v.boolean()),
  enumOptions: v.optional(
    v.array(
      v.object({
        value: v.string(),
        label: v.string(),
      })
    )
  ),
});

/**
 * Patches missing catalog keys from system defaults (idempotent, per-key).
 */
export const seedMissingSettings = mutation({
  args: {},
  returns: v.object({
    seeded: v.boolean(),
    updatedAt: v.number(),
  }),
  handler: async (ctx) => {
    const { seeded, updatedAt } = await ensureSeededGlobalRow(ctx);
    return { seeded, updatedAt };
  },
});

/**
 * Settings page payload: catalog metadata, stored/effective values, env override flags.
 */
export const getForUi = query({
  args: {
    workerId: v.optional(v.string()),
  },
  returns: v.object({
    values: v.record(v.string(), v.string()),
    updatedAt: v.number(),
    workerId: v.string(),
    workerEnvReportedAt: v.union(v.number(), v.null()),
    sections: v.array(
      v.object({
        section: v.string(),
        sectionLabel: v.string(),
        fields: v.array(fieldMetaValidator),
      })
    ),
    envOnlyBanner: v.array(
      v.object({
        key: v.string(),
        where: v.string(),
      })
    ),
  }),
  handler: async (ctx, args) => {
    const row = await getGlobalRow(ctx);
    const workerId = args.workerId ?? DEFAULT_WORKER_ID;
    const convexEnv = buildProcessEnvRecord();
    const workerEnvRow = await ctx.db
      .query('worker_settings_env')
      .withIndex('by_worker_id', (q) => q.eq('workerId', workerId))
      .unique();
    const workerOverrides = workerEnvRow?.envOverrides;
    const mergedEnv: Record<string, string | undefined> = {
      ...convexEnv,
      ...workerOverrides,
    };
    const stored = row?.values ?? {};

    const sections = listAppSettingDefinitionsForUi().map((group) => ({
      section: group.section,
      sectionLabel: group.sectionLabel,
      fields: group.definitions.map((def) =>
        fieldMeta(def, stored, {
          mergedEnv,
          convexEnv,
          workerOverrides,
          workerEnvReportedAt: workerEnvRow?.reportedAt ?? null,
        })
      ),
    }));

    return {
      values: stored,
      updatedAt: row?.updatedAt ?? 0,
      workerId,
      workerEnvReportedAt: workerEnvRow?.reportedAt ?? null,
      sections,
      envOnlyBanner: [
        { key: 'CONVEX_URL / VITE_CONVEX_URL', where: '.env.local (required to connect)' },
        { key: 'OPENAI_API_KEY', where: 'Convex dashboard env or .env.local' },
        { key: 'LINKEDIN_USER / LINKEDIN_PASS', where: '.env.local on the worker host' },
        { key: 'CHROME_PATH', where: '.env.local (machine-specific Chrome binary)' },
        { key: 'WORKER_HTTP_TRIGGER_PORT', where: '.env.local (local worker HTTP port)' },
        { key: 'WORKER_ID', where: '.env.local (multi-worker identity)' },
        { key: 'WORKER_MANAGE_CHROME', where: '.env.local (attach vs spawn Chrome)' },
        { key: 'SCHEDULER_DEBUG, ORCHESTRATOR_DEBUG, SCRAPE_DEBUG, RANK_DEBUG', where: '.env.local' },
      ],
    };
  },
});

function fieldMeta(
  def: AppSettingDefinition,
  stored: Record<string, string>,
  ctx: {
    mergedEnv: Record<string, string | undefined>;
    convexEnv: Record<string, string | undefined>;
    workerOverrides: Record<string, string> | undefined;
    workerEnvReportedAt: number | null;
  }
) {
  const storedValue = stored[def.key] ?? '';
  let effectiveValue = storedValue;
  let source: 'env' | 'convex' = 'convex';
  try {
    const resolved = resolveSettingRaw(def.key, {
      env: ctx.mergedEnv,
      stored,
    });
    effectiveValue = resolved.value;
    source = resolved.source;
  } catch {
    effectiveValue = storedValue;
    source = 'convex';
  }

  const envSource = resolveSettingEnvSource(def.key, ctx.convexEnv, ctx.workerOverrides);
  const envOverrideActive =
    envSource !== null ||
    hasEnvOverride(def.key, ctx.convexEnv) ||
    (ctx.workerOverrides ? hasEnvOverride(def.key, ctx.workerOverrides) : false);

  return {
    key: def.key,
    label: def.label,
    hint: def.hint,
    type: def.type,
    section: def.section,
    systemDefault: getSystemDefault(def.key as AppSettingKey),
    storedValue,
    effectiveValue,
    source,
    envOverrideActive,
    envSource,
    workerEnvReportedAt: ctx.workerEnvReportedAt,
    min: def.min,
    max: def.max,
    optional: def.optional,
    enumOptions: def.enumOptions ? [...def.enumOptions] : undefined,
  };
}

/**
 * Patches allowlisted settings keys (string values). Empty string clears optional fields.
 */
export const upsert = mutation({
  args: {
    values: v.record(v.string(), v.string()),
  },
  returns: v.object({
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const { row } = await ensureSeededGlobalRow(ctx);
    const next = { ...row.values };

    for (const [key, value] of Object.entries(args.values)) {
      if (!isAppSettingKey(key)) {
        throw new Error(`Unknown or disallowed setting key: ${key}`);
      }
      const def = getAppSettingDefinition(key);
      if (!def) {
        continue;
      }
      const trimmed = value.trim();
      if (trimmed !== '') {
        try {
          parseAppSettingValue(key, trimmed);
        } catch (error: unknown) {
          if (error instanceof InvalidAppSettingError) {
            throw new Error(error.message);
          }
          throw error;
        }
      } else if (!def.optional) {
        throw new Error(`Setting '${key}' cannot be empty`);
      }
      if (def.optional && trimmed === '') {
        next[key] = '';
        continue;
      }
      next[key] = trimmed;
    }

    const now = Date.now();
    await ctx.db.patch(row._id, {
      values: next,
      updatedAt: now,
    });
    return { updatedAt: now };
  },
});

/**
 * Resolved allowlisted settings for Convex actions (env overrides stored values).
 * Caller should run `seedMissingSettings` first when the row may be incomplete.
 */
export const getEffective = internalQuery({
  args: {},
  returns: v.record(v.string(), v.string()),
  handler: async (ctx) => {
    const row = await getGlobalRow(ctx);
    const stored = row?.values ?? {};
    const env = buildProcessEnvRecord();
    return resolveAllSettingsRaw({ env, stored });
  },
});
