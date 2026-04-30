import { mutation, query } from './_generated/server.js';
import { v } from 'convex/values';

const remotePolicyValidator = v.optional(
  v.union(
    v.literal('remote'),
    v.literal('hybrid'),
    v.literal('onsite'),
    v.literal('any')
  )
);

const seniorityValidator = v.optional(
  v.union(
    v.literal('intern'),
    v.literal('junior'),
    v.literal('mid'),
    v.literal('senior'),
    v.literal('staff'),
    v.literal('principal'),
    v.literal('any')
  )
);

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

export const listActive = query({
  args: {},
  handler: async (ctx) =>
    ctx.db
      .query('job_criteria')
      .withIndex('by_is_active', (q) => q.eq('isActive', true))
      .collect(),
});

export const upsert = mutation({
  args: {
    id: v.optional(v.id('job_criteria')),
    name: v.string(),
    isActive: v.boolean(),
    titleKeywords: v.array(v.string()),
    excludedKeywords: v.array(v.string()),
    locations: v.array(v.string()),
    remotePolicy: remotePolicyValidator,
    salaryHints: v.optional(v.array(v.string())),
    seniority: seniorityValidator,
    targetSources: v.array(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existingId =
      args.id ??
      (await ctx.db
        .query('job_criteria')
        .withIndex('by_is_active', (q) => q.eq('isActive', true))
        .first())?._id;

    if (args.isActive) {
      const activeCriteria = await ctx.db
        .query('job_criteria')
        .withIndex('by_is_active', (q) => q.eq('isActive', true))
        .collect();

      for (const criterion of activeCriteria) {
        if (criterion._id !== existingId) {
          await ctx.db.patch(criterion._id, { isActive: false, updatedAt: now });
        }
      }
    }

    if (existingId) {
      await ctx.db.patch(existingId, {
        name: args.name,
        isActive: args.isActive,
        titleKeywords: args.titleKeywords,
        excludedKeywords: args.excludedKeywords,
        locations: args.locations,
        remotePolicy: args.remotePolicy,
        salaryHints: args.salaryHints,
        seniority: args.seniority,
        targetSources: args.targetSources,
        notes: args.notes,
        updatedAt: now,
      });
      return existingId;
    }

    return await ctx.db.insert('job_criteria', {
      name: args.name,
      isActive: args.isActive,
      titleKeywords: args.titleKeywords,
      excludedKeywords: args.excludedKeywords,
      locations: args.locations,
      remotePolicy: args.remotePolicy,
      salaryHints: args.salaryHints,
      seniority: args.seniority,
      targetSources: args.targetSources,
      notes: args.notes,
      createdAt: now,
      updatedAt: now,
    });
  },
});
