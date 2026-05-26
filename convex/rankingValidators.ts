import { v } from 'convex/values';

/** Badge criteria stored on `job_rankings.criteriaMatchJson`. */
export const criteriaMatchValidator = v.object({
  matched: v.array(v.string()),
  unmet: v.array(v.string()),
});

/** Canonical rubric dimension scores stored on `job_rankings.dimensionScoresJson`. */
export const dimensionScoresValidator = v.object({
  technicalFit: v.number(),
  levelRealism: v.number(),
  workStyleScope: v.number(),
  compensationTransparency: v.number(),
  locationLogistics: v.number(),
  missionResonance: v.number(),
  processRedFlags: v.number(),
});

/** Partial dimension scores allowed on legacy rows after backfill. */
export const dimensionScoresPartialValidator = v.object({
  technicalFit: v.optional(v.number()),
  levelRealism: v.optional(v.number()),
  workStyleScope: v.optional(v.number()),
  compensationTransparency: v.optional(v.number()),
  locationLogistics: v.optional(v.number()),
  missionResonance: v.optional(v.number()),
  processRedFlags: v.optional(v.number()),
});
