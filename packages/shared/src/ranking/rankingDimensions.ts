/**
 * Canonical rubric dimension keys for job ranking (aligned with ranking-prompt.md).
 */
export const RANKING_DIMENSION_KEYS = [
  'technicalFit',
  'levelRealism',
  'workStyleScope',
  'compensationTransparency',
  'locationLogistics',
  'missionResonance',
  'processRedFlags',
] as const;

export type RankingDimensionKey = (typeof RANKING_DIMENSION_KEYS)[number];

/** Max points per dimension (rubric caps). */
export const RANKING_DIMENSION_MAX: Record<RankingDimensionKey, number> = {
  technicalFit: 25,
  levelRealism: 20,
  workStyleScope: 15,
  compensationTransparency: 10,
  locationLogistics: 10,
  missionResonance: 5,
  processRedFlags: 15,
};

/** Legacy and alias keys seen in LLM output → canonical key. */
export const DIMENSION_KEY_ALIASES: Record<string, RankingDimensionKey> = {
  technicalFit: 'technicalFit',
  levelRealism: 'levelRealism',
  workStyleScope: 'workStyleScope',
  compensationTransparency: 'compensationTransparency',
  locationLogistics: 'locationLogistics',
  missionResonance: 'missionResonance',
  processRedFlags: 'processRedFlags',
  roleLevel: 'levelRealism',
  workStyle: 'workStyleScope',
  compensation: 'compensationTransparency',
  compTransparency: 'compensationTransparency',
  location: 'locationLogistics',
  mission: 'missionResonance',
  hiringProcess: 'processRedFlags',
};

export type CriteriaMatchPayload = {
  matched: string[];
  unmet: string[];
};

export type DimensionScoresPayload = Record<RankingDimensionKey, number>;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  if (value.some((entry) => typeof entry !== 'string')) {
    return null;
  }
  return value.map((entry) => entry.trim()).filter(Boolean);
}

/**
 * True when a criteriaMatchJson entry is a numeric rubric dimension score (legacy mixed payloads).
 */
export function isDimensionScoreEntry(key: string, value: unknown): boolean {
  if (key === 'matched' || key === 'unmet') {
    return false;
  }
  if (DIMENSION_KEY_ALIASES[key] !== undefined && typeof value === 'number' && !Number.isNaN(value)) {
    return true;
  }
  return typeof value === 'number' && !Number.isNaN(value);
}

/**
 * Validates `{ matched, unmet }` string arrays (empty arrays allowed).
 */
export function validateCriteriaMatch(value: unknown): CriteriaMatchPayload | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  if (record.matched !== undefined && toStringArray(record.matched) === null) {
    return null;
  }
  if (record.unmet !== undefined && toStringArray(record.unmet) === null) {
    return null;
  }
  const matched = toStringArray(record.matched) ?? [];
  const unmet = toStringArray(record.unmet) ?? [];
  for (const [key, val] of Object.entries(record)) {
    if (key === 'matched' || key === 'unmet') {
      continue;
    }
    if (isDimensionScoreEntry(key, val)) {
      return null;
    }
    if (val !== undefined && val !== null && val !== '') {
      return null;
    }
  }
  return { matched, unmet };
}

/**
 * Maps alias keys to canonical dimension scores; ignores matched/unmet.
 * Returns null if any non-alias non-numeric entries are present.
 */
export function normalizeDimensionScores(
  input: Record<string, unknown>
): Partial<DimensionScoresPayload> | null {
  const out: Partial<DimensionScoresPayload> = {};

  for (const [key, value] of Object.entries(input)) {
    if (key === 'matched' || key === 'unmet') {
      continue;
    }
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return null;
    }
    const canonical = DIMENSION_KEY_ALIASES[key];
    if (!canonical) {
      return null;
    }
    const score = Math.round(value);
    const max = RANKING_DIMENSION_MAX[canonical];
    if (score < 0 || score > max) {
      return null;
    }
    out[canonical] = score;
  }

  return out;
}

/**
 * Builds a full canonical dimension object when all seven scores are present and valid.
 */
export function toFullDimensionScores(
  partial: Partial<DimensionScoresPayload>
): DimensionScoresPayload | null {
  const full = {} as DimensionScoresPayload;
  for (const key of RANKING_DIMENSION_KEYS) {
    const score = partial[key];
    if (typeof score !== 'number' || Number.isNaN(score)) {
      return null;
    }
    full[key] = score;
  }
  return full;
}

export type SplitLegacyRankingPayloadResult = {
  criteriaMatch: CriteriaMatchPayload;
  dimensionScores: DimensionScoresPayload | null;
};

/**
 * Separates badge criteria from numeric rubric scores when the model mixes them in criteriaMatch.
 */
export function splitLegacyRankingPayload(
  criteriaMatch: unknown,
  dimensionScores?: unknown
): SplitLegacyRankingPayloadResult | null {
  const criteriaRecord = asRecord(criteriaMatch);
  if (!criteriaRecord) {
    return null;
  }

  const matched = toStringArray(criteriaRecord.matched) ?? [];
  const unmet = toStringArray(criteriaRecord.unmet) ?? [];
  if (criteriaRecord.matched !== undefined && toStringArray(criteriaRecord.matched) === null) {
    return null;
  }
  if (criteriaRecord.unmet !== undefined && toStringArray(criteriaRecord.unmet) === null) {
    return null;
  }

  const combined: Record<string, unknown> = { ...criteriaRecord };
  const extra = asRecord(dimensionScores);
  if (extra) {
    Object.assign(combined, extra);
  }

  const normalized = normalizeDimensionScores(combined);
  if (normalized === null) {
    return null;
  }

  for (const [key, val] of Object.entries(criteriaRecord)) {
    if (key === 'matched' || key === 'unmet') {
      continue;
    }
    if (!isDimensionScoreEntry(key, val) && val !== undefined && val !== null && val !== '') {
      return null;
    }
  }

  const full = toFullDimensionScores(normalized);
  return {
    criteriaMatch: { matched, unmet },
    dimensionScores: full,
  };
}
