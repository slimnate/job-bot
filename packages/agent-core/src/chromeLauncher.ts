import { spawn, type ChildProcess } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';

export type LaunchChromeWithRemoteDebuggingParams = {
  port: number;
  /** When false, opens a visible browser window (best for developing scrapers). */
  headless: boolean;
  /** Chrome profile directory (persistent path preserves cookies across restarts). */
  userDataDir: string;
  /** Override Chrome/Chromium binary; otherwise common paths are tried. */
  executablePath?: string;
  viewport?: { width: number; height: number };
};

const fallbackChromePaths = [
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
];

export async function resolveChromeExecutablePath(): Promise<string> {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv) {
    try {
      await access(fromEnv, fsConstants.X_OK);
      return fromEnv;
    } catch {
      throw new Error(`CHROME_PATH is set but not executable: ${fromEnv}`);
    }
  }

  for (const candidate of fallbackChromePaths) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error(
    'Could not find a Chrome/Chromium executable. Set CHROME_PATH or install google-chrome / chromium.'
  );
}

export function buildChromeRemoteDebuggingArgs(params: LaunchChromeWithRemoteDebuggingParams): string[] {
  const { width, height } = params.viewport ?? { width: 1366, height: 900 };
  const args: string[] = [
    `--remote-debugging-port=${params.port}`,
    `--user-data-dir=${params.userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--window-size=${width},${height}`,
  ];
  if (params.headless) {
    args.push('--headless=new');
  }
  return args;
}

export async function launchChromeWithRemoteDebugging(
  params: LaunchChromeWithRemoteDebuggingParams
): Promise<ChildProcess> {
  const executable = params.executablePath ?? (await resolveChromeExecutablePath());
  const child = spawn(executable, buildChromeRemoteDebuggingArgs(params), {
    detached: false,
    stdio: 'ignore',
  });
  child.on('error', () => {
    /* surfaced when callers await readiness */
  });
  return child;
}
