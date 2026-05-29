import { DEFAULT_DESCRIPTION_MAX_CHARS } from '../ranking/rankingPromptOptions.js';
import {
  truncateDescriptionForRanking,
  type RankingCandidateInput,
  type RankingEvaluatorInput,
} from '../ranking/rankingPrompt.js';

/** One prior Q&A turn included in the prompt. */
export type PostingQaPriorTurn = {
  question: string;
  answer: string;
};

export type BuildPostingQaPromptInput = {
  posting: RankingCandidateInput;
  evaluator: RankingEvaluatorInput;
  latestRankingSummary?: string | null;
  priorTurns: PostingQaPriorTurn[];
  question: string;
  descriptionMaxChars?: number;
  /** Max prior completed exchanges to include (default 10). */
  maxPriorTurns?: number;
};

const MAX_PRIOR_TURNS_DEFAULT = 10;

function section(title: string, body: string): string {
  return `## ${title}\n\n${body.trim()}\n`;
}

/**
 * Builds the user message for posting Q&A (HTTP Chat Completions or Cursor CLI).
 */
export function buildPostingQaPrompt(input: BuildPostingQaPromptInput): string {
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
  }

  const rankingSummary = input.latestRankingSummary?.trim();
  if (rankingSummary) {
    parts.push(section('Latest ranking summary', rankingSummary));
  }

  if (prior.length > 0) {
    const history = prior
      .map(
        (turn, index) =>
          `### Exchange ${index + 1}\n\n**Question:** ${turn.question.trim()}\n\n**Answer:**\n${turn.answer.trim()}`
      )
      .join('\n\n');
    parts.push(section('Prior Q&A on this posting', history));
  }

  parts.push(
    section(
      'New question',
      `${input.question.trim()}\n\nAnswer the new question above using only the context in this message.`
    )
  );

  return parts.join('\n');
}
