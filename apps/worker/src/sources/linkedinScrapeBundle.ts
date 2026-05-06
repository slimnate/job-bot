import type { LinkedInDebugSteps } from './linkedinDebugSteps.js';

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
  return `(async () => {
    const DEBUG = ${DEBUG};
    const MAX_PAGES = ${pages};
    const MAX_COLLECTED_JOBS = ${maxCollectedJobsLiteral};
    const na = 'N/A';

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const normalizeInline = (value) => {
      if (!value) return '';
      return String(value).replace(/\\s+/g, ' ').trim();
    };

    const normalizeMultiline = (value) => {
      if (!value) return '';
      return String(value)
        .replace(/\\r/g, '')
        .split('\\n')
        .map((line) => normalizeInline(line))
        .filter(Boolean)
        .join('\\n');
    };

    const aborted = () => Boolean(window.__jobBotScrape && window.__jobBotScrape.abortRequested);
    const finishEarly = () =>
      Boolean(window.__jobBotScrape && window.__jobBotScrape.finishEarlyRequested);

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
      const oneLine = normalizeInline(text || '');
      if (!oneLine) return 'N/A';
      if (oneLine.length <= 100) return oneLine;
      return oneLine.slice(0, 100) + '…';
    }

    const getCurrentJobId = () => {
      const searchParams = new URLSearchParams(window.location.search);
      const fromQuery = searchParams.get('currentJobId');
      if (fromQuery && /^\\d+$/.test(fromQuery)) return fromQuery;
      const pathMatch = window.location.pathname.match(/\\/jobs\\/view\\/(\\d+)/);
      if (pathMatch) return pathMatch[1];
      return '';
    };

    const extractJobIdFromHref = (href) => {
      if (!href) return '';
      const match = href.match(/\\/jobs\\/view\\/(\\d+)/);
      return match ? match[1] : '';
    };

    const buildCanonicalJobLink = (href, knownJobId) => {
      const id = knownJobId || extractJobIdFromHref(href);
      if (id) return 'https://www.linkedin.com/jobs/view/' + id + '/';
      return href || '';
    };

    const expandAboutSection = () => {
      const aboutHeading = Array.from(document.querySelectorAll('h2')).find(
        (h2) => normalizeInline(h2.textContent).toLowerCase() === 'about the job'
      );
      const scope = aboutHeading
        ? aboutHeading.closest('div[componentkey], section, article, div') || document.body
        : document.body;
      scope.scrollIntoView({ block: 'center', behavior: 'instant' });
      const buttons = Array.from(scope.querySelectorAll('button, a[role="button"], span[role="button"]'));
      const moreBtn = buttons.find((b) => {
        const t = normalizeInline(b.textContent || '').toLowerCase();
        return (
          t.includes('show more') ||
          t.includes('read more') ||
          (t.length <= 12 && t.includes('more'))
        );
      });
      if (moreBtn && moreBtn instanceof HTMLElement && moreBtn.offsetParent !== null) {
        moreBtn.click();
        return true;
      }
      return false;
    };

    const getTitleAndLink = () => {
      const currentJobId = getCurrentJobId();
      const anchors = Array.from(document.querySelectorAll('a[href*="/jobs/view/"]')).filter((a) => {
        const text = normalizeInline(a.textContent);
        return Boolean(text);
      });
      let chosenAnchor = null;
      if (currentJobId) {
        chosenAnchor =
          anchors.find((a) => {
            const href = a.getAttribute('href') || '';
            return href.includes('/jobs/view/' + currentJobId);
          }) || null;
      }
      if (!chosenAnchor && anchors.length > 0) {
        chosenAnchor = anchors[0];
      }
      const titleFromAnchor = normalizeInline(chosenAnchor?.textContent || '');
      const linkFromAnchor = chosenAnchor?.href || '';
      const titleTagText = normalizeInline(document.title.split('|')[0] || '');
      return {
        title: titleFromAnchor || titleTagText || na,
        link: buildCanonicalJobLink(linkFromAnchor, currentJobId) || window.location.href,
      };
    };

    const getCompany = () => {
      const companyAnchor = document.querySelector('[aria-label^="Company,"] a[href*="/company/"]');
      if (companyAnchor) {
        const text = normalizeInline(companyAnchor.textContent);
        if (text) return text;
      }
      const companyContainer = document.querySelector('[aria-label^="Company,"]');
      if (companyContainer) {
        const label = companyContainer.getAttribute('aria-label') || '';
        const parsed = normalizeInline(label.replace(/^Company,\\s*/i, '').replace(/\\.$/, ''));
        if (parsed) return parsed;
      }
      const titleParts = document.title.split('|').map((part) => normalizeInline(part)).filter(Boolean);
      if (titleParts.length >= 2) return titleParts[1];
      return na;
    };

    const getDescription = () => {
      const descriptionSelectors = [
        'div[componentkey^="JobDetails_AboutTheJob_"] [data-testid="expandable-text-box"]',
        'div[data-sdui-component="com.linkedin.sdui.generated.jobseeker.dsl.impl.aboutTheJob"] [data-testid="expandable-text-box"]',
      ];
      for (const selector of descriptionSelectors) {
        const node = document.querySelector(selector);
        const text = normalizeMultiline(node?.innerText || node?.textContent || '');
        if (text) return text;
      }
      const aboutHeading = Array.from(document.querySelectorAll('h2')).find(
        (h2) => normalizeInline(h2.textContent).toLowerCase() === 'about the job'
      );
      if (aboutHeading) {
        const container =
          aboutHeading.closest('div[componentkey], div[data-sdui-component], section, div') || aboutHeading.parentElement;
        const text = normalizeMultiline(container?.innerText || '');
        if (text) return text;
      }
      return na;
    };

    const getLocation = (titleAnchor) => {
      const isNoise = (segment) => {
        const lower = segment.toLowerCase();
        return (
          lower.includes('reposted') ||
          lower.includes('ago') ||
          lower.includes('people clicked apply') ||
          lower.includes('people applied') ||
          lower.includes('promoted by') ||
          lower.includes('responses managed')
        );
      };
      if (titleAnchor) {
        const candidates = [];
        let node = titleAnchor.parentElement;
        for (let i = 0; node && i < 5; i += 1) {
          candidates.push(...Array.from(node.querySelectorAll('p')));
          node = node.parentElement;
        }
        for (const paragraph of candidates) {
          const line = normalizeInline(paragraph.innerText || paragraph.textContent || '');
          if (!line || !line.includes('·')) continue;
          const parts = line
            .split('·')
            .map((part) => normalizeInline(part))
            .filter(Boolean)
            .filter((part) => !isNoise(part));
          if (parts.length > 0) return parts[0];
        }
      }
      const bodyText = normalizeInline(document.body?.innerText || '');
      const locationPatterns = [
        /\\b[A-Z][a-z]+(?:\\s[A-Z][a-z]+)*,\\s?[A-Z]{2}(?:\\s*\\([^)]+\\))?\\b/,
        /\\b[A-Z][A-Za-z]+(?:\\s[A-Z][A-Za-z]+)*\\s+\\(Remote\\)\\b/,
        /\\bRemote\\b/i,
      ];
      for (const pattern of locationPatterns) {
        const match = bodyText.match(pattern);
        if (match) return normalizeInline(match[0]);
      }
      return na;
    };

    /**
     * Extracts a short salary/comp range string from the job description or compact UI chips.
     * Avoids matching on large layout nodes: span/p/div ancestors often include a salary substring
     * plus the entire split-pane DOM text, so we only accept short strings and pick the shortest.
     */
    const getSalary = (descriptionText) => {
      const joinedDescription = normalizeInline(descriptionText);
      const salaryPatterns = [
        /Pay Range:\\s*:?\\s*:?[^\\$]{0,40}\\$\\s?\\d{1,3}(?:,\\d{3})*(?:\\s*USD)?\\s*-\\s*\\$\\s?\\d{1,3}(?:,\\d{3})*(?:\\s*USD)?/i,
        /\\$\\s?\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?(?:\\s*[A-Za-z]{2,4})?\\s*-\\s*\\$\\s?\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?(?:\\s*[A-Za-z]{2,4})?/i,
        /\\$\\s?\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?\\s*-\\s*\\$\\s?\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?\\s*(?:annually|yearly|per year|\\/yr|\\/year)?/i,
        /\\$\\s?\\d{2,3}K\\s*-\\s*\\$\\s?\\d{2,3}K(?:\\s*\\/\\s*\\w+)?/i,
        /base salary range[^.]{0,160}\\$\\s?\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?[^.]{0,80}\\$\\s?\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?/i,
      ];
      for (const pattern of salaryPatterns) {
        const match = joinedDescription.match(pattern);
        if (match) return normalizeInline(match[0]);
      }
      const maxChipLen = 160;
      const looksLikeSalaryChip = (text) =>
        /\\$\\s?\\d{2,3}K\\s*\\/\\s*\\w+/i.test(text) ||
        /\\$\\s?\\d{1,3}(?:,\\d{3})*\\s*-\\s*\\$\\s?\\d{1,3}(?:,\\d{3})/.test(text);
      const chipCandidates = Array.from(document.querySelectorAll('span, p, div'))
        .map((node) => normalizeInline(node.textContent || ''))
        .filter((text) => text.length > 0 && text.length <= maxChipLen && looksLikeSalaryChip(text));
      if (chipCandidates.length === 0) return na;
      chipCandidates.sort((a, b) => a.length - b.length);
      return chipCandidates[0];
    };

    const getCurrentDetails = () => {
      const currentJobId = getCurrentJobId();
      const anchorCandidates = Array.from(document.querySelectorAll('a[href*="/jobs/view/"]'));
      const titleAnchor =
        anchorCandidates.find((a) => (a.getAttribute('href') || '').includes('/jobs/view/' + currentJobId)) ||
        anchorCandidates[0] ||
        null;
      const titleLink = getTitleAndLink();
      const company = getCompany();
      const description = getDescription();
      const salary = getSalary(description);
      const location = getLocation(titleAnchor);
      const idFromLink = extractJobIdFromHref(titleLink.link);
      return {
        title: titleLink.title || na,
        company: company || na,
        link: titleLink.link || na,
        salary: salary || na,
        location: location || na,
        description: description || na,
        externalId: idFromLink || currentJobId || '',
      };
    };

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
        const text = normalizeInline(el.textContent || '').toLowerCase();
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

    const collected = [];
    const seenJobIds = new Set();

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

            const about = Array.from(document.querySelectorAll('h2')).find(
              (h2) => normalizeInline(h2.textContent).toLowerCase() === 'about the job'
            );
            if (about) {
              about.scrollIntoView({ block: 'center', behavior: 'instant' });
            }
            await sleep(400);
            const expanded = expandAboutSection();
            if (expanded) {
              await sleep(450);
            }

            const details = getCurrentDetails();
            const jobId = details.externalId || extractJobIdFromHref(details.link);
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
              normalizeInline(snippetSource).length > 600
                ? normalizeInline(snippetSource).slice(0, 600) + '…'
                : normalizeInline(snippetSource);

            const jobRecord = {
              externalId: String(jobId),
              url: canonicalUrl,
              title: details.title,
              company: details.company,
              location: details.location !== na ? details.location : undefined,
              salaryText: details.salary !== na ? details.salary : undefined,
              descriptionSnippet: snippet || undefined,
              rawPayload: {
                link: details.link,
                pageIndex: pageIndex,
                round: round,
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
