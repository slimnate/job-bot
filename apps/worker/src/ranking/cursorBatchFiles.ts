import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  buildEvaluatorBatchPayload,
  cursorBatchPaths,
  serializeCandidateForBatchFile,
  type CursorBatchPaths,
  type RankingCandidateInput,
  type RankingEvaluatorInput,
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
