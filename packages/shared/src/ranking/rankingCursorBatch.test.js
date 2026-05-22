import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildCursorFileRankingPrompt, cursorBatchPaths } from '@job-bot/shared';

describe('rankingCursorBatch', () => {
  it('builds batch paths under .ranking-batches', () => {
    const paths = cursorBatchPaths('test-batch');
    assert.equal(paths.postingsRelative, '.ranking-batches/test-batch/postings.json');
    assert.equal(paths.evaluatorRelative, '.ranking-batches/test-batch/evaluator.json');
  });

  it('file prompt references batch paths and posting ids', () => {
    const prompt = buildCursorFileRankingPrompt('batch-1', ['id-1', 'id-2']);
    assert.match(prompt, /postings\.json/);
    assert.match(prompt, /evaluator\.json/);
    assert.match(prompt, /id-1/);
    assert.match(prompt, /id-2/);
  });
});
