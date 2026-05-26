import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Absolute path to the `@job-bot/worker` package root (`apps/worker`), whether running from `src/` or `dist/`.
 */
export function getWorkerPackageRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const rankingOrRootDir = path.dirname(thisFile);
  const basename = path.basename(rankingOrRootDir);
  if (basename === 'ranking') {
    return path.resolve(rankingOrRootDir, '../..');
  }
  return rankingOrRootDir;
}

/** Monorepo root (`job-bot/`) when the worker package lives at `apps/worker`. */
export function getRepoRoot(): string {
  return path.resolve(getWorkerPackageRoot(), '../..');
}

/**
 * Resolves `CURSOR_CLI_WORKSPACE` to an absolute directory.
 * Factory default `apps/worker/ranking-cli-workspace` is relative to the repo root;
 * bare names like `ranking-cli-workspace` are relative to the worker package.
 */
export function resolveCursorCliWorkspaceDir(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return path.join(getWorkerPackageRoot(), 'ranking-cli-workspace');
  }
  if (path.isAbsolute(trimmed)) {
    return path.normalize(trimmed);
  }
  const normalized = trimmed.replaceAll('\\', '/');
  if (normalized.startsWith('apps/worker/')) {
    return path.resolve(getRepoRoot(), normalized);
  }
  return path.resolve(getWorkerPackageRoot(), trimmed);
}
