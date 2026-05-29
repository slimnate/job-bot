import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
const fallbackChromePaths = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
];
export async function resolveChromeExecutablePath() {
    const fromEnv = process.env.CHROME_PATH;
    if (fromEnv) {
        try {
            await access(fromEnv, fsConstants.X_OK);
            return fromEnv;
        }
        catch {
            throw new Error(`CHROME_PATH is set but not executable: ${fromEnv}`);
        }
    }
    for (const candidate of fallbackChromePaths) {
        try {
            await access(candidate, fsConstants.X_OK);
            return candidate;
        }
        catch {
            continue;
        }
    }
    throw new Error('Could not find a Chrome/Chromium executable. Set CHROME_PATH or install google-chrome / chromium.');
}
export function buildChromeRemoteDebuggingArgs(params) {
    const { width, height } = params.viewport ?? { width: 1366, height: 900 };
    const args = [
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
export async function launchChromeWithRemoteDebugging(params) {
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
//# sourceMappingURL=chromeLauncher.js.map