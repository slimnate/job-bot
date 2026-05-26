import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCursorRankingResult, validateRankingResult } from '@job-bot/shared';

const fullDimensionScores = {
  technicalFit: 22,
  levelRealism: 16,
  workStyleScope: 11,
  compensationTransparency: 6,
  locationLogistics: 8,
  missionResonance: 2,
  processRedFlags: 9,
};

test('validateRankingResult accepts separated criteriaMatch and dimensionScores', () => {
  const result = validateRankingResult({
    postingId: 'abc',
    scoreOverall: 72,
    reasoningSummary: 'Good fit',
    criteriaMatch: { matched: ['React'], unmet: ['On-site only'] },
    dimensionScores: fullDimensionScores,
    redFlags: [],
  });
  assert.ok(result);
  assert.equal(result.criteriaMatch.matched[0], 'React');
  assert.equal(result.dimensionScores.technicalFit, 22);
});

test('validateRankingResult rejects numeric keys only in criteriaMatch', () => {
  const result = validateRankingResult({
    postingId: 'abc',
    scoreOverall: 72,
    reasoningSummary: 'Good fit',
    criteriaMatch: { technicalFit: 20 },
    redFlags: [],
  });
  assert.equal(result, null);
});

test('validateCursorRankingResult accepts legacy numeric criteriaMatch', () => {
  const result = validateCursorRankingResult({
    postingId: 'abc',
    scoreOverall: 72,
    reasoningSummary: 'Good fit',
    criteriaMatch: {
      technicalFit: 22,
      levelRealism: 16,
      workStyleScope: 11,
      compensationTransparency: 6,
      locationLogistics: 8,
      missionResonance: 2,
      processRedFlags: 9,
    },
    redFlags: [],
  });
  assert.ok(result);
  assert.equal(result.dimensionScores.technicalFit, 22);
  assert.deepEqual(result.criteriaMatch, { matched: [], unmet: [] });
});
