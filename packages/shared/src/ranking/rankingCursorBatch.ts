import {
  type RankingCandidateInput,
  type RankingEvaluatorInput,
} from './rankingPrompt.js';

export const RANKING_BATCHES_DIR = '.ranking-batches';

export type CursorBatchPaths = {
  batchDir: string;
  postingsPath: string;
  evaluatorPath: string;
  resultsPath: string;
  postingsRelative: string;
  evaluatorRelative: string;
  resultsRelative: string;
};

/**
 * Relative paths under the CLI workspace for one ranking batch.
 */
export function cursorBatchPaths(batchId: string): CursorBatchPaths {
  const batchDir = `${RANKING_BATCHES_DIR}/${batchId}`;
  return {
    batchDir,
    postingsPath: `${batchDir}/postings.json`,
    evaluatorPath: `${batchDir}/evaluator.json`,
    resultsPath: `${batchDir}/results.json`,
    postingsRelative: `${batchDir}/postings.json`,
    evaluatorRelative: `${batchDir}/evaluator.json`,
    resultsRelative: `${batchDir}/results.json`,
  };
}

/**
 * Short argv prompt: agent reads input batch files and writes scores to results.json.
 */
export function buildCursorFileRankingPrompt(
  batchId: string,
  postingIds: string[],
  options: { forceResultsFileReminder?: boolean } = {}
): string {
  const paths = cursorBatchPaths(batchId);
  const idList = postingIds.map((id) => `- ${id}`).join('\n');

  const lines = [
    'Score each job posting independently for the evaluator profile in the workspace files.',
    'Use your file read tool ONLY for these paths (do not search the workspace or codebase):',
    `- ${paths.evaluatorRelative}`,
    `- ${paths.postingsRelative}`,
    '',
    'Instructions:',
    '- Read evaluator.json for profile name, resume, and user scoring instructions.',
    '- Read postings.json (array of jobs with full descriptions).',
    '- Score each posting 0-100 on its own merit; do not rank postings against each other.',
    `- Write the full score array to ${paths.resultsRelative} using your write tool (overwrite the file).`,
    '- If file write is unavailable, include the full JSON array in your final message inside a ```json fenced block.',
    '- Do not put only a short summary on stdout without the JSON array.',
    '',
    'Each results.json array element must include:',
    '- postingId (exact string from postings.json)',
    '- scoreOverall (0-100)',
    '- reasoningSummary',
    '- criteriaMatch: { matched: string[], unmet: string[] } only — short criteria bullets, no numeric rubric scores',
    '- dimensionScores: { technicalFit, levelRealism, workStyleScope, compensationTransparency, locationLogistics, missionResonance, processRedFlags } — integers within each dimension max',
    '- redFlags (string array, may be empty)',
    '',
    'Expected postingId values (one result each):',
    idList,
  ];

  if (options.forceResultsFileReminder) {
    lines.push(
      '',
      `IMPORTANT: You must write valid JSON to ${paths.resultsRelative} with exactly one object per postingId above.`
    );
  }

  return lines.join('\n');
}

/** Payload shape for evaluator.json in a Cursor batch directory. */
export function buildEvaluatorBatchPayload(evaluator: RankingEvaluatorInput): Record<string, unknown> {
  return {
    name: evaluator?.name ?? null,
    rankingPrompt: evaluator?.rankingPrompt ?? null,
    resumeMarkdown: evaluator?.resumeMarkdown ?? null,
  };
}

export type { RankingCandidateInput, RankingEvaluatorInput };
