import {
  DEFAULT_DESCRIPTION_MAX_CHARS,
  type RankingPromptOptions,
} from './rankingPromptOptions.js';

export type { RankingPromptOptions } from './rankingPromptOptions.js';

/** Minimal posting fields sent to rankers (worker + Convex). */
export type RankingCandidateInput = {
  _id: string;
  title: string;
  company: string;
  location?: string;
  salaryText?: string;
  descriptionSnippet?: string;
  postedAt?: string;
  url: string;
  source: string;
};

/** Evaluator fields included in ranking prompts (worker and Convex profiles). */
export type RankingEvaluatorInput = {
  name?: string;
  rankingPrompt?: string;
  resumeMarkdown?: string;
} | null;

export type BuildRankingPromptOptions = RankingPromptOptions;

const TRUNCATION_SUFFIX = '… [truncated for ranking]';

function strTrim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Truncates description text for HTTP ranker prompts without mutating stored postings.
 */
export function truncateDescriptionForRanking(
  descriptionSnippet: string | undefined | null,
  maxChars: number
): string | null {
  if (descriptionSnippet == null) {
    return null;
  }
  const trimmed = descriptionSnippet.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  const keep = Math.max(0, maxChars - TRUNCATION_SUFFIX.length);
  return trimmed.slice(0, keep).replace(/\s+$/, '') + TRUNCATION_SUFFIX;
}

/**
 * Serializes one posting for an inline HTTP prompt (may truncate description).
 */
export function serializeCandidateForPrompt(
  candidate: RankingCandidateInput,
  options?: BuildRankingPromptOptions
): Record<string, unknown> {
  const descriptionMaxChars = options?.descriptionMaxChars ?? DEFAULT_DESCRIPTION_MAX_CHARS;
  const omitUrl = options?.omitUrl !== false;
  const body: Record<string, unknown> = {
    postingId: candidate._id,
    title: candidate.title,
    company: candidate.company,
    location: candidate.location ?? null,
    salaryText: candidate.salaryText ?? null,
    postedAt: candidate.postedAt ?? null,
    source: candidate.source,
    descriptionSnippet: truncateDescriptionForRanking(
      candidate.descriptionSnippet,
      descriptionMaxChars
    ),
  };
  if (!omitUrl) {
    body.url = candidate.url;
  }
  return body;
}

/**
 * Full posting payload for Cursor batch files (no description truncation).
 */
export function serializeCandidateForBatchFile(candidate: RankingCandidateInput): Record<string, unknown> {
  const trimmed = candidate.descriptionSnippet?.trim();
  return {
    postingId: candidate._id,
    title: candidate.title,
    company: candidate.company,
    location: candidate.location ?? null,
    salaryText: candidate.salaryText ?? null,
    postedAt: candidate.postedAt ?? null,
    source: candidate.source,
    descriptionSnippet: trimmed && trimmed.length > 0 ? trimmed : null,
  };
}

/**
 * Builds the user prompt for HTTP scoring (evaluator + one or more postings inline).
 */
export function buildRankingPrompt(
  evaluator: RankingEvaluatorInput,
  candidates: RankingCandidateInput[],
  options?: BuildRankingPromptOptions
): string {
  const c = evaluator;
  const profileName = strTrim(c?.name);
  const rankingPrompt = strTrim(c?.rankingPrompt);
  const resumeMarkdown = strTrim(c?.resumeMarkdown);

  const sections: string[] = [
    'Evaluator context:',
    profileName.length > 0 ? `- Profile name: ${profileName}` : '- Profile name: (not provided)',
    rankingPrompt.length > 0
      ? `- User scoring instructions: ${rankingPrompt}`
      : '- User scoring instructions: (not provided)',
    resumeMarkdown.length > 0 ? `- Resume markdown:\n${resumeMarkdown}` : '- Resume markdown: (not provided)',
    '',
    'Score each job posting independently for this user profile (0-100). Do not compare postings.',
    'Return JSON only. Do not include markdown.',
    'Output requirements:',
    '- Return one object per input posting, with no omissions and no extras.',
    '- Use the exact postingId values from input.',
    '- scoreOverall is 0..100 (higher is a better fit for this candidate).',
    '- reasoningSummary is concise and specific (include the rubric score table per evaluator instructions).',
    '- criteriaMatch has only matched and unmet: string arrays of short criteria bullets (green/yellow flags). Do not put numeric rubric scores in criteriaMatch.',
    '- dimensionScores has exactly these numeric keys (rubric points earned per dimension): technicalFit (0-25), levelRealism (0-20), workStyleScope (0-15), compensationTransparency (0-10), locationLogistics (0-10), missionResonance (0-5), processRedFlags (0-15).',
    '- redFlags is an array of strings and can be empty.',
    '',
  ];

  sections.push('Postings to score:');
  for (const [index, candidate] of candidates.entries()) {
    sections.push(
      `Posting ${index + 1}:`,
      JSON.stringify(serializeCandidateForPrompt(candidate, options)),
      ''
    );
  }
  sections.push('Return one JSON array containing all score objects.');

  return sections.join('\n');
}
