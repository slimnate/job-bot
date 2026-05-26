import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  getRepoRoot,
  getWorkerPackageRoot,
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
});
