import { JOB_BOT_POSTING_PUSH_BINDING, type ChromeDriver } from '@job-bot/agent-core';

import type { Id } from '../convexBridge/doc.js';
import { workerLog } from '../log.js';
import type { ScrapeResult, ScrapedPostingInput } from '../scrapeTypes.js';

import {
  linkedInOverlayKind,
  parseLinkedInDebugSteps,
  type LinkedInDebugSteps,
} from './linkedinDebugSteps.js';
import { buildLinkedInJobsListScrapeExpression } from './linkedinScrapeBundle.js';
import {
  injectLinkedInScrapeOverlay,
  linkedInWaitStep,
  removeLinkedInDebugOverlay,
} from './linkedinScrapeControls.js';

export const JOB_BOT_SCRAPE_ABORT_MESSAGE = 'JOB_BOT_SCRAPE_ABORT';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseEnvBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  const lower = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(lower)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(lower)) {
    return false;
  }
  return defaultValue;
}

const DEFAULT_LINKEDIN_PAGES = 1;
const MAX_LINKEDIN_PAGES_CAP = 10;

/** Temporary: stop LinkedIn listing after this many job records are collected, then run upsert/rank as usual. */
const TEMP_LINKEDIN_MAX_COLLECTED_POSTINGS = 3;

/**
 * Parses `WORKER_LINKEDIN_PAGES`: positive integer, default 1, capped for safety.
 */
function parseLinkedInPagesFromEnv(env: NodeJS.ProcessEnv): number {
  const raw = env.WORKER_LINKEDIN_PAGES;
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_LINKEDIN_PAGES;
  }
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < 1) {
    workerLog.warn('linkedin.pages', {
      message: `Invalid WORKER_LINKEDIN_PAGES=${JSON.stringify(raw)}; using ${DEFAULT_LINKEDIN_PAGES}`,
    });
    return DEFAULT_LINKEDIN_PAGES;
  }
  if (n > MAX_LINKEDIN_PAGES_CAP) {
    workerLog.warn('linkedin.pages', {
      message: `WORKER_LINKEDIN_PAGES=${n} exceeds cap ${MAX_LINKEDIN_PAGES_CAP}; using cap`,
    });
    return MAX_LINKEDIN_PAGES_CAP;
  }
  return n;
}

type LoginPoll = {
  onLogin: boolean;
  hasShell: boolean;
  href: string;
  /** Why we are still waiting (for logs only). */
  waitReason: string;
};

/**
 * Page script: detect login/checkpoint vs jobs UI. The jobs *hub* at /jobs/ often has no
 * `.jobs-search-results-list` until the user opens a list — we must treat hub + cards as ready.
 */
const LINKEDIN_SHELL_POLL_SCRIPT = `(() => {
  const href = window.location.href;
  const path = window.location.pathname || '';

  const visible = (el) => {
    if (!el || !(el instanceof HTMLElement)) return false;
    return el.offsetParent !== null;
  };

  const onLoginUrl =
    /linkedin\\.com\\/(login|checkpoint|uas\\/login|authwall)/i.test(href) ||
    /\\/login\\/?$/i.test(path) ||
    path.includes('/checkpoint/');

  const pwd = document.querySelector(
    'input[type="password"][autocomplete="current-password"], input#session_password, input[name="session_password"]'
  );
  const user = document.querySelector('input[name="session_key"], input#username, input[name="session_key"]');
  const onLoginForm = Boolean(
    onLoginUrl ||
      (visible(pwd) && user && visible(user)) ||
      (visible(pwd) && /login|checkpoint/i.test(path))
  );

  const hasResultsShell = Boolean(
    document.querySelector(
      '.jobs-search-results-list, .scaffold-layout__list, .jobs-search__job-details-panel, [data-testid="lazy-column"], .jobs-search-results'
    )
  );

  const hasJobLink = Boolean(document.querySelector('a[href*="/jobs/view/"]'));

  const bodyText = (document.body && document.body.innerText) || '';
  const hasHubCopy =
    /jobs based on your preferences|top job picks|recommended for you|recent job searches/i.test(
      bodyText
    );

  const onJobsArea =
    path.includes('/jobs') ||
    /linkedin\\.com\\/jobs|\\/jobs\\/|\\/jobs\\?/i.test(href);

  const titleLooksLikeJobs =
    onJobsArea && /\\bjobs\\b/i.test(document.title || '');

  const hasJobsHub =
    onJobsArea &&
    (hasJobLink ||
      hasHubCopy ||
      titleLooksLikeJobs ||
      Boolean(document.querySelector('[class*="jobs-search-top-applications"]')) ||
      Boolean(document.querySelector('[data-view-name="job-search-jobs-feed"]')));

  const hasShell = Boolean(hasResultsShell || hasJobsHub);

  let waitReason = 'ok';
  if (onLoginForm) waitReason = 'login_or_checkpoint';
  else if (!hasShell) waitReason = 'no_jobs_ui_match';

  return {
    onLogin: onLoginForm,
    hasShell,
    href,
    waitReason,
  };
})()`;

/** Email/username + password from env for one-shot form submit before scraping (optional). */
type LinkedInAutoLoginCreds = { user: string; password: string };

/**
 * Reads `LINKEDIN_USER` and `LINKEDIN_PASS`. Both must be non-empty after trim, or returns null.
 * Password values are never logged.
 */
function parseLinkedInAutoLoginFromEnv(env: NodeJS.ProcessEnv): LinkedInAutoLoginCreds | null {
  const user = env.LINKEDIN_USER?.trim() ?? '';
  const password = env.LINKEDIN_PASS?.trim() ?? '';
  if (!user || !password) {
    return null;
  }
  return { user, password };
}

/**
 * In-page script: fill LinkedIn login fields and submit once. User/password are JSON-embedded by the caller.
 * Does not handle 2FA, CAPTCHA, or checkpoint flows — those still require manual completion in the browser.
 */
function buildLinkedInAutoLoginExpression(user: string, password: string): string {
  const u = JSON.stringify(user);
  const p = JSON.stringify(password);
  return `(() => {
    function visible(el) {
      if (!el || !(el instanceof HTMLElement)) return false;
      return el.offsetParent !== null;
    }
    const pwdCandidates = [
      document.querySelector('input[type="password"][autocomplete="current-password"]'),
      document.querySelector('input#session_password'),
      document.querySelector('input[name="session_password"]'),
      document.querySelector('input[type="password"]'),
    ].filter(Boolean);
    const pwd = pwdCandidates.find((el) => visible(el)) ?? pwdCandidates[0];
    const userCandidates = [
      document.querySelector('input[name="session_key"]'),
      document.querySelector('input#username'),
      document.querySelector('input[name="username"]'),
      document.querySelector('input[type="text"][autocomplete="username"]'),
      document.querySelector('input[type="email"]'),
    ].filter(Boolean);
    const userEl = userCandidates.find((el) => visible(el)) ?? userCandidates[0];
    if (!(pwd instanceof HTMLInputElement) || !(userEl instanceof HTMLInputElement)) {
      return { ok: false, reason: 'fields_missing' };
    }
    userEl.focus();
    userEl.value = ${u};
    userEl.dispatchEvent(new Event('input', { bubbles: true }));
    userEl.dispatchEvent(new Event('change', { bubbles: true }));
    pwd.focus();
    pwd.value = ${p};
    pwd.dispatchEvent(new Event('input', { bubbles: true }));
    pwd.dispatchEvent(new Event('change', { bubbles: true }));
    const form = pwd.closest('form');
    let submitBtn =
      (form && form.querySelector('button[type="submit"]')) ||
      document.querySelector('button[type="submit"]') ||
      document.querySelector('input[type="submit"]');
    if (!submitBtn) {
      submitBtn =
        Array.from(document.querySelectorAll('button')).find((b) => {
          const t = (b.textContent || '').trim();
          return /^sign\\s*in$/i.test(t) || t === 'Sign in';
        }) ?? null;
    }
    if (submitBtn instanceof HTMLElement) {
      submitBtn.click();
      return { ok: true, via: 'button' };
    }
    if (form && typeof form.requestSubmit === 'function') {
      form.requestSubmit();
      return { ok: true, via: 'requestSubmit' };
    }
    return { ok: false, reason: 'no_submit' };
  })()`;
}

/**
 * Waits until the jobs UI is usable or throws after `timeoutMs`.
 * If `autoLogin` is set, performs **one** automatic submit when a login form is detected (then falls back to manual wait).
 */
async function waitForLinkedInJobsShell(
  driver: ChromeDriver,
  timeoutMs: number,
  autoLogin: LinkedInAutoLoginCreds | null
): Promise<void> {
  const start = Date.now();
  let autoLoginAttempted = false;

  while (Date.now() - start < timeoutMs) {
    const state = await driver.evaluate<LoginPoll>(LINKEDIN_SHELL_POLL_SCRIPT);

    if (!state.onLogin && state.hasShell) {
      return;
    }

    if (state.onLogin && autoLogin && !autoLoginAttempted) {
      autoLoginAttempted = true;
      workerLog.info('linkedin.auto_login', {
        phase: 'attempt',
        href: state.href,
      });
      try {
        const expr = buildLinkedInAutoLoginExpression(autoLogin.user, autoLogin.password);
        const result = await driver.evaluate<{ ok: boolean; reason?: string; via?: string }>(expr);
        if (result.ok) {
          workerLog.info('linkedin.auto_login', {
            phase: 'submitted',
            via: result.via ?? 'unknown',
          });
        } else {
          workerLog.warn('linkedin.auto_login', {
            phase: 'script_failed',
            reason: result.reason ?? 'unknown',
          });
        }
      } catch (err) {
        workerLog.warn('linkedin.auto_login', {
          phase: 'exception',
          message: err instanceof Error ? err.message : String(err),
        });
      }
      await sleep(4000);
      continue;
    }

    workerLog.info('linkedin.login_wait', {
      phase: 'polling',
      href: state.href,
      onLogin: state.onLogin,
      hasShell: state.hasShell,
      waitReason: state.waitReason,
    });
    await sleep(2500);
  }

  throw new Error(
    'Timed out waiting for LinkedIn login / jobs shell. Sign in in the Chrome window and retry.'
  );
}

/**
 * Clicks “Show all” on the **Jobs based on your preferences** module.
 *
 * LinkedIn often places the heading in a narrow inner div; “Show all” sits in a sibling column under a
 * wider flex/grid parent. Older logic used `closest('div[class*="card"]')` + immediate container — but
 * obfuscated class names no longer contain `card`, and the first matching `div` ancestor is too small
 * and does not contain the link. We walk up the DOM and search each ancestor for a Show-all control.
 */
const PREFERENCES_CLICK_SCRIPT = `(() => {
  function norm(s) {
    return (s || '').replace(/\\s+/g, ' ').trim();
  }
  function isPreferencesHeading(h) {
    const t = norm(h.textContent);
    return /jobs based on your preferences/i.test(t);
  }
  const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4'));
  const pref = headings.find(isPreferencesHeading);
  if (!pref) {
    return { error: 'PREF_CARD_MISSING' };
  }
  let scope = pref.parentElement;
  for (let depth = 0; depth < 14 && scope; depth++) {
    const candidates = Array.from(
      scope.querySelectorAll('a, button, span[role="button"], [role="link"]')
    );
    const showAllEl = candidates.find((el) => {
      const t = norm(el.textContent);
      return t === 'Show all' || /^Show all\\b/i.test(t);
    });
    if (showAllEl) {
      const clickable =
        showAllEl instanceof HTMLAnchorElement || showAllEl instanceof HTMLButtonElement
          ? showAllEl
          : showAllEl.closest('a, button');
      const target = clickable instanceof HTMLElement ? clickable : showAllEl;
      target.click();
      return { ok: true, via: 'ancestor_scope', depth };
    }
    scope = scope.parentElement;
  }
  return { error: 'SHOW_ALL_MISSING' };
})()`;

type BundleJob = {
  externalId: string;
  url: string;
  title: string;
  company: string;
  location?: string;
  salaryText?: string;
  descriptionSnippet?: string;
  rawPayload: Record<string, unknown>;
};

function bundleJobToScrapedPosting(job: BundleJob, runId: Id<'scrape_runs'>): ScrapedPostingInput {
  return {
    source: 'linkedin',
    externalId: job.externalId,
    url: job.url,
    title: job.title,
    company: job.company,
    location: job.location,
    salaryText: job.salaryText,
    descriptionSnippet: job.descriptionSnippet,
    discoveredAt: Date.now(),
    scrapeRunId: runId,
    rawPayload: {
      ...job.rawPayload,
      provider: 'linkedin-cdp',
    },
  };
}

type BundleOutcome =
  | { jobs: BundleJob[]; aborted?: boolean; finishEarly?: boolean }
  | { error: string }
  | { aborted: true; jobs: BundleJob[] };

export async function collectLinkedInPostings(params: {
  runId: Id<'scrape_runs'>;
  linkedinSearchQuery?: string;
  driver: ChromeDriver;
  env: NodeJS.ProcessEnv;
  /** When set (worker orchestrator), each scraped job is pushed over CDP and upserted immediately. */
  streamPosting?: (posting: ScrapedPostingInput) => Promise<void>;
}): Promise<ScrapeResult> {
  const debugMode: LinkedInDebugSteps = parseLinkedInDebugSteps(params.env);
  const linkedInMaxPages = parseLinkedInPagesFromEnv(params.env);
  const headless = parseEnvBool(params.env.WORKER_CHROME_HEADLESS, true);
  if (headless) {
    workerLog.warn('linkedin.chrome', {
      message:
        'WORKER_CHROME_HEADLESS is true: LinkedIn login and scraping are often unreliable headless. Prefer WORKER_CHROME_HEADLESS=0.',
    });
  }

  const queryRaw = params.linkedinSearchQuery?.trim() ?? '';
  const useKeywordPath = queryRaw.length > 0;

  const autoLogin = parseLinkedInAutoLoginFromEnv(params.env);
  if (autoLogin) {
    workerLog.info('linkedin.auto_login', {
      enabled: true,
      note: 'LINKEDIN_USER and LINKEDIN_PASS set; will submit login form once if shown',
    });
  }

  const overlayKind = linkedInOverlayKind(debugMode);

  /**
   * Must run **after** `navigate` + `waitForLinkedInJobsShell` on the LinkedIn document.
   * Injecting before navigation targets the previous blank/start page; the next load wipes the overlay
   * so `window.__jobBotScrape` is missing and debug steps / scraping appear to hang or no-op.
   */
  const injectOverlayIfNeeded = async (): Promise<void> => {
    await injectLinkedInScrapeOverlay(params.driver, overlayKind);
  };

  let uninstallPostingStream: (() => Promise<void>) | undefined;

  try {
    /** Caps live Convex upserts: CDP can deliver bindings after many in-page iterations; dedupe by posting id. */
    const streamedExternalIds = new Set<string>();
    if (params.streamPosting && params.driver.installJobPostingStreamBinding) {
      let chain = Promise.resolve();
      uninstallPostingStream = await params.driver.installJobPostingStreamBinding(
        JOB_BOT_POSTING_PUSH_BINDING,
        (jsonPayload) => {
          const work = chain.then(async () => {
            const job = JSON.parse(jsonPayload) as BundleJob;
            const id = String(job.externalId ?? '').trim();
            if (!id) {
              return;
            }
            if (streamedExternalIds.has(id)) {
              return;
            }
            if (streamedExternalIds.size >= TEMP_LINKEDIN_MAX_COLLECTED_POSTINGS) {
              return;
            }
            streamedExternalIds.add(id);
            await params.streamPosting!(bundleJobToScrapedPosting(job, params.runId));
          });
          chain = work.catch((err: unknown) => {
            workerLog.warn('linkedin.stream_posting', {
              message: err instanceof Error ? err.message : String(err),
            });
          });
          return work;
        }
      );
      workerLog.info('linkedin.stream_posting', { phase: 'binding_installed' });
    }

    if (useKeywordPath) {
      const kwUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(queryRaw)}`;
      workerLog.info('linkedin.navigate', { path: 'keyword', url: kwUrl });
      await params.driver.navigate(kwUrl, { timeoutMs: 60_000 });
      await waitForLinkedInJobsShell(params.driver, 15 * 60 * 1000, autoLogin);
      await injectOverlayIfNeeded();
      if (debugMode !== 'none') {
        workerLog.info('linkedin.debug_step', {
          phase: 'after_navigation_keyword',
        });
        await linkedInWaitStep(params.driver, {
          stepLabel: 'After navigation (keyword search shell)',
        });
      }
    } else {
      workerLog.info('linkedin.navigate', { path: 'preferences_hub', url: 'https://www.linkedin.com/jobs/' });
      await params.driver.navigate('https://www.linkedin.com/jobs/', { timeoutMs: 60_000 });
      await waitForLinkedInJobsShell(params.driver, 15 * 60 * 1000, autoLogin);

      await injectOverlayIfNeeded();
      if (debugMode !== 'none') {
        workerLog.info('linkedin.debug_step', { phase: 'jobs_hub_before_show_all' });
        await linkedInWaitStep(params.driver, {
          stepLabel: 'Jobs hub loaded — confirm before opening “Show all”',
        });
      }

      const prefResult = await params.driver.evaluate<{ ok?: boolean; error?: string }>(
        PREFERENCES_CLICK_SCRIPT
      );

      if (prefResult.error === 'PREF_CARD_MISSING' || prefResult.error === 'SHOW_ALL_MISSING') {
        throw new Error(
          'LinkedIn “Jobs based on your preferences” card or “Show all” was not found. Set job preferences on LinkedIn or queue a run with a non-empty LinkedIn search query.'
        );
      }
      if (prefResult.error) {
        throw new Error(`LinkedIn preferences navigation failed: ${prefResult.error}`);
      }

      await sleep(3200);
      await waitForLinkedInJobsShell(params.driver, 120_000, autoLogin);

      await injectOverlayIfNeeded();
      if (debugMode !== 'none') {
        workerLog.info('linkedin.debug_step', { phase: 'after_show_all' });
        await linkedInWaitStep(params.driver, {
          stepLabel: 'After “Show all” (preferences results list)',
        });
      }
    }

    await injectOverlayIfNeeded();
    workerLog.info('linkedin.scrape', {
      maxPages: linkedInMaxPages,
      maxCollectedJobsTemp: TEMP_LINKEDIN_MAX_COLLECTED_POSTINGS,
      WORKER_LINKEDIN_PAGES: params.env.WORKER_LINKEDIN_PAGES ?? null,
    });
    const expr = buildLinkedInJobsListScrapeExpression(
      debugMode,
      linkedInMaxPages,
      TEMP_LINKEDIN_MAX_COLLECTED_POSTINGS
    );
    const outcome = (await params.driver.evaluate<BundleOutcome>(expr)) as BundleOutcome;

    const fineLogs = await params.driver.evaluate<
      Array<{ jobTitle?: string; descriptionPreview?: string }>
    >(`(() => {
      try {
        return Array.from(document.querySelectorAll('[data-job-bot-fine-log]')).map((el) =>
          JSON.parse(el.textContent || '{}')
        );
      } catch (e) {
        return [];
      }
    })()`);

    for (const row of fineLogs) {
      workerLog.info('linkedin.job_step', {
        jobTitle: row.jobTitle,
        descriptionPreview: row.descriptionPreview,
      });
    }

    if ('error' in outcome && outcome.error) {
      throw new Error(outcome.error);
    }

    if ('aborted' in outcome && outcome.aborted) {
      const err = new Error(JOB_BOT_SCRAPE_ABORT_MESSAGE);
      err.name = 'JobBotScrapeAbort';
      throw err;
    }

    if ('finishEarly' in outcome && outcome.finishEarly) {
      workerLog.info('linkedin.scrape', {
        phase: 'finish_early',
        jobsCount: Array.isArray(outcome.jobs) ? outcome.jobs.length : 0,
      });
    }

    const jobs = 'jobs' in outcome ? (outcome.jobs ?? []) : [];
    const discoveredAt = Date.now();
    const seen = new Map<string, BundleJob>();

    for (const job of jobs) {
      if (!seen.has(job.externalId)) {
        seen.set(job.externalId, job);
      }
    }

    const uniqueJobs = Array.from(seen.values());
    const cappedJobs = uniqueJobs.slice(0, TEMP_LINKEDIN_MAX_COLLECTED_POSTINGS);
    const postings = cappedJobs.map((job) => ({
      source: 'linkedin',
      externalId: job.externalId,
      url: job.url,
      title: job.title,
      company: job.company,
      location: job.location,
      salaryText: job.salaryText,
      descriptionSnippet: job.descriptionSnippet,
      discoveredAt,
      scrapeRunId: params.runId,
      rawPayload: {
        ...job.rawPayload,
        provider: 'linkedin-cdp',
      },
    }));

    return {
      postings,
      stats: {
        discoveredCount: postings.length,
        dedupedCount: jobs.length - postings.length,
      },
    };
  } finally {
    if (uninstallPostingStream) {
      await uninstallPostingStream().catch(() => {});
      uninstallPostingStream = undefined;
    }
    await params.driver.evaluate<void>(
      `(() => {
        try {
          document.querySelectorAll('[data-job-bot-fine-log]').forEach((el) => el.remove());
        } catch (e) {}
      })()`
    );
    await removeLinkedInDebugOverlay(params.driver);
  }
}
