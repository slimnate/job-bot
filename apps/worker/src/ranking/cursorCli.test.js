import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildCursorCliArgs,
  createCursorCliLineBuffer,
  drainCursorCliLines,
  effectiveRankingModelOverride,
  enforceRankingJsonOutputFormat,
  flushCursorCliLineBuffer,
  formatCursorCliFailure,
  hasCliArgFlag,
  parseCursorCliJsonEnvelope,
  resolveCursorApiModelIdWithDefault,
} from './cursorCli.ts';

describe('cursorCli', () => {
  it('effectiveRankingModelOverride ignores llm-default placeholder', () => {
    assert.equal(effectiveRankingModelOverride('llm-default'), undefined);
    assert.equal(effectiveRankingModelOverride('  '), undefined);
    assert.equal(effectiveRankingModelOverride('auto'), 'auto');
  });

  it('resolveCursorApiModelIdWithDefault maps legacy cursor-default to auto', () => {
    assert.equal(resolveCursorApiModelIdWithDefault('cursor-default', 'auto'), 'auto');
    assert.equal(resolveCursorApiModelIdWithDefault('composer-2.5-fast', 'auto'), 'composer-2.5-fast');
  });

  it('hasCliArgFlag detects --mode=ask', () => {
    assert.equal(hasCliArgFlag(['--print', '--mode=ask', '--trust'], '--mode'), true);
    assert.equal(hasCliArgFlag(['--mode', 'ask'], '--mode'), true);
    assert.equal(hasCliArgFlag(['--print'], '--mode'), false);
  });

  it('enforceRankingJsonOutputFormat replaces text with json', () => {
    const args = enforceRankingJsonOutputFormat([
      '--print',
      '--output-format',
      'text',
      '--mode=ask',
    ]);
    assert.ok(args.includes('json'));
    assert.equal(args.filter((a) => a === 'text').length, 0);
  });

  it('parseCursorCliJsonEnvelope reads completion metadata', () => {
    const envelope = parseCursorCliJsonEnvelope(
      '{"type":"result","subtype":"success","is_error":false,"duration_ms":1200,"result":"ok"}'
    );
    assert.equal(envelope?.duration_ms, 1200);
    assert.equal(envelope?.is_error, false);
  });

  it('buildCursorCliArgs does not duplicate --mode when already --mode=ask', () => {
    const args = buildCursorCliArgs(
      {
        command: 'cursor-agent',
        args: ['--print', '--mode=ask', '--trust', '--output-format', 'json'],
        timeoutMs: 60_000,
        model: 'auto',
        workspaceDir: '/tmp/ws',
      },
      'hello',
      { minimalContext: true }
    );
    const modeCount = args.filter((a) => a === '--mode' || a.startsWith('--mode=')).length;
    assert.equal(modeCount, 1);
    assert.equal(args[args.length - 1], 'hello');
    assert.ok(args.includes('--model'));
    assert.equal(args[args.indexOf('--model') + 1], 'auto');
  });

  it('drainCursorCliLines splits on newlines and keeps a partial tail', () => {
    const buf = createCursorCliLineBuffer();
    assert.deepEqual(drainCursorCliLines(buf, 'line one\nline two\npart'), ['line one', 'line two']);
    assert.equal(buf.pending, 'part');
    assert.deepEqual(drainCursorCliLines(buf, 'ial\n'), ['partial']);
    assert.equal(buf.pending, '');
    assert.equal(flushCursorCliLineBuffer(buf), null);
  });

  it('flushCursorCliLineBuffer returns trailing text without a newline', () => {
    const buf = createCursorCliLineBuffer();
    drainCursorCliLines(buf, '{"scores":[]');
    assert.equal(flushCursorCliLineBuffer(buf), '{"scores":[]');
    assert.equal(buf.pending, '');
  });

  it('formatCursorCliFailure includes stderr', () => {
    const text = formatCursorCliFailure({
      reason: 'bad model',
      command: 'cursor-agent',
      args: ['--model', 'nope'],
      stderr: 'Cannot use this model: nope',
    });
    assert.match(text, /stderr:/);
    assert.match(text, /Cannot use this model/);
    assert.match(text, /Command:/);
  });
});
