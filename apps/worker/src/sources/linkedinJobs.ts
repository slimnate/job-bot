import { JOB_BOT_POSTING_PUSH_BINDING, type ChromeDriver } from '@job-bot/agent-core';

import type { Id } from '../convexBridge/doc.js';
import { isScrapeDebug } from '../debugFlags.js';
import { workerLog } from '../log.js';
import type { ScrapeResult, ScrapedPostingInput } from '../scrapeTypes.js';

import {
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

const DEFAULT_LINKEDIN_PAGES = 3;
const MAX_LINKEDIN_PAGES_CAP = 10;

/**
 * Parses `WORKER_LINKEDIN_PAGES`: positive integer, default 3, capped for safety.
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

/**
 * Parses `WORKER_LINKEDIN_MAX_POSTINGS`: optional positive integer cap for collected postings.
 * Returns `undefined` when unset/blank so scraping remains uncapped.
 */
function parseLinkedInMaxPostingsFromEnv(env: NodeJS.ProcessEnv): number | undefined {
  const raw = env.WORKER_LINKEDIN_MAX_POSTINGS;
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < 1) {
    workerLog.warn('linkedin.max_postings', {
      message: `Invalid WORKER_LINKEDIN_MAX_POSTINGS=${JSON.stringify(raw)}; ignoring cap`,
    });
    return undefined;
  }
  return n;
}

/**
 * Booleans from `LINKEDIN_SHELL_POLL_SCRIPT` for troubleshooting sign-in / jobs-shell detection in Convex run logs.
 * No credentials or page body text — only URL path and selector hits.
 */
type LoginPollDebug = {
  path: string;
  onLoginUrl: boolean;
  onMemberOnlyPath: boolean;
  hasMemberNav: boolean;
  hasNarrowGuestChrome: boolean;
  /** `signedIn` branch: member-only path (e.g. /feed) and not a login URL. */
  signedInPathOk: boolean;
  /** `signedIn` branch: global nav / profile signals and no narrow guest chrome. */
  signedInNavOk: boolean;
  hasResultsShell: boolean;
  hasJobsHub: boolean;
  onJobsArea: boolean;
  hasJobLink: boolean;
};

type LoginPoll = {
  onLogin: boolean;
  signedIn: boolean;
  hasShell: boolean;
  href: string;
  /** Why we are still waiting (for logs only). */
  waitReason: string;
  debug: LoginPollDebug;
};

const LINKEDIN_COOKIE_CHECK_URLS = ['https://www.linkedin.com/', 'https://www.linkedin.com/jobs/'] as const;

/**
 * True when Chrome has a non-empty LinkedIn `li_at` cookie. It is httpOnly, so in-page scripts cannot
 * see it — but CDP can. DOM heuristics alone often report `signedIn: false` on /feed and /jobs while
 * the session is valid (see run logs: `hasShell: true`, `signedIn: false`).
 */
async function linkedInSessionCookiePresent(driver: ChromeDriver): Promise<boolean> {
  if (!driver.getCookiesForUrls) {
    return false;
  }
  const rows = await driver.getCookiesForUrls([...LINKEDIN_COOKIE_CHECK_URLS]);
  return rows.some((c) => c.name === 'li_at' && c.value.trim().length > 0);
}

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
    /linkedin\\.com\\/(login|checkpoint|uas\\/login|authwall|signup|reg\\/join)/i.test(href) ||
    /\\/login\\/?$/i.test(path) ||
    path.includes('/checkpoint/') ||
    path.includes('/authwall');

  const pwd = document.querySelector(
    'input[type="password"][autocomplete="current-password"], input#session_password, input[name="session_password"]'
  );
  const user = document.querySelector('input[name="session_key"], input#username, input[name="session_key"]');
  const onLoginForm = Boolean(
    onLoginUrl ||
      (visible(pwd) && user && visible(user)) ||
      (visible(pwd) && /login|checkpoint/i.test(path))
  );

  // Guest / auth-wall prompts only — do not match generic /login links (feed still embeds those).
  const hasNarrowGuestChrome = Boolean(
    document.querySelector(
      'a[href*="/uas/login"], a[href*="/authwall"], a[data-tracking-control-name*="guest_homepage"], button[data-tracking-control-name*="guest_homepage"]'
    )
  );
  const hasMemberNav = Boolean(
    document.querySelector(
      'a[href^="/feed/"], a[href="/feed/"], a[href^="https://www.linkedin.com/feed"], nav.global-nav, nav[aria-label="Primary Navigation"], img.global-nav__me-photo, button[aria-label*="Me" i], button[aria-label*="Your profile" i], a[data-control-name*="nav.profile"], a[href^="/in/"], #global-nav'
    )
  );
  // Locale paths like /en/feed/ — segment regex (avoid only matching path === /feed).
  const onMemberOnlyPath = /(^|\\/)(feed|mynetwork|messaging|notifications)(\\/|$)/.test(path);
  const signedInPathOk = Boolean(!onLoginForm && onMemberOnlyPath && !onLoginUrl);
  const signedInNavOk = Boolean(!onLoginForm && hasMemberNav && !hasNarrowGuestChrome);
  const signedIn = Boolean(signedInPathOk || signedInNavOk);

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
  if (!signedIn) waitReason = 'not_signed_in';
  else if (!hasShell) waitReason = 'no_jobs_ui_match';

  return {
    onLogin: onLoginForm,
    signedIn,
    hasShell,
    href,
    waitReason,
    debug: {
      path,
      onLoginUrl,
      onMemberOnlyPath,
      hasMemberNav,
      hasNarrowGuestChrome,
      signedInPathOk,
      signedInNavOk,
      hasResultsShell,
      hasJobsHub,
      onJobsArea,
      hasJobLink,
    },
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
 * Waits until authenticated LinkedIn jobs UI is usable or throws after `timeoutMs`.
 * If `autoLogin` is set, performs **one** automatic submit when a login form is detected (then falls back to manual wait).
 */
async function waitForLinkedInJobsShell(
  driver: ChromeDriver,
  timeoutMs: number,
  autoLogin: LinkedInAutoLoginCreds | null
): Promise<void> {
  const start = Date.now();
  let autoLoginAttempted = false;
  /**
   * Signed-in user on feed/home/checkpoint-complete still needs an explicit `/jobs/` navigation;
   * we only do this once per wait so we do not fight in-page LinkedIn redirects.
   */
  let didNavigateToJobsFromNonJobs = false;
  /**
   * Signed-in on `/jobs/` but selectors have not matched yet (slow or stuck layout) — one reload
   * of the jobs hub after a stall threshold.
   */
  let didRetryJobsHubNavigation = false;
  /** When we first saw signed-in on `/jobs/` without a jobs shell (for stall retry timing). */
  let signedInOnJobsWithoutShellSince: number | null = null;
  /**
   * Guest / intermediate pages sometimes show no login form; with env creds, open `/login` once
   * so `buildLinkedInAutoLoginExpression` can run.
   */
  let loginPageNavigationAttempted = false;

  const JOBS_HUB_URL = 'https://www.linkedin.com/jobs/';
  const onLinkedInJobsPath = (href: string): boolean => /linkedin\.com\/jobs/i.test(href);

  while (Date.now() - start < timeoutMs) {
    const state = await driver.evaluate<LoginPoll>(LINKEDIN_SHELL_POLL_SCRIPT);
    const liAtPresent = await linkedInSessionCookiePresent(driver);
    const signedInEffective = state.signedIn || liAtPresent;

    if (signedInEffective && !state.onLogin && state.hasShell) {
      return;
    }

    if (signedInEffective && !state.onLogin && !state.hasShell) {
      const onJobs = onLinkedInJobsPath(state.href);
      if (!onJobs && !didNavigateToJobsFromNonJobs) {
        didNavigateToJobsFromNonJobs = true;
        workerLog.info('linkedin.navigate', {
          reason: 'signed_in_off_jobs_hub',
          href: state.href,
        });
        await driver.navigate(JOBS_HUB_URL, { timeoutMs: 60_000 });
        await sleep(2500);
        signedInOnJobsWithoutShellSince = null;
        continue;
      }
      if (onJobs) {
        if (signedInOnJobsWithoutShellSince === null) {
          signedInOnJobsWithoutShellSince = Date.now();
        } else if (
          !didRetryJobsHubNavigation &&
          Date.now() - signedInOnJobsWithoutShellSince > 12_000
        ) {
          didRetryJobsHubNavigation = true;
          workerLog.info('linkedin.navigate', {
            reason: 'signed_in_jobs_shell_stall_retry',
            href: state.href,
            stalledMs: Date.now() - signedInOnJobsWithoutShellSince,
          });
          await driver.navigate(JOBS_HUB_URL, { timeoutMs: 60_000 });
          await sleep(2500);
          signedInOnJobsWithoutShellSince = Date.now();
          continue;
        }
      }
    } else {
      signedInOnJobsWithoutShellSince = null;
    }

    if (
      autoLogin &&
      !autoLoginAttempted &&
      !signedInEffective &&
      !state.onLogin &&
      !loginPageNavigationAttempted &&
      Date.now() - start > 4000
    ) {
      loginPageNavigationAttempted = true;
      workerLog.info('linkedin.auto_login', {
        phase: 'navigate_login_page',
        href: state.href,
      });
      await driver.navigate('https://www.linkedin.com/login', { timeoutMs: 60_000 });
      await sleep(2000);
      continue;
    }

    if (state.onLogin && autoLogin && !autoLoginAttempted) {
      autoLoginAttempted = true;
      workerLog.info('linkedin.auto_login', {
        phase: 'attempt',
        href: state.href,
      });
      let submittedOk = false;
      try {
        const expr = buildLinkedInAutoLoginExpression(autoLogin.user, autoLogin.password);
        const result = await driver.evaluate<{ ok: boolean; reason?: string; via?: string }>(expr);
        if (result.ok) {
          submittedOk = true;
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
      await sleep(submittedOk ? 4000 : 1500);
      if (submittedOk) {
        workerLog.info('linkedin.navigate', {
          reason: 'after_auto_login_submit',
          href: state.href,
        });
        await driver.navigate(JOBS_HUB_URL, { timeoutMs: 60_000 });
        await sleep(2500);
        signedInOnJobsWithoutShellSince = null;
      }
      continue;
    }

    const waitReasonEffective = !signedInEffective
      ? 'not_signed_in'
      : !state.hasShell
        ? 'no_jobs_ui_match'
        : 'ok';

    workerLog.info('linkedin.login_wait', {
      phase: 'polling',
      href: state.href,
      onLogin: state.onLogin,
      signedIn: signedInEffective,
      signedInDom: state.signedIn,
      liAtPresent,
      hasShell: state.hasShell,
      waitReason: waitReasonEffective,
      waitReasonDom: state.waitReason,
      dbg: state.debug,
    });
    await sleep(2500);
  }

  throw new Error(
    'Timed out waiting for authenticated LinkedIn jobs UI. Sign in in the Chrome window and retry.'
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

function buildLinkedInApplySearchUiExpression(search: string, location: string): string {
  const searchJson = JSON.stringify(search);
  const locationJson = JSON.stringify(location);
  return `(() => {
    const searchValue = ${searchJson};
    const locationValue = ${locationJson};
    const norm = (v) => (v || '').replace(/\\s+/g, ' ').trim();
    const setInput = (input, value) => {
      input.focus();
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      if (value) {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    };
    const findFirst = (selectors) => {
      for (const selector of selectors) {
        const found = document.querySelector(selector);
        if (found instanceof HTMLInputElement) {
          return { input: found, selector };
        }
      }
      return null;
    };
    const keywordSelectors = [
      'input[aria-label*="Search by title"]',
      'input[aria-label*="Search jobs"]',
      'input[id*="jobs-search-box-keyword-id"]',
      'input[name*="keywords"]'
    ];
    const locationSelectors = [
      'input[aria-label*="City"]',
      'input[aria-label*="location"]',
      'input[id*="jobs-search-box-location-id"]',
      'input[name*="location"]'
    ];
    const keyword = findFirst(keywordSelectors);
    const location = findFirst(locationSelectors);
    if (!keyword && searchValue) {
      return { ok: false, reason: 'keyword_input_missing' };
    }
    if (!location && locationValue) {
      return { ok: false, reason: 'location_input_missing' };
    }
    if (keyword) setInput(keyword.input, searchValue);
    if (location) setInput(location.input, locationValue);

    const submitCandidates = [
      'button[aria-label*="Search"]',
      '.jobs-search-box__submit-button',
      'button[type="submit"]'
    ];
    let submitSelector = null;
    let submitted = false;
    for (const selector of submitCandidates) {
      const node = document.querySelector(selector);
      if (node instanceof HTMLElement) {
        node.click();
        submitSelector = selector;
        submitted = true;
        break;
      }
    }
    if (!submitted && keyword) {
      keyword.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      keyword.input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
      submitSelector = 'keyword_enter';
      submitted = true;
    }
    if (!submitted) {
      return { ok: false, reason: 'search_submit_missing' };
    }
    return {
      ok: true,
      keywordSelector: keyword ? keyword.selector : null,
      locationSelector: location ? location.selector : null,
      submitSelector
    };
  })()`;
}

type LinkedInUiSearchResult = {
  ok: boolean;
  reason?: string;
  keywordSelector?: string | null;
  locationSelector?: string | null;
  submitSelector?: string | null;
};

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
  sourceCriteria?: Record<string, string>;
  driver: ChromeDriver;
  env: NodeJS.ProcessEnv;
  /** When set (worker orchestrator), each scraped job is pushed over CDP and upserted immediately. */
  streamPosting?: (posting: ScrapedPostingInput) => Promise<void>;
}): Promise<ScrapeResult> {
  const debugMode: LinkedInDebugSteps = parseLinkedInDebugSteps(params.env);
  const steppingEnabled = debugMode === 'coarse' || debugMode === 'fine';
  const linkedInMaxPages = parseLinkedInPagesFromEnv(params.env);
  const linkedInMaxPostings = parseLinkedInMaxPostingsFromEnv(params.env);
  const headless = parseEnvBool(params.env.WORKER_CHROME_HEADLESS, true);
  if (headless) {
    workerLog.warn('linkedin.chrome', {
      message:
        'WORKER_CHROME_HEADLESS is true: LinkedIn login and scraping are often unreliable headless. Prefer WORKER_CHROME_HEADLESS=0.',
    });
  }

  const queryRaw = params.sourceCriteria?.search?.trim() ?? '';
  const locationRaw = params.sourceCriteria?.location?.trim() ?? '';
  const useSearchPath = queryRaw.length > 0 || locationRaw.length > 0;

  const autoLogin = parseLinkedInAutoLoginFromEnv(params.env);
  if (autoLogin) {
    workerLog.info('linkedin.auto_login', {
      enabled: true,
      note: 'LINKEDIN_USER and LINKEDIN_PASS set; will submit login form once if shown',
    });
  }

  /**
   * Must run **after** `navigate` + `waitForLinkedInJobsShell` on the LinkedIn document.
   * Injecting before navigation targets the previous blank/start page; the next load wipes the overlay
   * so `window.__jobBotScrape` is missing and debug steps / scraping appear to hang or no-op.
   */
  const injectOverlayIfNeeded = async (): Promise<void> => {
    if (isScrapeDebug()) {
      workerLog.debug('linkedin.overlay.inject', { phase: 'before_evaluate' });
    }
    await injectLinkedInScrapeOverlay(params.driver);
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
              if (isScrapeDebug()) {
                workerLog.debug('linkedin.stream_posting.skip_dedupe', { externalId: id });
              }
              return;
            }
            if (
              linkedInMaxPostings !== undefined &&
              streamedExternalIds.size >= linkedInMaxPostings
            ) {
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

    workerLog.info('linkedin.navigate', { path: 'jobs_hub', url: 'https://www.linkedin.com/jobs/' });
    await params.driver.navigate('https://www.linkedin.com/jobs/', { timeoutMs: 60_000 });
    await waitForLinkedInJobsShell(params.driver, 15 * 60 * 1000, autoLogin);

    if (isScrapeDebug()) {
      workerLog.debug('linkedin.milestone', { phase: 'after_initial_jobs_shell' });
    }

    await injectOverlayIfNeeded();

    let searchStrategyUsed: 'ui' | 'url_fallback' | 'preferences_hub' = 'preferences_hub';
    let fallbackReason: string | null = null;

    if (useSearchPath) {
      const uiResult = await params.driver.evaluate<LinkedInUiSearchResult>(
        buildLinkedInApplySearchUiExpression(queryRaw, locationRaw)
      );
      if (uiResult.ok) {
        searchStrategyUsed = 'ui';
        workerLog.info('linkedin.search_ui', {
          event: 'linkedin_search_ui_applied',
          strategyUsed: searchStrategyUsed,
          keywordSelector: uiResult.keywordSelector ?? null,
          locationSelector: uiResult.locationSelector ?? null,
          submitSelector: uiResult.submitSelector ?? null,
          hasKeywords: queryRaw.length > 0,
          hasLocation: locationRaw.length > 0,
        });
        await sleep(2800);
        if (isScrapeDebug()) {
          workerLog.debug('linkedin.milestone', { phase: 'after_search_ui_sleep' });
        }
        await waitForLinkedInJobsShell(params.driver, 120_000, autoLogin);
      } else {
        fallbackReason = uiResult.reason ?? 'ui_search_failed';
        const searchParams = new URLSearchParams();
        if (queryRaw.length > 0) {
          searchParams.set('keywords', queryRaw);
        }
        if (locationRaw.length > 0) {
          searchParams.set('location', locationRaw);
        }
        const searchUrl = `https://www.linkedin.com/jobs/search/?${searchParams.toString()}`;
        searchStrategyUsed = 'url_fallback';
        workerLog.warn('linkedin.search_fallback', {
          event: 'linkedin_search_fallback_to_url',
          strategyUsed: searchStrategyUsed,
          reason: fallbackReason,
          selectorAttemptSummary: {
            keywordSelector: uiResult.keywordSelector ?? null,
            locationSelector: uiResult.locationSelector ?? null,
            submitSelector: uiResult.submitSelector ?? null,
          },
          url: searchUrl,
          hasKeywords: queryRaw.length > 0,
          hasLocation: locationRaw.length > 0,
        });
        await params.driver.navigate(searchUrl, { timeoutMs: 60_000 });
        await waitForLinkedInJobsShell(params.driver, 120_000, autoLogin);
      }
    } else {
      if (steppingEnabled) {
        if (isScrapeDebug()) {
          workerLog.debug('linkedin.debug_step', { phase: 'jobs_hub_before_show_all' });
        }
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
    }

    await injectOverlayIfNeeded();
    if (steppingEnabled) {
      if (isScrapeDebug()) {
        workerLog.debug('linkedin.debug_step', { phase: 'after_search_navigation' });
      }
      await linkedInWaitStep(params.driver, {
        stepLabel: 'After search navigation (results shell)',
      });
    }

    await injectOverlayIfNeeded();
    workerLog.info('linkedin.scrape', {
      event: 'linkedin_search_strategy',
      strategyUsed: searchStrategyUsed,
      usedLinkedinUrlFallback: searchStrategyUsed === 'url_fallback',
      fallbackReason,
      maxPages: linkedInMaxPages,
      maxPostings: linkedInMaxPostings ?? null,
      WORKER_LINKEDIN_PAGES: params.env.WORKER_LINKEDIN_PAGES ?? null,
      WORKER_LINKEDIN_MAX_POSTINGS: params.env.WORKER_LINKEDIN_MAX_POSTINGS ?? null,
    });
    const expr = buildLinkedInJobsListScrapeExpression(
      debugMode,
      linkedInMaxPages,
      linkedInMaxPostings
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
    const cappedJobs =
      linkedInMaxPostings !== undefined
        ? uniqueJobs.slice(0, linkedInMaxPostings)
        : uniqueJobs;
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
      searchTelemetry: {
        strategyUsed: searchStrategyUsed,
        usedLinkedinUrlFallback: searchStrategyUsed === 'url_fallback',
        fallbackReason: fallbackReason ?? undefined,
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
