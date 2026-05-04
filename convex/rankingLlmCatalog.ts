import { mutation, query } from './_generated/server.js';
import { v } from 'convex/values';

const surfaceValidator = v.union(v.literal('convex_http'), v.literal('worker_cursor'));

const providerInputValidator = v.object({
  key: v.string(),
  displayName: v.string(),
  surface: surfaceValidator,
  sortOrder: v.number(),
});

const modelInputValidator = v.object({
  providerKey: v.string(),
  apiModelId: v.string(),
  displayName: v.string(),
  sortOrder: v.number(),
});

/**
 * Providers and models for the manual Score dialog, ordered for display.
 */
export const listForUi = query({
  args: {},
  handler: async (ctx) => {
    const providers = await ctx.db.query('ranking_llm_providers').collect();
    const models = await ctx.db.query('ranking_llm_models').collect();

    const sortedProviders = [...providers].sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));

    return sortedProviders.map((p) => ({
      _id: p._id,
      key: p.key,
      displayName: p.displayName,
      surface: p.surface,
      sortOrder: p.sortOrder,
      models: models
        .filter((m) => m.providerKey === p.key)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName))
        .map((m) => ({
          _id: m._id,
          apiModelId: m.apiModelId,
          displayName: m.displayName,
          sortOrder: m.sortOrder,
        })),
    }));
  },
});

/**
 * Replaces the entire ranking LLM catalog.
 */
export const replaceCatalog = mutation({
  args: {
    providers: v.array(providerInputValidator),
    models: v.array(modelInputValidator),
  },
  handler: async (ctx, args) => {
    if (args.providers.length > 50) {
      throw new Error('Too many providers (max 50).');
    }
    if (args.models.length > 800) {
      throw new Error('Too many models (max 800).');
    }

    const now = Date.now();

    for (const row of await ctx.db.query('ranking_llm_models').collect()) {
      await ctx.db.delete(row._id);
    }
    for (const row of await ctx.db.query('ranking_llm_providers').collect()) {
      await ctx.db.delete(row._id);
    }

    for (const p of args.providers) {
      const key = p.key.trim().toLowerCase();
      if (!key) {
        throw new Error('Provider key cannot be empty.');
      }
      await ctx.db.insert('ranking_llm_providers', {
        key,
        displayName: p.displayName.trim() || key,
        surface: p.surface,
        sortOrder: p.sortOrder,
        createdAt: now,
        updatedAt: now,
      });
    }

    const providerKeys = new Set(args.providers.map((p) => p.key.trim().toLowerCase()));
    for (const m of args.models) {
      const pk = m.providerKey.trim().toLowerCase();
      if (!providerKeys.has(pk)) {
        throw new Error(`Model references unknown providerKey '${m.providerKey}'.`);
      }
      const apiModelId = m.apiModelId.trim();
      if (!apiModelId) {
        throw new Error('apiModelId cannot be empty.');
      }
      await ctx.db.insert('ranking_llm_models', {
        providerKey: pk,
        apiModelId,
        displayName: m.displayName.trim() || apiModelId,
        sortOrder: m.sortOrder,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { providerCount: args.providers.length, modelCount: args.models.length };
  },
});
