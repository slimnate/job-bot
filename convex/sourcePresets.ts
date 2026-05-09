import { mutation, query } from './_generated/server.js';
import { v } from 'convex/values';
import { normalizeSourceCriteria, sourceKeyValidator } from './sourceContract.js';

export const listBySource = query({
  args: {
    source: sourceKeyValidator,
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('source_presets')
      .withIndex('by_source_and_updated_at', (q) => q.eq('source', args.source))
      .order('desc')
      .collect();
  },
});

/**
 * Creates a source preset after source-aware criteria normalization.
 */
export const create = mutation({
  args: {
    source: sourceKeyValidator,
    name: v.string(),
    sourceCriteria: v.record(v.string(), v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const normalized = normalizeSourceCriteria(args.source, args.sourceCriteria);
    const now = Date.now();
    return await ctx.db.insert('source_presets', {
      source: args.source,
      name: args.name.trim() || 'Untitled preset',
      sourceCriteria: normalized,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id('source_presets'),
    name: v.string(),
    sourceCriteria: v.record(v.string(), v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new Error('Preset not found.');
    }
    const normalized = normalizeSourceCriteria(existing.source, args.sourceCriteria);
    await ctx.db.patch(args.id, {
      name: args.name.trim() || 'Untitled preset',
      sourceCriteria: normalized,
      updatedAt: Date.now(),
    });
    return args.id;
  },
});

export const remove = mutation({
  args: {
    id: v.id('source_presets'),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      return { deleted: false };
    }
    await ctx.db.delete(args.id);
    return { deleted: true };
  },
});
