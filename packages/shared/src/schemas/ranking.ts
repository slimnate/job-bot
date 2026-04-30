export type RankingResult = {
  postingId: string;
  rank: number;
  scoreOverall: number;
  reasoningSummary: string;
  criteriaMatch: Record<string, unknown>;
  redFlags: string[];
};
