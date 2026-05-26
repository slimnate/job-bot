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

const fullDimensionScores = {
  technicalFit: 20,
  levelRealism: 15,
  workStyleScope: 10,
  compensationTransparency: 8,
  locationLogistics: 8,
  missionResonance: 3,
  processRedFlags: 12,
};

describe('validateIndividualScores', () => {
  it('accepts one score per candidate', () => {
    const result = validateIndividualScores([candidate], [
      {
        postingId: 'a',
        scoreOverall: 80,
        reasoningSummary: 'Good fit',
        criteriaMatch: { matched: ['TypeScript'], unmet: [] },
        dimensionScores: fullDimensionScores,
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
