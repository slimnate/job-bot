import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LinkedInDebugSteps } from './linkedinDebugSteps.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Browser-side helper bundle (injected before the async scrape driver).
 * Kept as a `.js` file so the same source runs in Node tests (jsdom) and in CDP `evaluate`.
 */
function loadLinkedInScrapeInpageSource(): string {
  return readFileSync(join(__dirname, 'linkedinScrapeInpage.js'), 'utf8');
}

function loadLinkedInScrapeClickTargetsSource(): string {
  return readFileSync(join(__dirname, 'linkedinScrapeClickTargets.js'), 'utf8');
}

/**
 * Browser-side async scrape for LinkedIn jobs search results (split-pane list/detail).
 * Ported from oc-job-capture/popup.js executeLinkExtraction patterns + read-more expansion.
 *
 * @param maxPages How many results pages to walk (clamped by the caller, typically from `WORKER_LINKEDIN_PAGES`).
 * @param maxCollectedJobs Optional cap for collected postings; when undefined, collection is unbounded.
 * @param listResultsUrl URL to return to after accidental full-page /jobs/view/ navigation (geo + default paths).
 */
export function buildLinkedInJobsListScrapeExpression(
  debugMode: LinkedInDebugSteps,
  maxPages: number,
  maxCollectedJobs: number | undefined,
  listResultsUrl?: string
): string {
  const DEBUG = JSON.stringify(debugMode);
  const pages = Math.max(1, Math.floor(maxPages));
  const maxCollectedJobsLiteral =
    maxCollectedJobs === undefined ? 'null' : String(Math.max(1, Math.floor(maxCollectedJobs)));
  const listResultsUrlLiteral =
    listResultsUrl && listResultsUrl.trim().length > 0
      ? JSON.stringify(listResultsUrl.trim())
      : 'null';
  const INPAGE = loadLinkedInScrapeInpageSource();
  const CLICK_TARGETS = loadLinkedInScrapeClickTargetsSource();
  return `(async () => {
    ${INPAGE}
    ${CLICK_TARGETS}
    const li = globalThis.__jobBotLiScrape;
    const ct = globalThis.__jobBotLiClickTargets;
    const DEBUG = ${DEBUG};
    const MAX_PAGES = ${pages};
    const MAX_COLLECTED_JOBS = ${maxCollectedJobsLiteral};
    const na = li.na;
    /** Avoid pathological DOM dumps; full text is still very large vs. the old 600-char snippet. */
    const DESCRIPTION_MAX_STORE_CHARS = 200000;

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const aborted = () => Boolean(window.__jobBotScrape && window.__jobBotScrape.abortRequested);
    const finishEarly = () =>
      Boolean(window.__jobBotScrape && window.__jobBotScrape.finishEarlyRequested);

    const collected = [];
    const seenJobIds = new Set();

    const scrapeStopped = () => {
      if (aborted()) return { aborted: true, jobs: collected };
      if (finishEarly()) return { jobs: collected, finishEarly: true };
      return null;
    };

    /** Pushes scrape counters into the injected overlay badges (no-op if overlay lacks updateScrapeStats). */
    function syncScrapeStats(onPageCount, pageIdx) {
      try {
        if (
          !window.__jobBotScrape ||
          typeof window.__jobBotScrape.updateScrapeStats !== 'function'
        ) {
          return;
        }
        window.__jobBotScrape.updateScrapeStats({
          scraped: collected.length,
          onPage: onPageCount,
          pageIndex: pageIdx,
          maxPages: MAX_PAGES,
          maxCollectedJobs: MAX_COLLECTED_JOBS,
        });
      } catch (e) {}
    }

    /** Blocks until user resumes or scrape stops (abort / finish early). */
    async function waitIfPaused() {
      const tickMs = 200;
      for (;;) {
        const st = scrapeStopped();
        if (st) return;
        var bot = window.__jobBotScrape;
        if (!bot || !bot.paused) return;
        await sleep(tickMs);
      }
    }

    async function waitMajor(stepLabel) {
      if (DEBUG === 'none') return;
      if (!window.__jobBotScrape || typeof window.__jobBotScrape.waitStep !== 'function') return;
      try {
        await window.__jobBotScrape.waitStep({ stepLabel: stepLabel });
      } catch (e) {
        throw e;
      }
    }

    async function waitFine(jobTitle, descriptionPreview) {
      if (DEBUG !== 'fine') return;
      try {
        const marker = document.createElement('div');
        marker.setAttribute('data-job-bot-fine-log', '1');
        marker.textContent = JSON.stringify({
          jobTitle: jobTitle,
          descriptionPreview: descriptionPreview,
        });
        marker.style.display = 'none';
        const mount = document.body || document.documentElement;
        if (mount) mount.appendChild(marker);
      } catch (e) {}
      if (!window.__jobBotScrape || typeof window.__jobBotScrape.waitStep !== 'function') return;
      await window.__jobBotScrape.waitStep({
        stepLabel: 'After job capture',
        jobTitle: jobTitle,
        descriptionPreview: descriptionPreview,
      });
    }

    function descriptionPreviewFromFull(text) {
      const oneLine = li.normalizeInline(text || '');
      if (!oneLine) return 'N/A';
      if (oneLine.length <= 100) return oneLine;
      return oneLine.slice(0, 100) + '…';
    }

    function clipDescriptionForStorage(multiline) {
      const t = (multiline || '').trim();
      if (!t) return '';
      if (t.length <= DESCRIPTION_MAX_STORE_CHARS) return t;
      return (
        t.slice(0, DESCRIPTION_MAX_STORE_CHARS).replace(/\\s+$/, '') +
        '\\n\\n[Description truncated by job-bot storage limit]'
      );
    }

    const LIST_RESULTS_URL = ${listResultsUrlLiteral};
    let listNavRecoveryCount = 0;

    const getScrollableResultsContainer = () => ct.getScrollableResultsContainer(document);
    const getClickableTargets = () => ct.getClickableTargets(document);

    const isFullJobViewPathname = () => {
      const path = window.location.pathname || '';
      if (!/^\\/jobs\\/view\\/\\d+/i.test(path)) return false;
      return !/^\\/jobs\\/search\\/?/i.test(path);
    };

    /** Returns to split-pane search URL when a click navigated to a standalone job view page. */
    async function recoverListResultsIfNeeded(jobIdForUrl) {
      if (!LIST_RESULTS_URL || !isFullJobViewPathname()) return false;
      try {
        const url = new URL(LIST_RESULTS_URL, window.location.origin);
        if (jobIdForUrl && /^\\d+$/.test(String(jobIdForUrl))) {
          url.searchParams.set('currentJobId', String(jobIdForUrl));
        }
        window.location.assign(url.toString());
        listNavRecoveryCount += 1;
        await sleep(2400);
        return true;
      } catch (e) {
        return false;
      }
    }

    const clickJobsNextPage = () => {
      const candidates = Array.from(document.querySelectorAll('button, a'));
      const nextBtn = candidates.find((el) => {
        const label = (el.getAttribute('aria-label') || '').toLowerCase();
        const text = li.normalizeInline(el.textContent || '').toLowerCase();
        return (
          label.includes('next') ||
          text === 'next' ||
          (label.includes('page') && label.includes('next'))
        );
      });
      if (!nextBtn) return false;
      if (nextBtn.disabled || nextBtn.getAttribute('aria-disabled') === 'true') return false;
      const ariaDisabled = nextBtn.getAttribute('aria-disabled');
      if (ariaDisabled === 'true') return false;
      nextBtn.click();
      return true;
    };

    try {
      if (LIST_RESULTS_URL && isFullJobViewPathname()) {
        await recoverListResultsIfNeeded(null);
      }

      for (let pageIndex = 1; pageIndex <= MAX_PAGES; pageIndex += 1) {
        {
          const st = scrapeStopped();
          if (st) return st;
        }

        await waitIfPaused();

        if (pageIndex > 1) {
          await waitMajor('Before Next page (' + (pageIndex - 1) + '→' + pageIndex + ')');
          {
            const st = scrapeStopped();
            if (st) return st;
          }
          const clickedNext = clickJobsNextPage();
          if (!clickedNext) break;
          await sleep(2600);
        }

        const clickedKeys = new Set();
        const maxRounds = 14;
        const listContainer = getScrollableResultsContainer();

        for (let round = 0; round < maxRounds; round += 1) {
          {
            const st = scrapeStopped();
            if (st) return st;
          }

          const targets = getClickableTargets();
          syncScrapeStats(targets.length, pageIndex);
          await waitIfPaused();

          for (const target of targets) {
            {
              const st = scrapeStopped();
              if (st) return st;
            }

            const href = target.getAttribute('href') || target.href || '';
            const componentKey = target.getAttribute('componentkey') || '';
            const key =
              href +
              '::' +
              componentKey +
              '::' +
              (target.textContent || '').trim().slice(0, 180);
            if (clickedKeys.has(key)) continue;
            clickedKeys.add(key);

            await waitIfPaused();

            target.scrollIntoView({ block: 'center', behavior: 'instant' });
            target.click();

            await sleep(2200);
            {
              const st = scrapeStopped();
              if (st) return st;
            }

            const preDetailsJobId = li.getCurrentJobId(window);
            if (await recoverListResultsIfNeeded(preDetailsJobId)) {
              {
                const st = scrapeStopped();
                if (st) return st;
              }
              continue;
            }

            const detailRoot = li.findJobDetailRoot(document);
            const about = detailRoot
              ? Array.from(detailRoot.querySelectorAll('h2')).find(
                  (h2) => li.normalizeInline(h2.textContent).toLowerCase() === 'about the job'
                )
              : Array.from(document.querySelectorAll('h2')).find(
                  (h2) => li.normalizeInline(h2.textContent).toLowerCase() === 'about the job'
                );
            if (about) {
              about.scrollIntoView({ block: 'center', behavior: 'instant' });
            }
            await sleep(400);
            const expanded = li.expandAboutSection(document, detailRoot);
            if (expanded) {
              await sleep(450);
            }

            const details = li.getCurrentDetails(document, window);
            const integrity = li.verifyCaptureIntegrity(details);
            if (!integrity.ok) {
              continue;
            }

            const jobId = details.externalId || li.extractJobIdFromHref(details.link);
            if (!jobId || !/^\\d+$/.test(String(jobId))) {
              continue;
            }
            const jobIdKey = String(jobId);
            if (seenJobIds.has(jobIdKey)) {
              continue;
            }
            seenJobIds.add(jobIdKey);
            const canonicalUrl = 'https://www.linkedin.com/jobs/view/' + jobId + '/';
            const rawDescription = details.description !== na ? details.description : '';
            const descriptionStored = rawDescription.trim()
              ? clipDescriptionForStorage(li.normalizeMultiline(rawDescription))
              : '';

            const salaryTextOut = details.salary !== na ? details.salary : undefined;

            const jobRecord = {
              externalId: String(jobId),
              url: canonicalUrl,
              title: details.title,
              company: details.company,
              location: details.location !== na ? details.location : undefined,
              salaryText: salaryTextOut,
              descriptionSnippet: descriptionStored || undefined,
              rawPayload: {
                link: details.link,
                pageIndex: pageIndex,
                round: round,
                extractionDiagnostics: details.extractionDiagnostics,
                listNavRecoveryCount: listNavRecoveryCount,
              },
            };
            collected.push(jobRecord);
            syncScrapeStats(targets.length, pageIndex);

            try {
              if (typeof __jobBotPostingPush === 'function') {
                __jobBotPostingPush(JSON.stringify(jobRecord));
              }
            } catch (streamErr) {}

            const preview = descriptionPreviewFromFull(details.description !== na ? details.description : '');
            await waitFine(details.title, preview);
            {
              const st = scrapeStopped();
              if (st) return st;
            }
            console.log('collected', collected.length);
            if (MAX_COLLECTED_JOBS !== null && collected.length >= MAX_COLLECTED_JOBS) {
              return { jobs: collected, aborted: aborted(), finishEarly: false };
            }
          }

          if (!listContainer) {
            window.scrollBy(0, Math.floor(window.innerHeight * 0.8));
            await sleep(400);
            continue;
          }
          const previousTop = listContainer.scrollTop;
          listContainer.scrollTop = Math.min(
            listContainer.scrollTop + Math.max(360, Math.floor(listContainer.clientHeight * 0.85)),
            listContainer.scrollHeight
          );
          await sleep(400);
          if (listContainer.scrollTop === previousTop) break;
        }
      }

      {
        const st = scrapeStopped();
        if (st) return st;
      }
      if (collected.length === 0) {
        return { error: 'No job posting details were found on this page.' };
      }
      return {
        jobs: collected,
        aborted: aborted(),
        finishEarly: false,
        listNavRecoveryCount: listNavRecoveryCount,
      };
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      if (msg.includes('JOB_BOT_SCRAPE_ABORT')) {
        return { aborted: true, jobs: collected };
      }
      return { error: msg || 'LinkedIn scrape failed' };
    }
  })()`;
}
