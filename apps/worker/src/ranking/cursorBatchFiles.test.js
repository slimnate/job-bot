import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { writeCursorRankingBatchFiles } from './cursorBatchFiles.ts';

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
});
