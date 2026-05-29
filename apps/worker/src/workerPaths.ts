import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Absolute path to the `@job-bot/worker` package root (`apps/worker`), whether running from `src/` or `dist/`.
 */
export function getWorkerPackageRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  let dir = path.dirname(thisFile);
  const nested = new Set(['src', 'dist', 'ranking']);
  while (nested.has(path.basename(dir))) {
    dir = path.resolve(dir, '..');
  }
  return dir;
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

/**
 * XDG config directory for Chrome user data when no explicit path is configured.
 * Non-default `WORKER_ID` values get a suffix so multiple workers on one host do not share a profile.
 */
export function defaultChromeUserDataDir(workerId: string = 'default'): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME?.trim();
  const configHome = xdgConfig ? path.normalize(xdgConfig) : path.join(homedir(), '.config');
  const base = path.join(configHome, 'job-bot', 'chrome-profile');
  const id = workerId.trim() || 'default';
  if (id === 'default') {
    return base;
  }
  return `${base}-${id}`;
}

/**
 * Resolves `WORKER_CHROME_USER_DATA_DIR` to an absolute Chrome profile directory.
 * Empty uses {@link defaultChromeUserDataDir}; relative paths are under the worker package.
 */
export function resolveChromeUserDataDir(raw: string, workerId: string = 'default'): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return defaultChromeUserDataDir(workerId);
  }
  if (path.isAbsolute(trimmed)) {
    return path.normalize(trimmed);
  }
  return path.resolve(getWorkerPackageRoot(), trimmed);
}
