/**
 * LinkedIn jobs list/detail scrape helpers — runs in the browser via CDP `evaluate`.
 * Scoped extraction prevents salary and metadata from bleeding across list cards.
 *
 * Exposes `globalThis.__jobBotLiScrape` for the async driver in `linkedinScrapeBundle.ts`.
 */
(function initJobBotLiScrape(globalRef) {
  const na = 'N/A';

  function normalizeInline(value) {
    if (!value) return '';
    return String(value).replace(/\s+/g, ' ').trim();
  }

  function normalizeMultiline(value) {
    if (!value) return '';
    return String(value)
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => normalizeInline(line))
      .filter(Boolean)
      .join('\n');
  }

  function getCurrentJobId(win) {
    const searchParams = new URLSearchParams(win.location.search);
    const fromQuery = searchParams.get('currentJobId');
    if (fromQuery && /^\d+$/.test(fromQuery)) return fromQuery;
    const pathMatch = win.location.pathname.match(/\/jobs\/view\/(\d+)/);
    if (pathMatch) return pathMatch[1];
    return '';
  }

  function extractJobIdFromHref(href) {
    if (!href) return '';
    const match = href.match(/\/jobs\/view\/(\d+)/);
    return match ? match[1] : '';
  }

  function buildCanonicalJobLink(href, knownJobId) {
    const id = knownJobId || extractJobIdFromHref(href);
    if (id) return 'https://www.linkedin.com/jobs/view/' + id + '/';
    return href || '';
  }

  /**
   * Finds the list-row / card root for a job id (sidebar list), for scoped chips (salary, location).
   */
  function findJobListCardRoot(doc, jobId) {
    if (!jobId) return null;
    const needle = '/jobs/view/' + jobId;
    const anchors = Array.from(doc.querySelectorAll('a[href*="/jobs/view/"]'));
    const match = anchors.find((a) => (a.getAttribute('href') || a.href || '').includes(needle));
    if (!match) return null;
    let el = match;
    for (let i = 0; i < 14 && el; i += 1) {
      if (
        el.matches &&
        (el.matches('li[data-occludable-job-id]') ||
          el.matches('li[data-job-id]') ||
          el.matches('[data-occludable-job-id]') ||
          el.matches('[data-job-id]') ||
          el.matches('.jobs-search-results__list-item') ||
          el.matches('div[role="listitem"]') ||
          el.matches('.job-card-container') ||
          el.matches('li.jobs-search-results__list-item'))
      ) {
        return el;
      }
      el = el.parentElement;
    }
    el = match.parentElement;
    for (let j = 0; j < 8 && el; j += 1) {
      const len = (el.textContent || '').length;
      if (len > 0 && len < 1200) return el;
      el = el.parentElement;
    }
    return match.parentElement;
  }

  /**
   * Resolves the main job details column (right pane). Used to scope company/description/salary-from-body.
   */
  function findJobDetailRoot(doc) {
    const selectors = [
      '.jobs-search__job-details',
      '.jobs-details__main-content',
      '.job-details-jobs-unified-top-card',
      '[data-testid="job-details"]',
      '.scaffold-layout__detail',
      'div.jobs-details',
    ];
    for (const sel of selectors) {
      const el = doc.querySelector(sel);
      if (!el) continue;
      const probe = (el.innerText || el.textContent || '').trim();
      if (probe.length > 80) return el;
    }
    const aboutHeading = Array.from(doc.querySelectorAll('h2')).find(
      (h2) => normalizeInline(h2.textContent).toLowerCase() === 'about the job'
    );
    if (aboutHeading) {
      const panel =
        aboutHeading.closest(
          'div[class*="jobs-details"], div[class*="job-details"], article, main, section, div[componentkey]'
        ) || aboutHeading.parentElement?.parentElement;
      if (panel) return panel;
    }
    return null;
  }

  /**
   * True when the detail subtree plausibly belongs to `jobId` (href, data attrs, or text).
   */
  function detailPanelLikelyForJob(detailRoot, jobId) {
    if (!detailRoot || !jobId) return false;
    const html = detailRoot.innerHTML || '';
    if (html.includes('/jobs/view/' + jobId) || html.includes('currentJobId=' + jobId)) return true;
    if (detailRoot.querySelector('[href*="/jobs/view/' + jobId + '"]')) return true;
    if (detailRoot.querySelector('[data-job-id="' + jobId + '"]')) return true;
    return false;
  }

  function getTitleAnchorInCard(doc, cardRoot, jobId) {
    if (!cardRoot || !jobId) return null;
    const needle = '/jobs/view/' + jobId;
    return (
      Array.from(cardRoot.querySelectorAll('a[href*="/jobs/view/"]')).find((a) =>
        (a.getAttribute('href') || a.href || '').includes(needle)
      ) || null
    );
  }

  function getTitleAndLink(doc, win, cardRoot, jobId) {
    const currentJobId = jobId || getCurrentJobId(win);
    let chosenAnchor = getTitleAnchorInCard(doc, cardRoot, currentJobId);
    if (!chosenAnchor && currentJobId) {
      const anchors = Array.from(doc.querySelectorAll('a[href*="/jobs/view/"]')).filter((a) => {
        const text = normalizeInline(a.textContent);
        return Boolean(text);
      });
      chosenAnchor =
        anchors.find((a) => {
          const href = a.getAttribute('href') || '';
          return href.includes('/jobs/view/' + currentJobId);
        }) || null;
    }
    if (!chosenAnchor && cardRoot) {
      chosenAnchor = cardRoot.querySelector('a[href*="/jobs/view/"]');
    }
    const titleFromAnchor = normalizeInline(chosenAnchor?.textContent || '');
    const linkFromAnchor = chosenAnchor?.href || '';
    const titleTagText = normalizeInline(win.document.title.split('|')[0] || '');
    return {
      title: titleFromAnchor || titleTagText || na,
      link: buildCanonicalJobLink(linkFromAnchor, currentJobId) || win.location.href,
    };
  }

  function getCompany(doc, detailRoot, cardRoot) {
    const roots = [detailRoot, cardRoot].filter(Boolean);
    for (const root of roots) {
      const companyAnchor = root.querySelector?.('[aria-label^="Company,"] a[href*="/company/"]');
      if (companyAnchor) {
        const text = normalizeInline(companyAnchor.textContent);
        if (text) return text;
      }
      const companyContainer = root.querySelector?.('[aria-label^="Company,"]');
      if (companyContainer) {
        const label = companyContainer.getAttribute('aria-label') || '';
        const parsed = normalizeInline(label.replace(/^Company,\s*/i, '').replace(/\.$/, ''));
        if (parsed) return parsed;
      }
    }
    const titleParts = doc.title.split('|').map((part) => normalizeInline(part)).filter(Boolean);
    if (titleParts.length >= 2) return titleParts[1];
    return na;
  }

  function getDescription(doc, detailRoot) {
    const searchRoots = detailRoot ? [detailRoot, doc] : [doc];
    const descriptionSelectors = [
      'div[componentkey^="JobDetails_AboutTheJob_"] [data-testid="expandable-text-box"]',
      'div[data-sdui-component="com.linkedin.sdui.generated.jobseeker.dsl.impl.aboutTheJob"] [data-testid="expandable-text-box"]',
      '[data-testid="expandable-text-box"]',
    ];
    for (const root of searchRoots) {
      for (const selector of descriptionSelectors) {
        const node = root.querySelector(selector);
        const text = normalizeMultiline(node?.innerText || node?.textContent || '');
        if (text) return text;
      }
    }
    const scope = detailRoot || doc;
    const aboutHeading = Array.from(scope.querySelectorAll('h2')).find(
      (h2) => normalizeInline(h2.textContent).toLowerCase() === 'about the job'
    );
    if (aboutHeading) {
      const container =
        aboutHeading.closest('div[componentkey], div[data-sdui-component], section, div') ||
        aboutHeading.parentElement;
      const text = normalizeMultiline(container?.innerText || container?.textContent || '');
      if (text) return text;
    }
    return na;
  }

  function getLocationFromCardOrDetail(titleAnchor, cardRoot, detailRoot) {
    const isNoise = (segment) => {
      const lower = segment.toLowerCase();
      return (
        lower.includes('reposted') ||
        lower.includes('ago') ||
        lower.includes('people clicked apply') ||
        lower.includes('people applied') ||
        lower.includes('promoted by') ||
        lower.includes('responses managed') ||
        lower.includes('viewed') ||
        lower.includes('posted')
      );
    };
    const tryParagraphsNear = (anchor) => {
      if (!anchor) return null;
      const candidates = [];
      let node = anchor.parentElement;
      for (let i = 0; node && i < 6; i += 1) {
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
      return null;
    };

    const fromCard = tryParagraphsNear(titleAnchor);
    if (fromCard) return fromCard;

    if (cardRoot) {
      const lines = normalizeInline(cardRoot.innerText || '')
        .split('·')
        .map((p) => normalizeInline(p))
        .filter(Boolean);
      for (const part of lines) {
        if (!isNoise(part) && (/\bremote\b/i.test(part) || /,\s*[A-Z]{2}\b/.test(part))) {
          return part;
        }
      }
    }

    if (detailRoot) {
      const detailText = normalizeInline(detailRoot.innerText || '');
      const locationPatterns = [
        /\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*,\s?[A-Z]{2}(?:\s*\([^)]+\))?\b/,
        /\b[A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+)*\s+\(Remote\)\b/,
        /\bRemote\b/i,
      ];
      for (const pattern of locationPatterns) {
        const match = detailText.match(pattern);
        if (match) return normalizeInline(match[0]);
      }
    }

    return na;
  }

  /**
   * Salary from free text (description / legal pay disclosure). Returns null if none.
   */
  function findSalaryInText(descriptionText) {
    const joined = normalizeInline(descriptionText);
    if (!joined) return null;
    const salaryPatterns = [
      /Pay Range:\s*:?\s*:?[^\$]{0,40}\$\s?\d{1,3}(?:,\d{3})*(?:\s*USD)?\s*-\s*\$\s?\d{1,3}(?:,\d{3})*(?:\s*USD)?/i,
      /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*-\s*\$\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*(?:annually|yearly|per year|\/yr|\/year)/i,
      /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:\s*[A-Za-z]{2,4})?\s*-\s*\$\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:\s*[A-Za-z]{2,4})?/i,
      /\$\s?\d{2,3}K\s*-\s*\$\s?\d{2,3}K(?:\s*\/\s*\w+)?/i,
      /base salary range[^.]{0,160}\$\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?[^.]{0,80}\$\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?/i,
    ];
    for (const pattern of salaryPatterns) {
      const match = joined.match(pattern);
      if (match) {
        const s = normalizeInline(match[0]);
        if (s.length > 0 && s.length <= 140) return s;
      }
    }
    return null;
  }

  function looksLikeSalaryChip(text) {
    return (
      /\$\s?\d{2,3}K\s*\/\s*\w+/i.test(text) ||
      /\$\s?\d{1,3}(?:,\d{3})*\s*-\s*\$\s?\d{1,3}(?:,\d{3})/.test(text) ||
      /\$\s?\d{2,3}K\s*-\s*\$\s?\d{2,3}K/i.test(text)
    );
  }

  /**
   * Compact salary chip lines only inside `cardRoot` (never whole document).
   */
  function findSalaryChipInRoot(cardRoot) {
    if (!cardRoot) return null;
    const maxChipLen = 160;
    const chipCandidates = [];
    cardRoot.querySelectorAll('span, p, div, li').forEach((node) => {
      const text = normalizeInline(node.textContent || '');
      if (text.length > 0 && text.length <= maxChipLen && looksLikeSalaryChip(text)) {
        chipCandidates.push(text);
      }
    });
    if (chipCandidates.length === 0) return null;
    chipCandidates.sort((a, b) => a.length - b.length);
    return chipCandidates[0];
  }

  /**
   * Prefers description/legal text, then list-card chip. No global DOM scan.
   */
  function getSalaryScoped(descriptionText, cardRoot) {
    const fromDetail = findSalaryInText(descriptionText);
    if (fromDetail) return { text: fromDetail, source: 'detail' };
    const fromCard = findSalaryChipInRoot(cardRoot);
    if (fromCard) return { text: fromCard, source: 'card' };
    return { text: null, source: null };
  }

  function expandAboutSection(doc, detailRoot) {
    const scope =
      detailRoot ||
      Array.from(doc.querySelectorAll('h2')).find(
        (h2) => normalizeInline(h2.textContent).toLowerCase() === 'about the job'
      )?.closest('div[componentkey], section, article, div') ||
      doc.body;
    if (!scope) return false;
    scope.scrollIntoView({ block: 'center', behavior: 'instant' });
    const buttons = Array.from(scope.querySelectorAll('button, a[role="button"], span[role="button"]'));
    const moreBtn = buttons.find((b) => {
      const t = normalizeInline(b.textContent || '').toLowerCase();
      return t.includes('show more') || t.includes('read more') || (t.length <= 12 && t.includes('more'));
    });
    if (moreBtn && moreBtn instanceof HTMLElement && moreBtn.offsetParent !== null) {
      moreBtn.click();
      return true;
    }
    return false;
  }

  /**
   * @returns {object} details + extractionDiagnostics
   */
  function getCurrentDetails(doc, win) {
    const currentJobId = getCurrentJobId(win);
    const cardRoot = findJobListCardRoot(doc, currentJobId);
    const detailRoot = findJobDetailRoot(doc);
    const titleAnchor = getTitleAnchorInCard(doc, cardRoot, currentJobId);

    const titleLink = getTitleAndLink(doc, win, cardRoot, currentJobId);
    const company = getCompany(doc, detailRoot, cardRoot);
    const description = getDescription(doc, detailRoot);
    const location = getLocationFromCardOrDetail(titleAnchor, cardRoot, detailRoot);

    const salaryResult = getSalaryScoped(description === na ? '' : description, cardRoot);
    const salaryText = salaryResult.text;

    const idFromLink = extractJobIdFromHref(titleLink.link);
    const externalId = idFromLink || currentJobId || '';

    const detailLikely = detailRoot ? detailPanelLikelyForJob(detailRoot, externalId) : false;
    const hasCard = Boolean(cardRoot);

    return {
      title: titleLink.title || na,
      company: company || na,
      link: titleLink.link || na,
      salary: salaryText ? normalizeInline(salaryText) : na,
      location: location || na,
      description: description || na,
      externalId,
      extractionDiagnostics: {
        salarySource: salaryResult.source,
        hasListCard: hasCard,
        hasDetailRoot: Boolean(detailRoot),
        detailLikelyForJob: detailLikely,
        currentJobIdFromUrl: currentJobId || null,
      },
    };
  }

  function verifyCaptureIntegrity(details) {
    const id = String(details.externalId || '').trim();
    if (!id || !/^\d+$/.test(id)) return { ok: false, reason: 'bad_id' };
    const d = details.extractionDiagnostics || {};
    if (d.currentJobIdFromUrl && d.currentJobIdFromUrl !== id) {
      return { ok: false, reason: 'url_job_mismatch' };
    }
    if (!d.hasListCard && !d.hasDetailRoot) return { ok: false, reason: 'no_scope' };
    return { ok: true, reason: null };
  }

  globalRef.__jobBotLiScrape = {
    na,
    normalizeInline,
    normalizeMultiline,
    getCurrentJobId,
    extractJobIdFromHref,
    buildCanonicalJobLink,
    findJobListCardRoot,
    findJobDetailRoot,
    detailPanelLikelyForJob,
    getTitleAndLink,
    getCompany,
    getDescription,
    getLocationFromCardOrDetail,
    findSalaryInText,
    findSalaryChipInRoot,
    getSalaryScoped,
    expandAboutSection,
    getCurrentDetails,
    verifyCaptureIntegrity,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
