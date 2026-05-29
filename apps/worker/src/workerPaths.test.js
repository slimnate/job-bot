import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  defaultChromeUserDataDir,
  getRepoRoot,
  getWorkerPackageRoot,
  resolveChromeUserDataDir,
  resolveCursorCliWorkspaceDir,
} from './workerPaths.ts';

describe('workerPaths', () => {
  it('resolveCursorCliWorkspaceDir maps factory default to worker ranking-cli-workspace', () => {
    const resolved = resolveCursorCliWorkspaceDir('apps/worker/ranking-cli-workspace');
    const expected = path.join(getWorkerPackageRoot(), 'ranking-cli-workspace');
    assert.ok(!resolved.includes('/apps/apps/'), `doubled apps segment: ${resolved}`);
    assert.equal(resolved, expected);
  });

  it('resolveCursorCliWorkspaceDir resolves bare dir under worker package', () => {
    const resolved = resolveCursorCliWorkspaceDir('ranking-cli-workspace');
    assert.equal(resolved, path.join(getWorkerPackageRoot(), 'ranking-cli-workspace'));
  });

  it('getRepoRoot is parent of apps/worker', () => {
    assert.equal(getRepoRoot(), path.resolve(getWorkerPackageRoot(), '../..'));
  });

  it('defaultChromeUserDataDir uses XDG_CONFIG_HOME when set', () => {
    const prev = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = '/tmp/xdg-test';
    try {
      assert.equal(
        defaultChromeUserDataDir('default'),
        path.join('/tmp/xdg-test', 'job-bot', 'chrome-profile')
      );
      assert.equal(
        defaultChromeUserDataDir('worker-b'),
        path.join('/tmp/xdg-test', 'job-bot', 'chrome-profile-worker-b')
      );
    } finally {
      if (prev === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = prev;
      }
    }
  });

  it('resolveChromeUserDataDir empty uses default XDG path', () => {
    const prev = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = '/tmp/xdg-resolve';
    try {
      assert.equal(
        resolveChromeUserDataDir('', 'default'),
        path.join('/tmp/xdg-resolve', 'job-bot', 'chrome-profile')
      );
    } finally {
      if (prev === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = prev;
      }
    }
  });

  it('resolveChromeUserDataDir keeps absolute paths', () => {
    assert.equal(resolveChromeUserDataDir('/var/chrome-profile', 'default'), '/var/chrome-profile');
  });

  it('resolveChromeUserDataDir resolves relative paths under worker package', () => {
    const resolved = resolveChromeUserDataDir('my-chrome-profile', 'default');
    assert.equal(resolved, path.join(getWorkerPackageRoot(), 'my-chrome-profile'));
  });
});
