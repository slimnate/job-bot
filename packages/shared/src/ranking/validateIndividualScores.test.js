import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validateIndividualScores } from '@job-bot/shared';

const candidate = {
  _id: 'a',
  title: 'T',
  company: 'C',
  source: 'linkedin',
  url: 'https://example.com',
};

describe('validateIndividualScores', () => {
  it('accepts one score per candidate', () => {
    const result = validateIndividualScores([candidate], [
      {
        postingId: 'a',
        scoreOverall: 80,
        reasoningSummary: 'Good fit',
        criteriaMatch: {},
        redFlags: [],
      },
    ]);
    assert.equal(result?.length, 1);
    assert.equal(result?.[0].scoreOverall, 80);
  });

  it('rejects missing posting', () => {
    const result = validateIndividualScores([candidate], []);
    assert.equal(result, null);
  });
});
