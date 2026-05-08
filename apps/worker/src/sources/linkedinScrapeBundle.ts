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

/**
 * Browser-side async scrape for LinkedIn jobs search results (split-pane list/detail).
 * Ported from oc-job-capture/popup.js executeLinkExtraction patterns + read-more expansion.
 *
 * @param maxPages How many results pages to walk (clamped by the caller, typically from `WORKER_LINKEDIN_PAGES`).
 * @param maxCollectedJobs Optional cap for collected postings; when undefined, collection is unbounded.
 */
export function buildLinkedInJobsListScrapeExpression(
  debugMode: LinkedInDebugSteps,
  maxPages: number,
  maxCollectedJobs: number | undefined
): string {
  const DEBUG = JSON.stringify(debugMode);
  const pages = Math.max(1, Math.floor(maxPages));
  const maxCollectedJobsLiteral =
    maxCollectedJobs === undefined ? 'null' : String(Math.max(1, Math.floor(maxCollectedJobs)));
  const INPAGE = loadLinkedInScrapeInpageSource();
  return `(async () => {
    ${INPAGE}
    const li = globalThis.__jobBotLiScrape;
    const DEBUG = ${DEBUG};
    const MAX_PAGES = ${pages};
    const MAX_COLLECTED_JOBS = ${maxCollectedJobsLiteral};
    const na = li.na;

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

    const getScrollableResultsContainer = () => {
      const selectors = [
        '.scaffold-layout__list',
        '.jobs-search-results-list',
        '.jobs-search__results-list',
        '.scaffold-layout__list-container',
        'ul[role="list"]',
      ];
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el && el.scrollHeight > el.clientHeight + 80) return el;
      }
      return null;
    };

    const getClickableTargets = () => {
      const targetSelectors = [
        'div[data-testid="lazy-column"] div[role="button"][componentkey]',
        'div[role="button"][componentkey]',
        '.scaffold-layout__list a[href*="/jobs/view/"]',
        '.jobs-search-results-list a[href*="/jobs/view/"]',
        '.jobs-search__results-list a[href*="/jobs/view/"]',
        '.scaffold-layout__list a[href*="currentJobId="]',
        '.jobs-search-results-list a[href*="currentJobId="]',
        '.jobs-search__results-list a[href*="currentJobId="]',
        'li[data-occludable-job-id] a',
        'li[data-job-id] a',
        'li[data-occludable-job-id]',
        'li[data-job-id]',
        '[data-occludable-job-id]',
        '[data-job-id]',
        'a.job-card-list__title',
        'a[data-control-name*="job"]',
      ];
      const seen = new Set();
      const targets = [];

      const toClickableNode = (node) => {
        if (!node) return null;
        if (node.matches && node.matches('a, button')) return node;
        const nestedAnchor = node.querySelector?.(
          'a[href*="/jobs/view/"], a[href*="currentJobId="], a[data-control-name*="job"], a'
        );
        if (nestedAnchor) return nestedAnchor;
        return node;
      };

      const isLikelyJobCardButton = (node) => {
        if (!node || !node.matches || !node.matches('div[role="button"][componentkey]')) return false;
        const componentKey = node.getAttribute('componentkey') || '';
        const hasUuidLikeComponentKey = /^[0-9a-f-]{24,}$/i.test(componentKey);
        const hasDismissButton = Boolean(node.querySelector('button[aria-label^="Dismiss "]'));
        const textLength = (node.textContent || '').trim().length;
        return hasUuidLikeComponentKey && hasDismissButton && textLength > 40;
      };

      for (const selector of targetSelectors) {
        for (const node of Array.from(document.querySelectorAll(selector))) {
          const clickableNode = toClickableNode(node);
          if (!clickableNode) continue;
          if (clickableNode.matches?.('div[role="button"][componentkey]') && !isLikelyJobCardButton(clickableNode)) {
            continue;
          }
          const href = clickableNode.getAttribute('href') || clickableNode.href || '';
          const nodeJobId =
            node.getAttribute?.('data-occludable-job-id') || node.getAttribute?.('data-job-id') || '';
          const componentKey = clickableNode.getAttribute?.('componentkey') || '';
          const key =
            selector +
            '::' +
            href +
            '::' +
            nodeJobId +
            '::' +
            componentKey +
            '::' +
            (clickableNode.textContent || '').trim().slice(0, 180);
          if (!seen.has(key)) {
            seen.add(key);
            targets.push(clickableNode);
          }
        }
      }
      return targets;
    };

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
      for (let pageIndex = 1; pageIndex <= MAX_PAGES; pageIndex += 1) {
        {
          const st = scrapeStopped();
          if (st) return st;
        }

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

            target.scrollIntoView({ block: 'center', behavior: 'instant' });
            target.click();

            await sleep(2200);
            {
              const st = scrapeStopped();
              if (st) return st;
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
            const snippetSource = details.description !== na ? details.description : '';
            const snippet =
              li.normalizeInline(snippetSource).length > 600
                ? li.normalizeInline(snippetSource).slice(0, 600) + '…'
                : li.normalizeInline(snippetSource);

            const salaryTextOut = details.salary !== na ? details.salary : undefined;

            const jobRecord = {
              externalId: String(jobId),
              url: canonicalUrl,
              title: details.title,
              company: details.company,
              location: details.location !== na ? details.location : undefined,
              salaryText: salaryTextOut,
              descriptionSnippet: snippet || undefined,
              rawPayload: {
                link: details.link,
                pageIndex: pageIndex,
                round: round,
                extractionDiagnostics: details.extractionDiagnostics,
              },
            };
            collected.push(jobRecord);

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
      return { jobs: collected, aborted: aborted(), finishEarly: false };
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      if (msg.includes('JOB_BOT_SCRAPE_ABORT')) {
        return { aborted: true, jobs: collected };
      }
      return { error: msg || 'LinkedIn scrape failed' };
    }
  })()`;
}
