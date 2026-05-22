import {
  type RankingCandidateInput,
  type RankingEvaluatorInput,
} from './rankingPrompt.js';

export const RANKING_BATCHES_DIR = '.ranking-batches';

export type CursorBatchPaths = {
  batchDir: string;
  postingsPath: string;
  evaluatorPath: string;
  postingsRelative: string;
  evaluatorRelative: string;
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
    postingsRelative: `${batchDir}/postings.json`,
    evaluatorRelative: `${batchDir}/evaluator.json`,
  };
}

/**
 * Short argv prompt: agent reads batch files via tools and returns a JSON score array.
 */
export function buildCursorFileRankingPrompt(batchId: string, postingIds: string[]): string {
  const paths = cursorBatchPaths(batchId);
  const idList = postingIds.map((id) => `- ${id}`).join('\n');

  return [
    'Score each job posting independently for the evaluator profile in the batch files.',
    'Use your file read tool ONLY for these paths (do not search the workspace or codebase):',
    `- ${paths.evaluatorRelative}`,
    `- ${paths.postingsRelative}`,
    '',
    'Instructions:',
    '- Read evaluator.json for profile name, resume, and user scoring instructions.',
    '- Read postings.json (array of jobs with full descriptions).',
    '- Score each posting 0-100 on its own merit; do not rank postings against each other.',
    '- Return one JSON array only (no markdown fences, no prose).',
    '',
    'Each array element must include:',
    '- postingId (exact string from the file)',
    '- scoreOverall (0-100)',
    '- reasoningSummary',
    '- criteriaMatch (object)',
    '- redFlags (string array, may be empty)',
    '',
    'Expected postingId values (one result each):',
    idList,
    '',
    'Return the JSON array only.',
  ].join('\n');
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
