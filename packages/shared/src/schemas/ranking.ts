import {
  normalizeDimensionScores,
  splitLegacyRankingPayload,
  type CriteriaMatchPayload,
  type DimensionScoresPayload,
} from '../ranking/rankingDimensions.js';

export type { CriteriaMatchPayload, DimensionScoresPayload };

export type RankingResult = {
  postingId: string;
  scoreOverall: number;
  reasoningSummary: string;
  criteriaMatch: CriteriaMatchPayload;
  /** Full for HTTP strict schema; may be partial when Cursor returns legacy mixed criteriaMatch. */
  dimensionScores: Partial<DimensionScoresPayload>;
  redFlags: string[];
};

function mergeDimensionScores(
  criteriaMatch: unknown,
  dimensionScores: unknown
): Partial<DimensionScoresPayload> {
  const split = splitLegacyRankingPayload(criteriaMatch, dimensionScores);
  if (split?.dimensionScores) {
    return split.dimensionScores;
  }
  const combined: Record<string, unknown> = {};
  const criteriaRecord = asRecord(criteriaMatch);
  if (criteriaRecord) {
    Object.assign(combined, criteriaRecord);
  }
  const dimensionRecord = asRecord(dimensionScores);
  if (dimensionRecord) {
    Object.assign(combined, dimensionRecord);
  }
  return normalizeDimensionScores(combined) ?? {};
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseRankingResultBase(record: Record<string, unknown>): {
  postingId: string;
  scoreOverall: number;
  reasoningSummary: string;
  criteriaMatch: unknown;
  dimensionScores: unknown;
  redFlags: string[];
} | null {
  const postingId = record.postingId;
  const scoreOverall = record.scoreOverall;
  const reasoningSummary = record.reasoningSummary;
  const criteriaMatch = record.criteriaMatch;
  const dimensionScores = record.dimensionScores;
  const redFlags = record.redFlags;

  if (typeof postingId !== 'string' || postingId.length === 0) {
    return null;
  }
  if (typeof scoreOverall !== 'number' || scoreOverall < 0 || scoreOverall > 100) {
    return null;
  }
  if (typeof reasoningSummary !== 'string' || reasoningSummary.trim().length === 0) {
    return null;
  }
  if (!Array.isArray(redFlags) || redFlags.some((entry) => typeof entry !== 'string')) {
    return null;
  }

  return {
    postingId,
    scoreOverall,
    reasoningSummary: reasoningSummary.trim(),
    criteriaMatch,
    dimensionScores,
    redFlags,
  };
}

/**
 * Strict validator for HTTP OpenAI responses (json_schema requires all rubric dimensions).
 */
export function validateRankingResult(value: unknown): RankingResult | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const base = parseRankingResultBase(record);
  if (!base) {
    return null;
  }

  const split = splitLegacyRankingPayload(base.criteriaMatch, base.dimensionScores);
  if (!split || !split.dimensionScores) {
    return null;
  }

  return {
    postingId: base.postingId,
    scoreOverall: base.scoreOverall,
    reasoningSummary: base.reasoningSummary,
    criteriaMatch: split.criteriaMatch,
    dimensionScores: split.dimensionScores,
    redFlags: base.redFlags,
  };
}

/**
 * Lenient validator for Cursor CLI `results.json` / stdout (legacy numeric criteriaMatch allowed).
 */
export function validateCursorRankingResult(value: unknown): RankingResult | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const base = parseRankingResultBase(record);
  if (!base) {
    return null;
  }

  const split = splitLegacyRankingPayload(base.criteriaMatch, base.dimensionScores);
  if (!split) {
    return null;
  }

  const dimensionScores = mergeDimensionScores(base.criteriaMatch, base.dimensionScores);

  return {
    postingId: base.postingId,
    scoreOverall: base.scoreOverall,
    reasoningSummary: base.reasoningSummary,
    criteriaMatch: split.criteriaMatch,
    dimensionScores,
    redFlags: base.redFlags,
  };
}

export function validateRankingResults(value: unknown): RankingResult[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const parsed: RankingResult[] = [];
  for (const item of value) {
    const result = validateRankingResult(item);
    if (!result) {
      return null;
    }
    parsed.push(result);
  }

  return parsed;
}

/**
 * Validates a Cursor CLI score array (accepts pre-split or legacy mixed criteriaMatch).
 */
export function validateCursorRankingResults(value: unknown): RankingResult[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const parsed: RankingResult[] = [];
  for (const item of value) {
    const result = validateCursorRankingResult(item);
    if (!result) {
      return null;
    }
    parsed.push(result);
  }

  return parsed;
}
