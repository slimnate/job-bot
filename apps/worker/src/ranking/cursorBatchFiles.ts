import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  buildEvaluatorBatchPayload,
  cursorBatchPaths,
  serializeCandidateForBatchFile,
  validateCursorRankingResults,
  type CursorBatchPaths,
  type RankingCandidateInput,
  type RankingEvaluatorInput,
  type RankingResult,
} from '@job-bot/shared';

/**
 * Writes postings (full descriptions) and evaluator JSON for Cursor CLI file reads.
 */
export async function writeCursorRankingBatchFiles(
  workspaceDir: string,
  batchId: string,
  evaluator: RankingEvaluatorInput,
  candidates: RankingCandidateInput[]
): Promise<CursorBatchPaths> {
  const paths = cursorBatchPaths(batchId);
  const absoluteBatchDir = join(workspaceDir, paths.batchDir);
  await mkdir(absoluteBatchDir, { recursive: true });

  const postingsPayload = candidates.map((candidate) => serializeCandidateForBatchFile(candidate));
  await writeFile(join(workspaceDir, paths.postingsPath), JSON.stringify(postingsPayload, null, 2), 'utf8');
  await writeFile(
    join(workspaceDir, paths.evaluatorPath),
    JSON.stringify(buildEvaluatorBatchPayload(evaluator), null, 2),
    'utf8'
  );

  return paths;
}

/**
 * Reads and validates the score array the agent wrote to results.json.
 */
export async function readCursorRankingResultsFile(
  workspaceDir: string,
  batchId: string
): Promise<RankingResult[] | null> {
  const paths = cursorBatchPaths(batchId);
  const absolutePath = join(workspaceDir, paths.resultsPath);

  try {
    await access(absolutePath);
  } catch {
    return null;
  }

  let raw: string;
  try {
    raw = await readFile(absolutePath, 'utf8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }

  return validateCursorRankingResults(parsed);
}
