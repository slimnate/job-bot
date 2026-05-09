import { mutation, query } from './_generated/server.js';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel.js';

export const get = query({
  args: {
    onlyActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (args.onlyActive ?? false) {
      return await ctx.db
        .query('job_evaluators')
        .withIndex('by_is_active', (q) => q.eq('isActive', true))
        .order('desc')
        .first();
    }

    return await ctx.db.query('job_evaluators').order('desc').first();
  },
});

export const getById = query({
  args: {
    id: v.id('job_evaluators'),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const listActive = query({
  args: {},
  handler: async (ctx) =>
    ctx.db
      .query('job_evaluators')
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
      .query('job_evaluators')
      .withIndex('by_updated_at')
      .order('desc')
      .take(limit);
  },
});

/**
 * Inserts a new evaluator profile with defaults. Does not change other profiles.
 */
export const create = mutation({
  args: {
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert('job_evaluators', {
      name: (args.name ?? 'New evaluator').trim() || 'New evaluator',
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
    id: v.optional(v.id('job_evaluators')),
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
        throw new Error('Evaluator profile not found.');
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

    return await ctx.db.insert('job_evaluators', {
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

/**
 * Deletes an evaluator profile when it is not referenced by runs or rankings.
 * This prevents orphaned foreign-key-style references in existing records.
 */
export const remove = mutation({
  args: {
    id: v.id('job_evaluators'),
  },
  handler: async (ctx, args) => {
    const evaluator = await ctx.db.get(args.id);
    if (!evaluator) {
      return { deleted: false };
    }

    const runs = await ctx.db.query('scrape_runs').take(500);
    if (runs.some((run) => run.evaluatorId === args.id)) {
      throw new Error('Cannot delete evaluator because it is referenced by one or more runs.');
    }

    const jobSources = await ctx.db.query('job_sources').collect();
    if (jobSources.some((row) => row.defaultEvaluatorId === args.id)) {
      throw new Error(
        'Cannot delete evaluator because a source uses it as the default evaluator. Clear it on the Sources page first.'
      );
    }

    const rankings = await ctx.db.query('job_rankings').take(500);
    if (rankings.some((ranking) => ranking.evaluatorId === args.id)) {
      throw new Error('Cannot delete evaluator because it is referenced by one or more rankings.');
    }

    await ctx.db.delete(args.id);
    return { deleted: true };
  },
});

/**
 * One-off helper for early-development cutovers:
 * copies a legacy `job_criteria` document into `job_evaluators` by document id.
 *
 * Note:
 * - Uses a narrow runtime shape check because the legacy table is no longer in the typed schema.
 * - Safe to run repeatedly; if a target evaluator already exists for the same migrated id marker, no-op.
 */
export const migrateLegacyCriteriaById = mutation({
  args: {
    legacyId: v.string(),
  },
  handler: async (ctx, args) => {
    const trimmedId = args.legacyId.trim();
    if (!trimmedId) {
      throw new Error('legacyId is required.');
    }

    const existingRows = await ctx.db.query('job_evaluators').take(200);
    const existing = existingRows.find((row) => row.notes === `[migratedFrom:${trimmedId}]`);
    if (existing) {
      return { kind: 'noop', evaluatorId: existing._id };
    }

    const legacyDoc = await (ctx.db as unknown as { get: (id: string) => Promise<Record<string, unknown> | null> }).get(trimmedId);
    if (!legacyDoc) {
      throw new Error(`Legacy document '${trimmedId}' not found.`);
    }

    const name = typeof legacyDoc.name === 'string' && legacyDoc.name.trim() ? legacyDoc.name.trim() : 'Migrated evaluator';
    const isActive = typeof legacyDoc.isActive === 'boolean' ? legacyDoc.isActive : false;
    const notesRaw = typeof legacyDoc.notes === 'string' ? legacyDoc.notes.trim() : '';
    const resumeMarkdown =
      typeof legacyDoc.resumeMarkdown === 'string' && legacyDoc.resumeMarkdown.trim()
        ? legacyDoc.resumeMarkdown.trim()
        : undefined;
    const rankingPrompt =
      typeof legacyDoc.rankingPrompt === 'string' && legacyDoc.rankingPrompt.trim()
        ? legacyDoc.rankingPrompt.trim()
        : undefined;
    const createdAt = typeof legacyDoc.createdAt === 'number' ? legacyDoc.createdAt : Date.now();
    const updatedAt = typeof legacyDoc.updatedAt === 'number' ? legacyDoc.updatedAt : createdAt;

    const evaluatorId = await ctx.db.insert('job_evaluators', {
      name,
      isActive,
      notes: notesRaw ? `${notesRaw}\n\n[migratedFrom:${trimmedId}]` : `[migratedFrom:${trimmedId}]`,
      resumeMarkdown,
      rankingPrompt,
      createdAt,
      updatedAt,
    });

    return { kind: 'migrated', evaluatorId: evaluatorId as Id<'job_evaluators'> };
  },
});
