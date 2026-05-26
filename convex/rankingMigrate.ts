import { v } from 'convex/values';
import { isDimensionScoreEntry } from '@job-bot/shared';
import { internal } from './_generated/api.js';
import { internalMutation } from './_generated/server.js';
import { migrateLegacyRankingRow } from './rankingPersist.js';

/**
 * True when `criteriaMatchJson` still contains legacy numeric rubric keys.
 */
function criteriaMatchHasLegacyNumericKeys(criteriaMatchJson: unknown): boolean {
  if (!criteriaMatchJson || typeof criteriaMatchJson !== 'object' || Array.isArray(criteriaMatchJson)) {
    return false;
  }
  return Object.entries(criteriaMatchJson as Record<string, unknown>).some(([key, value]) =>
    isDimensionScoreEntry(key, value)
  );
}

/**
 * Schedules a batched backfill that moves numeric rubric keys out of `criteriaMatchJson`.
 */
export const startBackfill = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize =
      args.batchSize && args.batchSize > 0 ? Math.min(Math.floor(args.batchSize), 200) : 100;
    await ctx.scheduler.runAfter(0, internal.rankingMigrate.backfillDimensionScores, {
      batchSize,
      cursor: null,
    });
    return { started: true, batchSize };
  },
});

/**
 * Patches legacy ranking rows in pages; re-schedules until pagination completes.
 */
export const backfillDimensionScores = internalMutation({
  args: {
    batchSize: v.number(),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db.query('job_rankings').paginate({
      numItems: args.batchSize,
      cursor: args.cursor,
    });

    let patched = 0;
    for (const row of page.page) {
      const hasLegacyNumericKeys = criteriaMatchHasLegacyNumericKeys(row.criteriaMatchJson);
      if (!hasLegacyNumericKeys) {
        continue;
      }

      const migrated = migrateLegacyRankingRow(row.criteriaMatchJson, row.dimensionScoresJson);
      if (!migrated) {
        continue;
      }

      await ctx.db.patch(row._id, {
        criteriaMatchJson: migrated.criteriaMatchJson,
        dimensionScoresJson: migrated.dimensionScoresJson,
        updatedAt: Date.now(),
      });
      patched += 1;
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.rankingMigrate.backfillDimensionScores, {
        batchSize: args.batchSize,
        cursor: page.continueCursor,
      });
    }

    return {
      scanned: page.page.length,
      patched,
      isDone: page.isDone,
    };
  },
});
