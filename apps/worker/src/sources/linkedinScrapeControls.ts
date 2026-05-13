import type { ChromeDriver } from '@job-bot/agent-core';

/**
 * Injected stats row: four color-coded pills updated by `updateScrapeStats` from the in-page scrape driver.
 */
const SCRAPE_STATS_BADGES_ROW =
  '<div id="jbs-stats" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:4px">' +
  '<span id="jbs-badge-scraped" title="Postings collected and stored this run" ' +
  'style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:600;' +
  'background:#14532d;color:#ecfdf7;border:1px solid #22c55e">Scraped 0</span>' +
  '<span id="jbs-badge-onpage" title="Job-like list targets visible this pass (virtualized list)" ' +
  'style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:600;' +
  'background:#1e3a5f;color:#dbeafe;border:1px solid #3b82f6">List 0</span>' +
  '<span id="jbs-badge-page" title="LinkedIn results pagination (Next)" ' +
  'style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:600;' +
  'background:#422006;color:#fef3c7;border:1px solid #f59e0b">Page ?/?</span>' +
  '<span id="jbs-badge-cap" title="Per-run job cap (WORKER_LINKEDIN_MAX_POSTINGS); em dash = none" ' +
  'style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:600;' +
  'background:#334155;color:#e2e8f0;border:1px solid #64748b">Cap —</span>' +
  '</div>';

/**
 * Injected into the page as `window.__jobBotScrape.updateScrapeStats`.
 * Payload: `scraped` (number), `onPage` (list targets this pass), `pageIndex`, `maxPages`,
 * `maxCollectedJobs` (`null` = no cap). Updates pill badges and cap colors when near/at limit.
 */
const SCRAPE_UPDATE_STATS_FN_BODY = `
  if (!p || typeof p !== 'object') return;
  function n(x, d) {
    if (x == null || x !== x) return d;
    var v = Number(x);
    return Number.isFinite(v) ? v : d;
  }
  var scraped = n(p.scraped, 0);
  var onPage = n(p.onPage, 0);
  var pageIndex = n(p.pageIndex, 0);
  var maxPages = n(p.maxPages, 0);
  var capRaw = p.maxCollectedJobs;
  var elS = document.getElementById('jbs-badge-scraped');
  var elO = document.getElementById('jbs-badge-onpage');
  var elP = document.getElementById('jbs-badge-page');
  var elC = document.getElementById('jbs-badge-cap');
  if (elS) {
    elS.textContent = 'Scraped ' + scraped;
    elS.title = 'Postings collected and stored this run';
  }
  if (elO) {
    elO.textContent = 'List ' + onPage;
    elO.title = 'Job-like list targets visible this pass (virtualized list)';
  }
  if (elP) {
    elP.textContent = 'Page ' + (maxPages > 0 ? pageIndex + '/' + maxPages : String(pageIndex));
    elP.title = 'LinkedIn results pagination (Next); max pages from WORKER_LINKEDIN_PAGES';
  }
  if (elC) {
    if (capRaw == null || capRaw === '') {
      elC.textContent = 'Cap —';
      elC.title = 'No per-run job cap (WORKER_LINKEDIN_MAX_POSTINGS unset)';
      elC.style.background = '#334155';
      elC.style.color = '#e2e8f0';
      elC.style.border = '1px solid #64748b';
    } else {
      var capN = n(capRaw, 0);
      elC.textContent = 'Cap ' + capN;
      elC.title = 'Per-run job cap (WORKER_LINKEDIN_MAX_POSTINGS)';
      var near =
        capN > 0 &&
        scraped >= capN - 1 &&
        scraped < capN;
      var at = capN > 0 && scraped >= capN;
      if (at || near) {
        elC.style.background = '#7c2d12';
        elC.style.color = '#ffedd5';
        elC.style.border = '1px solid #ea580c';
      } else {
        elC.style.background = '#3730a3';
        elC.style.color = '#e0e7ff';
        elC.style.border = '1px solid #818cf8';
      }
    }
  }
`;

/** Injected into the LinkedIn tab: stats, Pause/Resume, Finish & rank, Continue, Abort, and `waitStep()`. */
const INJECT_OVERLAY_SCRIPT = `(() => {
  if (window.__jobBotScrapeCleanup) {
    window.__jobBotScrapeCleanup();
  }
  const root = document.createElement('div');
  root.id = 'job-bot-scrape-bar';
  root.style.cssText =
    'position:fixed;top:0;left:0;right:0;z-index:2147483647;display:flex;flex-direction:column;gap:8px;padding:max(10px, env(safe-area-inset-top, 0px)) 16px 10px 16px;background:#111;color:#eee;font:13px/1.4 system-ui,sans-serif;border-radius:0 0 10px 10px;box-shadow:0 6px 24px rgba(0,0,0,.45);box-sizing:border-box;pointer-events:auto';
  root.innerHTML =
    '<div id="jbs-step" style="white-space:pre-wrap">Job Bot scrape controls…</div>' +
    '<div id="jbs-title" style="font-weight:600;display:none"></div>' +
    '<div id="jbs-desc" style="font-family:ui-monospace,monospace;font-size:11px;opacity:.9;white-space:pre-wrap;display:none"></div>' +
    ${JSON.stringify(SCRAPE_STATS_BADGES_ROW)} +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">' +
    '<button type="button" id="jbs-finish" style="flex:1;min-width:120px;padding:8px 12px;border-radius:6px;border:none;background:#15803d;color:#fff;cursor:pointer;font-weight:600">Finish &amp; rank</button>' +
    '<button type="button" id="jbs-cont" style="flex:1;min-width:100px;padding:8px 12px;border-radius:6px;border:none;background:#2563eb;color:#fff;cursor:pointer;font-weight:600">Continue</button>' +
    '<button type="button" id="jbs-pause" aria-pressed="false" title="Pause at next checkpoint" style="padding:8px 12px;border-radius:6px;border:1px solid #a16207;background:#422006;color:#fef9c3;cursor:pointer;font-weight:600">Pause</button>' +
    '<button type="button" id="jbs-abort" style="padding:8px 12px;border-radius:6px;border:1px solid #444;background:#222;color:#fcc;cursor:pointer">Abort</button>' +
    '</div>';
  var mount = document.body || document.documentElement;
  if (!mount) {
    throw new Error('JOB_BOT_DOM_MOUNT: document.body and document.documentElement are null');
  }
  mount.appendChild(root);
  let continueResolver = null;
  let continueRejector = null;
  window.__jobBotScrape = {
    waitStep: function (payload) {
      var stepEl = document.getElementById('jbs-step');
      var titleEl = document.getElementById('jbs-title');
      var descEl = document.getElementById('jbs-desc');
      if (stepEl) {
        stepEl.textContent = (payload && payload.stepLabel) || '';
      }
      if (titleEl) {
        if (payload && payload.jobTitle) {
          titleEl.style.display = 'block';
          titleEl.textContent = payload.jobTitle;
        } else {
          titleEl.style.display = 'none';
          titleEl.textContent = '';
        }
      }
      if (descEl) {
        if (payload && payload.descriptionPreview) {
          descEl.style.display = 'block';
          descEl.textContent = payload.descriptionPreview;
        } else {
          descEl.style.display = 'none';
          descEl.textContent = '';
        }
      }
      return new Promise(function (resolve, reject) {
        continueResolver = resolve;
        continueRejector = reject;
      });
    },
    updateScrapeStats: function (p) {${SCRAPE_UPDATE_STATS_FN_BODY}},
    paused: false,
    abortRequested: false,
    finishEarlyRequested: false,
    __resolveContinue: function () {
      if (continueResolver) {
        var r = continueResolver;
        continueResolver = null;
        continueRejector = null;
        r();
      }
    },
    __rejectAbort: function () {
      window.__jobBotScrape.paused = false;
      window.__jobBotScrape.abortRequested = true;
      if (continueRejector) {
        var rj = continueRejector;
        continueResolver = null;
        continueRejector = null;
        rj(new Error('JOB_BOT_SCRAPE_ABORT'));
      }
    },
  };
  function jbsSyncPauseButton() {
    var b = document.getElementById('jbs-pause');
    if (!b || !window.__jobBotScrape) return;
    var on = Boolean(window.__jobBotScrape.paused);
    b.textContent = on ? 'Resume' : 'Pause';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.title = on ? 'Resume LinkedIn scraping' : 'Pause at next checkpoint';
  }
  document.getElementById('jbs-pause').addEventListener('click', function () {
    window.__jobBotScrape.paused = !window.__jobBotScrape.paused;
    jbsSyncPauseButton();
  });
  document.getElementById('jbs-finish').addEventListener('click', function () {
    window.__jobBotScrape.finishEarlyRequested = true;
    window.__jobBotScrape.__resolveContinue();
  });
  document.getElementById('jbs-cont').addEventListener('click', function () {
    window.__jobBotScrape.__resolveContinue();
  });
  document.getElementById('jbs-abort').addEventListener('click', function () {
    window.__jobBotScrape.__rejectAbort();
    jbsSyncPauseButton();
  });
  window.__jobBotScrapeCleanup = function () {
    root.remove();
    try {
      delete window.__jobBotScrape;
    } catch (e) {}
    try {
      delete window.__jobBotScrapeCleanup;
    } catch (e) {}
  };
})()`;

async function injectOverlayScript(driver: ChromeDriver, script: string): Promise<void> {
  const maxAttempts = 12;
  const delayMs = 400;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await driver.evaluate<void>(script);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Injects the fixed top overlay for LinkedIn scraping (stats, controls, `waitStep`).
 */
export async function injectLinkedInScrapeOverlay(driver: ChromeDriver): Promise<void> {
  await injectOverlayScript(driver, INJECT_OVERLAY_SCRIPT);
}

/** @deprecated Prefer {@link injectLinkedInScrapeOverlay}. */
export async function injectLinkedInDebugOverlay(driver: ChromeDriver): Promise<void> {
  await injectLinkedInScrapeOverlay(driver);
}

export async function removeLinkedInDebugOverlay(driver: ChromeDriver): Promise<void> {
  await driver.evaluate<void>(
    'typeof window.__jobBotScrapeCleanup === "function" && window.__jobBotScrapeCleanup()'
  ).catch(() => {});
}

export async function linkedInWaitStep(
  driver: ChromeDriver,
  payload: { stepLabel: string; jobTitle?: string; descriptionPreview?: string }
): Promise<void> {
  const payloadJson = JSON.stringify(payload);
  const expr = `(() => {
    if (!window.__jobBotScrape || typeof window.__jobBotScrape.waitStep !== 'function') {
      throw new Error(
        'LinkedIn scrape overlay is not on this page (waitStep). Ensure the worker injected the overlay after navigation.'
      );
    }
    return window.__jobBotScrape.waitStep(${payloadJson});
  })()`;
  await driver.evaluate<void>(expr);
}
