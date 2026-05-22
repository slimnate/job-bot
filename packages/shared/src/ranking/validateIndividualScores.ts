import type { RankingResult } from '../schemas/ranking.js';
import type { RankingCandidateInput } from './rankingPrompt.js';

/**
 * Ensures the model returned exactly one score object per expected posting (no global ordering).
 */
export function validateIndividualScores(
  candidates: RankingCandidateInput[],
  rankings: RankingResult[]
): RankingResult[] | null {
  const candidateIds = new Set(candidates.map((candidate) => candidate._id));
  const seen = new Set<string>();
  const matched: RankingResult[] = [];

  for (const ranking of rankings) {
    if (!candidateIds.has(ranking.postingId)) {
      return null;
    }
    if (seen.has(ranking.postingId)) {
      return null;
    }
    seen.add(ranking.postingId);
    matched.push(ranking);
  }

  if (seen.size !== candidates.length) {
    return null;
  }

  return matched;
}
