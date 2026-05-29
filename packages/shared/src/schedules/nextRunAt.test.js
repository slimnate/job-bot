import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { computeNextRunAt } from './nextRunAt.ts';

const localHourMinute = (timestamp, timezone) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));

describe('computeNextRunAt', () => {
  it('computes interval schedules in whole hours', () => {
    const now = Date.UTC(2026, 4, 26, 12, 0, 0);
    const next = computeNextRunAt({ kind: 'interval', intervalHours: 6 }, now);
    assert.equal(next, now + 6 * 60 * 60 * 1000);
  });

  it('computes daily schedules in the provided timezone', () => {
    const timezone = 'America/Chicago';
    const now = Date.UTC(2026, 4, 26, 13, 20, 0);
    const next = computeNextRunAt(
      { kind: 'daily', timeOfDay: '09:30', timezone },
      now
    );

    assert.ok(next > now);
    assert.equal(localHourMinute(next, timezone), '09:30');
  });

  it('returns the next day when today target minute is already passed', () => {
    const timezone = 'America/Chicago';
    const now = Date.UTC(2026, 4, 26, 23, 0, 0);
    const next = computeNextRunAt(
      { kind: 'daily', timeOfDay: '09:30', timezone },
      now
    );
    const following = computeNextRunAt(
      { kind: 'daily', timeOfDay: '09:30', timezone },
      next
    );

    assert.equal(localHourMinute(next, timezone), '09:30');
    assert.equal(localHourMinute(following, timezone), '09:30');
    assert.ok(following - next >= 23 * 60 * 60 * 1000);
  });
});
