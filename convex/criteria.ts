import { mutation, query } from './_generated/server.js';
import { v } from 'convex/values';

export const get = query({
  args: {
    onlyActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (args.onlyActive ?? false) {
      return await ctx.db
        .query('job_criteria')
        .withIndex('by_is_active', (q) => q.eq('isActive', true))
        .order('desc')
        .first();
    }

    return await ctx.db.query('job_criteria').order('desc').first();
  },
});

export const getById = query({
  args: {
    id: v.id('job_criteria'),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const listActive = query({
  args: {},
  handler: async (ctx) =>
    ctx.db
      .query('job_criteria')
      .withIndex('by_is_active', (q) => q.eq('isActive', true))
      .collect(),
});

export const list = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit && args.limit > 0 ? args.limit : 50;
    return ctx.db
      .query('job_criteria')
      .withIndex('by_updated_at')
      .order('desc')
      .take(limit);
  },
});

/**
 * Inserts a new criteria profile with defaults. Does not change which row is active.
 */
export const create = mutation({
  args: {
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert('job_criteria', {
      name: (args.name ?? 'New profile').trim() || 'New profile',
      isActive: false,
      notes: undefined,
      resumeMarkdown: undefined,
      rankingPrompt: undefined,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const upsert = mutation({
  args: {
    id: v.optional(v.id('job_criteria')),
    name: v.string(),
    isActive: v.boolean(),
    notes: v.optional(v.string()),
    resumeMarkdown: v.optional(v.string()),
    rankingPrompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    if (args.id) {
      const existing = await ctx.db.get(args.id);
      if (!existing) {
        throw new Error('Criteria profile not found.');
      }

      if (args.isActive) {
        const activeCriteria = await ctx.db
          .query('job_criteria')
          .withIndex('by_is_active', (q) => q.eq('isActive', true))
          .collect();

        for (const criterion of activeCriteria) {
          if (criterion._id !== args.id) {
            await ctx.db.patch(criterion._id, { isActive: false, updatedAt: now });
          }
        }
      }

      await ctx.db.patch(args.id, {
        name: args.name,
        isActive: args.isActive,
        notes: args.notes,
        resumeMarkdown: args.resumeMarkdown,
        rankingPrompt: args.rankingPrompt,
        updatedAt: now,
      });
      return args.id;
    }

    if (args.isActive) {
      const activeCriteria = await ctx.db
        .query('job_criteria')
        .withIndex('by_is_active', (q) => q.eq('isActive', true))
        .collect();

      for (const criterion of activeCriteria) {
        await ctx.db.patch(criterion._id, { isActive: false, updatedAt: now });
      }
    }

    return await ctx.db.insert('job_criteria', {
      name: args.name,
      isActive: args.isActive,
      notes: args.notes,
      resumeMarkdown: args.resumeMarkdown,
      rankingPrompt: args.rankingPrompt,
      createdAt: now,
      updatedAt: now,
    });
  },
});
