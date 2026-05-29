import { DEFAULT_DESCRIPTION_MAX_CHARS } from '../ranking/rankingPromptOptions.js';
import {
  truncateDescriptionForRanking,
  type RankingCandidateInput,
  type RankingEvaluatorInput,
} from '../ranking/rankingPrompt.js';

/** One prior completed outline version included in the prompt. */
export type CoverLetterPriorTurn = {
  userMessage: string;
  outline: string;
};

export type BuildCoverLetterOutlinePromptInput = {
  posting: RankingCandidateInput;
  evaluator: RankingEvaluatorInput;
  latestRankingSummary?: string | null;
  priorTurns: CoverLetterPriorTurn[];
  userMessage: string;
  descriptionMaxChars?: number;
  /** Max prior completed versions to include (default 10). */
  maxPriorTurns?: number;
};

export const DEFAULT_COVER_LETTER_USER_MESSAGE =
  'Generate a terse cover letter outline for this posting.';

const MAX_PRIOR_TURNS_DEFAULT = 10;

function section(title: string, body: string): string {
  return `## ${title}\n\n${body.trim()}\n`;
}

/**
 * Builds the user message for cover letter outline generation or revision.
 */
export function buildCoverLetterOutlinePrompt(input: BuildCoverLetterOutlinePromptInput): string {
  const maxChars = input.descriptionMaxChars ?? DEFAULT_DESCRIPTION_MAX_CHARS;
  const maxPrior = input.maxPriorTurns ?? MAX_PRIOR_TURNS_DEFAULT;
  const prior = input.priorTurns.slice(-maxPrior);

  const description = truncateDescriptionForRanking(
    input.posting.descriptionSnippet,
    maxChars
  );

  const jobLines = [
    `Title: ${input.posting.title}`,
    `Company: ${input.posting.company}`,
    `Source: ${input.posting.source}`,
    `URL: ${input.posting.url}`,
    input.posting.location ? `Location: ${input.posting.location}` : null,
    input.posting.salaryText ? `Salary: ${input.posting.salaryText}` : null,
    input.posting.postedAt ? `Posted at (epoch ms): ${input.posting.postedAt}` : null,
    '',
    'Description:',
    description ?? '(no description)',
  ]
    .filter((line) => line !== null)
    .join('\n');

  const parts: string[] = [section('Job posting', jobLines)];

  const evaluator = input.evaluator;
  if (evaluator?.resumeMarkdown?.trim() || evaluator?.rankingPrompt?.trim()) {
    const profileParts: string[] = [];
    if (evaluator.name?.trim()) {
      profileParts.push(`Profile name: ${evaluator.name.trim()}`);
    }
    if (evaluator.resumeMarkdown?.trim()) {
      profileParts.push('Resume (markdown):', evaluator.resumeMarkdown.trim());
    }
    if (evaluator.rankingPrompt?.trim()) {
      profileParts.push('Evaluation criteria (markdown):', evaluator.rankingPrompt.trim());
    }
    parts.push(section('Candidate profile', profileParts.join('\n\n')));
  } else {
    parts.push(
      section(
        'Candidate profile',
        '(No evaluator profile with resume or evaluation criteria was available.)'
      )
    );
  }

  const rankingSummary = input.latestRankingSummary?.trim();
  if (rankingSummary) {
    parts.push(section('Latest ranking summary', rankingSummary));
  }

  if (prior.length > 0) {
    const history = prior
      .map(
        (turn, index) =>
          `### Version ${index + 1}\n\n**Prompt:** ${turn.userMessage.trim()}\n\n**Outline:**\n${turn.outline.trim()}`
      )
      .join('\n\n');
    parts.push(section('Prior outline versions', history));
  }

  const userMessage = input.userMessage.trim() || DEFAULT_COVER_LETTER_USER_MESSAGE;
  const terseReminder =
    'Keep the outline terse: short phrase bullets, minimal repetition, skimmable in ~1 minute.';
  const taskBody =
    prior.length > 0
      ? `${userMessage}\n\nRevise the cover letter outline per the prompt above. Return the full revised outline using the context in this message. ${terseReminder}`
      : `${userMessage}\n\nProduce a cover letter outline using the context in this message. ${terseReminder}`;

  parts.push(section('Task', taskBody));

  return parts.join('\n');
}

/**
 * Normalizes a user-supplied prompt; empty input uses the default initial message.
 */
export function normalizeCoverLetterUserMessage(raw: string): string {
  const trimmed = raw.trim();
  return trimmed || DEFAULT_COVER_LETTER_USER_MESSAGE;
}
