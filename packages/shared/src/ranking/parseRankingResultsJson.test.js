import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRankingResultsFromText } from '@job-bot/shared';

const sample = [
  {
    postingId: 'id-1',
    scoreOverall: 80,
    reasoningSummary: 'Good',
    criteriaMatch: { matched: ['a'], unmet: [] },
    dimensionScores: {
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
];

test('parseRankingResultsFromText reads fenced JSON', () => {
  const text = `Here are scores:\n\`\`\`json\n${JSON.stringify(sample)}\n\`\`\``;
  const parsed = parseRankingResultsFromText(text);
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed.length, 1);
});

test('parseRankingResultsFromText reads bracket slice from prose', () => {
  const text = `Scoring complete.\n${JSON.stringify(sample)}\nDone.`;
  const parsed = parseRankingResultsFromText(text);
  assert.ok(Array.isArray(parsed));
});
