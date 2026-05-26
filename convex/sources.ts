import { mutation, query } from './_generated/server.js';
import { v } from 'convex/values';
import { getCriteriaFieldMeta, sourceDefinitions, sourceKeyValidator } from './sourceContract.js';

import type { Id } from './_generated/dataModel.js';

/**
 * Returns all supported sources merged with persisted enabled state and optional defaults.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('job_sources').collect();
    const rowBySource = new Map(rows.map((row) => [row.source, row]));

    return Object.entries(sourceDefinitions).map(([source, definition]) => {
      const row = rowBySource.get(source);
      const criteriaFieldMeta = getCriteriaFieldMeta(source);
      return {
        source,
        displayName: definition.displayName,
        acceptedCriteriaFields: [...definition.acceptedCriteriaFields],
        criteriaFieldMeta: criteriaFieldMeta ? { ...criteriaFieldMeta } : undefined,
        isEnabled: row?.isEnabled ?? true,
        defaultEvaluatorId: row?.defaultEvaluatorId,
      };
    });
  },
});

/**
 * Worker: resolved default evaluator id for a source when the run row has no `evaluatorId`.
 */
export const defaultEvaluatorForSource = query({
  args: {
    source: v.string(),
  },
  handler: async (ctx, args) => {
    const normalized = args.source.trim().toLowerCase();
    const row = await ctx.db
      .query('job_sources')
      .withIndex('by_source', (q) => q.eq('source', normalized))
      .unique();
    return row?.defaultEvaluatorId ?? null;
  },
});

/**
 * Enables/disables a supported source.
 */
export const setEnabled = mutation({
  args: {
    source: sourceKeyValidator,
    isEnabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const definition = sourceDefinitions[args.source as keyof typeof sourceDefinitions];
    if (!definition) {
      throw new Error(`Unsupported source '${args.source}'.`);
    }
    const now = Date.now();
    const existing = await ctx.db
      .query('job_sources')
      .withIndex('by_source', (q) => q.eq('source', args.source))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        displayName: definition.displayName,
        isEnabled: args.isEnabled,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert('job_sources', {
      source: args.source,
      displayName: definition.displayName,
      isEnabled: args.isEnabled,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Sets the default evaluator profile for a source (used by the worker when a run has no explicit evaluator).
 * The evaluator must exist and be **Active** (available). Pass `null` to clear.
 */
export const setDefaultEvaluator = mutation({
  args: {
    source: sourceKeyValidator,
    defaultEvaluatorId: v.union(v.id('job_evaluators'), v.null()),
  },
  handler: async (ctx, args) => {
    const definition = sourceDefinitions[args.source as keyof typeof sourceDefinitions];
    if (!definition) {
      throw new Error(`Unsupported source '${args.source}'.`);
    }

    let defaultEvaluatorId: Id<'job_evaluators'> | undefined;
    if (args.defaultEvaluatorId !== null) {
      const evaluator = await ctx.db.get(args.defaultEvaluatorId);
      if (!evaluator) {
        throw new Error('Evaluator not found.');
      }
      if (!evaluator.isActive) {
        throw new Error(
          'That evaluator is not available for worker runs (turn on Active on the Evaluators page).'
        );
      }
      defaultEvaluatorId = args.defaultEvaluatorId;
    }

    const now = Date.now();
    const existing = await ctx.db
      .query('job_sources')
      .withIndex('by_source', (q) => q.eq('source', args.source))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        defaultEvaluatorId,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert('job_sources', {
      source: args.source,
      displayName: definition.displayName,
      isEnabled: true,
      defaultEvaluatorId,
      createdAt: now,
      updatedAt: now,
    });
  },
});
