import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  appendRankRunLog,
  finishRankRunLog,
  isValidRankingRunId,
  resetRankRunLogHubForTests,
  subscribeRankRunLog,
} from './rankRunLogHub.ts';

describe('rankRunLogHub', () => {
  it('isValidRankingRunId accepts uuid-like tokens', () => {
    assert.equal(isValidRankingRunId('a1b2c3d4-e5f6-7890-abcd-ef1234567890'), true);
    assert.equal(isValidRankingRunId('short'), false);
  });

  it('replays buffered entries to late subscribers', () => {
    resetRankRunLogHubForTests();
    const runId = 'test-run-replay-001';
    appendRankRunLog(runId, {
      ts: '2026-05-22T12:00:00.000Z',
      level: 'info',
      msg: 'llm.rank.start',
      fields: { candidateCount: 1 },
    });

    const seen = [];
    subscribeRankRunLog(runId, (event) => {
      seen.push(event);
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].msg, 'llm.rank.start');
    resetRankRunLogHubForTests();
  });

  it('finish sends end event to subscribers', () => {
    resetRankRunLogHubForTests();
    const runId = 'test-run-end-001';
    const events = [];
    subscribeRankRunLog(runId, (event) => {
      events.push(event);
    });
    finishRankRunLog(runId, { ok: true, scoreOverall: 72 });
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'end');
    assert.equal(events[0].ok, true);
    assert.equal(events[0].scoreOverall, 72);
    resetRankRunLogHubForTests();
  });
});
