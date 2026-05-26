import {
  normalizeDimensionScores,
  splitLegacyRankingPayload,
  toFullDimensionScores,
  type CriteriaMatchPayload,
  type DimensionScoresPayload,
} from '@job-bot/shared';

export type PersistedRankingFields = {
  criteriaMatchJson: CriteriaMatchPayload;
  dimensionScoresJson: Partial<DimensionScoresPayload> | DimensionScoresPayload | undefined;
};

/**
 * Normalizes LLM ranking payloads before writing to `job_rankings`.
 */
export function normalizeRankingForPersist(
  criteriaMatch: unknown,
  dimensionScores?: unknown
): PersistedRankingFields | null {
  const split = splitLegacyRankingPayload(criteriaMatch, dimensionScores);
  if (!split) {
    return null;
  }
  return {
    criteriaMatchJson: split.criteriaMatch,
    dimensionScoresJson: split.dimensionScores ?? undefined,
  };
}

/**
 * Migrates a legacy `criteriaMatchJson` blob into separated criteria + dimension fields.
 */
export function migrateLegacyRankingRow(criteriaMatchJson: unknown, dimensionScoresJson?: unknown): PersistedRankingFields | null {
  const existing = dimensionScoresJson;
  const split = splitLegacyRankingPayload(criteriaMatchJson, existing);
  if (split?.dimensionScores) {
    return {
      criteriaMatchJson: split.criteriaMatch,
      dimensionScoresJson: split.dimensionScores,
    };
  }

  const record =
    criteriaMatchJson && typeof criteriaMatchJson === 'object' && !Array.isArray(criteriaMatchJson)
      ? (criteriaMatchJson as Record<string, unknown>)
      : null;
  if (!record) {
    return null;
  }

  const matched = Array.isArray(record.matched)
    ? record.matched.filter((e): e is string => typeof e === 'string')
    : [];
  const unmet = Array.isArray(record.unmet) ? record.unmet.filter((e): e is string => typeof e === 'string') : [];

  const normalized = normalizeDimensionScores(record);
  const fromExisting =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? normalizeDimensionScores(existing as Record<string, unknown>)
      : null;
  const merged: Partial<DimensionScoresPayload> = { ...fromExisting, ...normalized };
  const full = Object.keys(merged).length > 0 ? toFullDimensionScores(merged) : null;

  return {
    criteriaMatchJson: { matched, unmet },
    dimensionScoresJson: full ?? (Object.keys(merged).length > 0 ? (merged as DimensionScoresPayload) : undefined),
  };
}
