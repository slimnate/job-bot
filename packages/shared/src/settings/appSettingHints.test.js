import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { APP_SETTING_DEFINITIONS } from '@job-bot/shared';

describe('app setting hints', () => {
  it('every UI setting has a detailed non-empty hint', () => {
    for (const def of APP_SETTING_DEFINITIONS) {
      assert.ok(def.hint.length >= 80, `${def.key} hint too short`);
      assert.ok(def.label.trim().length > 0, `${def.key} missing label`);
    }
  });
});
