import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CURSOR_CLI_CATALOG,
  CURSOR_CLI_MODEL_IDS,
  cursorModelIdToDisplayName,
} from '@job-bot/shared';

describe('cursorCliCatalog', () => {
  it('has 111 models with auto first', () => {
    assert.equal(CURSOR_CLI_CATALOG.length, 111);
    assert.equal(CURSOR_CLI_MODEL_IDS[0], 'auto');
    assert.equal(CURSOR_CLI_CATALOG[0].displayName, 'Auto (default)');
  });

  it('cursorModelIdToDisplayName resolves known ids', () => {
    assert.equal(cursorModelIdToDisplayName('auto'), 'Auto (default)');
    assert.equal(cursorModelIdToDisplayName('gpt-5.3-codex-high'), 'GPT 5.3 Codex · High');
    assert.equal(
      cursorModelIdToDisplayName('claude-opus-4-7-thinking-max'),
      'Claude Opus 4.7 · Thinking · Max'
    );
  });

  it('cursorModelIdToDisplayName throws for unknown ids', () => {
    assert.throws(() => cursorModelIdToDisplayName('not-a-model'), /Unknown Cursor CLI model id/);
  });
});
