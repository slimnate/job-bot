export type RankingResult = {
  postingId: string;
  scoreOverall: number;
  reasoningSummary: string;
  criteriaMatch: Record<string, unknown>;
  redFlags: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function validateRankingResult(value: unknown): RankingResult | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const postingId = record.postingId;
  const scoreOverall = record.scoreOverall;
  const reasoningSummary = record.reasoningSummary;
  const criteriaMatch = record.criteriaMatch;
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
  if (!criteriaMatch || typeof criteriaMatch !== 'object' || Array.isArray(criteriaMatch)) {
    return null;
  }
  if (!Array.isArray(redFlags) || redFlags.some((entry) => typeof entry !== 'string')) {
    return null;
  }

  return {
    postingId,
    scoreOverall,
    reasoningSummary: reasoningSummary.trim(),
    criteriaMatch: criteriaMatch as Record<string, unknown>,
    redFlags,
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
