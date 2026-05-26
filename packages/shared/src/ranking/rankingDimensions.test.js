import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeDimensionScores,
  splitLegacyRankingPayload,
  toFullDimensionScores,
  validateCriteriaMatch,
} from '@job-bot/shared';

test('normalizeDimensionScores maps alias keys from real Convex samples', () => {
  const sample1 = normalizeDimensionScores({
    compTransparency: 6,
    levelRealism: 16,
    locationLogistics: 8,
    missionResonance: 2,
    processRedFlags: 9,
    technicalFit: 22,
    workStyleScope: 11,
  });
  assert.deepEqual(sample1, {
    technicalFit: 22,
    levelRealism: 16,
    workStyleScope: 11,
    compensationTransparency: 6,
    locationLogistics: 8,
    missionResonance: 2,
    processRedFlags: 9,
  });

  const sample2 = normalizeDimensionScores({
    compensationTransparency: 10,
    levelRealism: 16,
    locationLogistics: 9,
    missionResonance: 5,
    processRedFlags: 12,
    technicalFit: 15,
    workStyleScope: 14,
  });
  assert.equal(sample2?.compensationTransparency, 10);

  const sample3 = normalizeDimensionScores({
    compensation: 6,
    hiringProcess: 10,
    location: 10,
    missionResonance: 3,
    roleLevel: 11,
    technicalFit: 13,
    workStyle: 8,
  });
  assert.deepEqual(sample3, {
    technicalFit: 13,
    levelRealism: 11,
    workStyleScope: 8,
    compensationTransparency: 6,
    locationLogistics: 10,
    missionResonance: 3,
    processRedFlags: 10,
  });
});

test('validateCriteriaMatch rejects numeric keys in criteriaMatch', () => {
  assert.equal(validateCriteriaMatch({ technicalFit: 20 }), null);
  assert.deepEqual(validateCriteriaMatch({ matched: ['a'], unmet: [] }), {
    matched: ['a'],
    unmet: [],
  });
  assert.deepEqual(validateCriteriaMatch({}), { matched: [], unmet: [] });
});

test('splitLegacyRankingPayload extracts scores from mixed criteriaMatch', () => {
  const split = splitLegacyRankingPayload({
    technicalFit: 20,
    levelRealism: 15,
    workStyleScope: 10,
    compensationTransparency: 8,
    locationLogistics: 8,
    missionResonance: 3,
    processRedFlags: 12,
    matched: ['React'],
    unmet: [],
  });
  assert.ok(split);
  assert.deepEqual(split.criteriaMatch, { matched: ['React'], unmet: [] });
  assert.equal(split.dimensionScores?.technicalFit, 20);
});

test('toFullDimensionScores requires all seven keys', () => {
  const partial = normalizeDimensionScores({ technicalFit: 1, levelRealism: 2, workStyleScope: 3 });
  assert.equal(toFullDimensionScores(partial ?? {}), null);
});
