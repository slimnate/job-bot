import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { readCursorRankingResultsFile, writeCursorRankingBatchFiles } from './cursorBatchFiles.ts';

describe('cursorBatchFiles', () => {
  it('writes postings array with full descriptions', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'job-bot-batch-'));
    try {
      const batchId = 'test-batch';
      const paths = await writeCursorRankingBatchFiles(workspace, batchId, { name: 'Dev' }, [
        {
          _id: 'id-1',
          title: 'Engineer',
          company: 'Co',
          source: 'linkedin',
          url: 'https://example.com/1',
          descriptionSnippet: 'x'.repeat(5000),
        },
      ]);

      const raw = await readFile(join(workspace, paths.postingsPath), 'utf8');
      const postings = JSON.parse(raw);
      assert.equal(postings.length, 1);
      assert.equal(postings[0].descriptionSnippet.length, 5000);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('readCursorRankingResultsFile validates results.json', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'job-bot-batch-'));
    try {
      const batchId = 'results-batch';
      await writeCursorRankingBatchFiles(workspace, batchId, { name: 'Dev' }, [
        {
          _id: 'id-1',
          title: 'Engineer',
          company: 'Co',
          source: 'linkedin',
          url: 'https://example.com/1',
        },
      ]);

      assert.equal(await readCursorRankingResultsFile(workspace, batchId), null);

      const { writeFile } = await import('node:fs/promises');
      const { cursorBatchPaths } = await import('@job-bot/shared');
      const paths = cursorBatchPaths(batchId);
      await writeFile(
        join(workspace, paths.resultsPath),
        JSON.stringify([
          {
            postingId: 'id-1',
            scoreOverall: 80,
            reasoningSummary: 'Good fit',
            criteriaMatch: {
              technicalFit: 20,
              levelRealism: 15,
              workStyleScope: 10,
              compensationTransparency: 8,
              locationLogistics: 8,
              missionResonance: 3,
              processRedFlags: 12,
            },
            redFlags: [],
          },
        ]),
        'utf8'
      );

      const results = await readCursorRankingResultsFile(workspace, batchId);
      assert.equal(results?.length, 1);
      assert.equal(results?.[0]?.scoreOverall, 80);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
