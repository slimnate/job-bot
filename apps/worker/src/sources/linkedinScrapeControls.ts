import type { ChromeDriver } from '@job-bot/agent-core';

import type { LinkedInOverlayKind } from './linkedinDebugSteps.js';

/**
 * Minimal strip for `WORKER_LINKEDIN_DEBUG_STEPS=none`: **Finish & rank** matches the full bar (end listing
 * early, then ranking continues in the worker). **Abort** cancels without ranking.
 */
const INJECT_ABORT_ONLY_OVERLAY_SCRIPT = `(() => {
  if (window.__jobBotScrapeCleanup) {
    window.__jobBotScrapeCleanup();
  }
  const root = document.createElement('div');
  root.id = 'job-bot-scrape-bar';
  root.style.cssText =
    'position:fixed;top:0;left:0;right:0;z-index:2147483647;display:flex;flex-direction:column;padding:max(8px, env(safe-area-inset-top, 0px)) 14px 10px 14px;background:#111;color:#eee;font:13px/1.4 system-ui,sans-serif;border-radius:0 0 10px 10px;box-shadow:0 6px 24px rgba(0,0,0,.45);box-sizing:border-box;pointer-events:auto';
  root.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">' +
    '<span style="opacity:.92;flex:1;min-width:180px">Job Bot — no stepping; Finish &amp; rank ends listing and runs ranking on jobs collected so far.</span>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
    '<button type="button" id="jbs-finish-min" style="padding:8px 14px;border-radius:6px;border:none;background:#15803d;color:#fff;cursor:pointer;font-weight:600">Finish &amp; rank</button>' +
    '<button type="button" id="jbs-abort-min" style="padding:8px 14px;border-radius:6px;border:1px solid #444;background:#222;color:#fcc;cursor:pointer">Abort</button>' +
    '</div></div>';
  var mount = document.body || document.documentElement;
  if (!mount) {
    throw new Error('JOB_BOT_DOM_MOUNT: document.body and document.documentElement are null');
  }
  mount.appendChild(root);
  window.__jobBotScrape = {
    waitStep: function () {
      return Promise.resolve();
    },
    abortRequested: false,
    finishEarlyRequested: false,
    __resolveContinue: function () {},
    __rejectAbort: function () {
      window.__jobBotScrape.abortRequested = true;
    },
  };
  document.getElementById('jbs-finish-min').addEventListener('click', function () {
    window.__jobBotScrape.finishEarlyRequested = true;
    window.__jobBotScrape.__resolveContinue();
  });
  document.getElementById('jbs-abort-min').addEventListener('click', function () {
    window.__jobBotScrape.__rejectAbort();
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

/** Injected into the LinkedIn tab: floating bar + Continue / Abort + waitStep(). */
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
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">' +
    '<button type="button" id="jbs-finish" style="flex:1;min-width:120px;padding:8px 12px;border-radius:6px;border:none;background:#15803d;color:#fff;cursor:pointer;font-weight:600">Finish &amp; rank</button>' +
    '<button type="button" id="jbs-cont" style="flex:1;min-width:100px;padding:8px 12px;border-radius:6px;border:none;background:#2563eb;color:#fff;cursor:pointer;font-weight:600">Continue</button>' +
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
      window.__jobBotScrape.abortRequested = true;
      if (continueRejector) {
        var rj = continueRejector;
        continueResolver = null;
        continueRejector = null;
        rj(new Error('JOB_BOT_SCRAPE_ABORT'));
      }
    },
  };
  document.getElementById('jbs-finish').addEventListener('click', function () {
    window.__jobBotScrape.finishEarlyRequested = true;
    window.__jobBotScrape.__resolveContinue();
  });
  document.getElementById('jbs-cont').addEventListener('click', function () {
    window.__jobBotScrape.__resolveContinue();
  });
  document.getElementById('jbs-abort').addEventListener('click', function () {
    window.__jobBotScrape.__rejectAbort();
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
 * Injects the top overlay for LinkedIn scraping: **abort_only** (Finish & rank + Abort, no stepping, for `none`) or **full** stepping bar.
 */
export async function injectLinkedInScrapeOverlay(
  driver: ChromeDriver,
  kind: LinkedInOverlayKind
): Promise<void> {
  await injectOverlayScript(driver, kind === 'abort_only' ? INJECT_ABORT_ONLY_OVERLAY_SCRIPT : INJECT_OVERLAY_SCRIPT);
}

/** @deprecated Prefer {@link injectLinkedInScrapeOverlay} with `full`. */
export async function injectLinkedInDebugOverlay(driver: ChromeDriver): Promise<void> {
  await injectLinkedInScrapeOverlay(driver, 'full');
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
