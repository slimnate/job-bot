/**
 * Browser-side job list click targeting for LinkedIn split-pane search results.
 * Supports SDUI SearchResultsMainContent (dismiss card buttons) and legacy Ember
 * lists (job-card-container--clickable + data-occludable-job-id).
 */
(function initLinkedInScrapeClickTargets(global) {
  const JOB_DETAIL_PANEL_SELECTORS = [
    '.jobs-search__job-details',
    '.jobs-details__main-content',
    '[data-testid="job-details"]',
    '.scaffold-layout__detail',
    'div.jobs-details',
    '.jobs-search-two-pane__job-detail',
  ];

  /**
   * Resolves the left-hand job results list root (SDUI or legacy two-pane list).
   */
  function getJobsListRoot(doc) {
    const document = doc || global.document;
    const primary = [
      'div[data-component-type="LazyColumn"][componentkey="SearchResultsMainContent"]',
      'div[data-testid="lazy-column"][componentkey="SearchResultsMainContent"]',
    ];
    for (const selector of primary) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    const legacyContainers = [
      '.jobs-search-results-list',
      '.jobs-search-two-pane__results-list',
      '.jobs-search__results-list',
      '.scaffold-layout__list-container',
    ];
    for (const selector of legacyContainers) {
      const el = document.querySelector(selector);
      if (el && el.querySelector('li[data-occludable-job-id], li[data-job-id], .job-card-container')) {
        return el;
      }
    }
    for (const el of Array.from(document.querySelectorAll('.scaffold-layout__list'))) {
      if (el.querySelector('li[data-occludable-job-id], li[data-job-id], .job-card-container')) {
        return el;
      }
    }
    const legacy = [
      '.scaffold-layout__list',
      '.jobs-search-results-list',
      '.jobs-search__results-list',
    ];
    for (const selector of legacy) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  /**
   * True when `node` sits under the right-hand job detail column.
   */
  function isInsideJobDetailPanel(node, doc) {
    if (!node) return false;
    const document = doc || global.document;
    for (const selector of JOB_DETAIL_PANEL_SELECTORS) {
      const panel = document.querySelector(selector);
      if (panel && panel.contains(node)) return true;
    }
    let el = node;
    for (let i = 0; i < 24 && el; i += 1) {
      const ck = el.getAttribute?.('componentkey') || '';
      if (typeof ck === 'string' && ck.indexOf('JobDetails_') === 0) return true;
      el = el.parentElement;
    }
    return false;
  }

  /**
   * True when this element must not be clicked (detail pane or JobDetails_* subtree).
   */
  function isExcludedClickTarget(node, doc) {
    if (!node) return true;
    const componentKey = node.getAttribute?.('componentkey') || '';
    if (typeof componentKey === 'string' && componentKey.indexOf('JobDetails_') === 0) {
      return true;
    }
    if (node.matches?.('a[href*="/jobs/view/"]') && isInsideJobDetailPanel(node, doc)) {
      return true;
    }
    return isInsideJobDetailPanel(node, doc);
  }

  /**
   * Dismissible SDUI job card in SearchResultsMainContent.
   */
  function isLikelyJobCardButton(node) {
    if (!node || !node.matches || !node.matches('div[role="button"][componentkey]')) return false;
    const componentKey = node.getAttribute('componentkey') || '';
    const hasUuidLikeComponentKey = /^[0-9a-f-]{24,}$/i.test(componentKey);
    const hasDismissButton = Boolean(node.querySelector('button[aria-label^="Dismiss "]'));
    const textLength = (node.textContent || '').trim().length;
    return hasUuidLikeComponentKey && hasDismissButton && textLength > 40;
  }

  /**
   * Legacy two-pane card shell (example-search.html); click container, not title link.
   */
  function findLegacyJobCardClickTarget(node) {
    if (!node || !node.querySelector) return null;
    const container = node.querySelector(
      '.job-card-container--clickable, .job-card-container[data-job-id], div.job-card-container'
    );
    if (container && container.matches?.('.job-card-container')) {
      return container;
    }
    if (node.matches?.('.job-card-container--clickable, .job-card-container[data-job-id], .job-card-container')) {
      return node;
    }
    return null;
  }

  /**
   * Prefer list card shell / SDUI button over nested title anchor (avoids full /jobs/view/ navigation).
   */
  function toClickableNode(node) {
    if (!node) return null;

    const legacyCard = findLegacyJobCardClickTarget(node);
    if (legacyCard) return legacyCard;

    if (node.matches && node.matches('div[role="button"][componentkey]')) {
      if (isLikelyJobCardButton(node)) return node;
    }
    const cardButton = node.querySelector?.('div[role="button"][componentkey]');
    if (cardButton && isLikelyJobCardButton(cardButton)) return cardButton;

    if (node.matches?.('a[href*="/jobs/view/"], a[href*="currentJobId="]')) {
      const anchorCard = findLegacyJobCardClickTarget(node.parentElement || node);
      if (anchorCard) return anchorCard;
    }

    if (node.matches && node.matches('a, button')) return node;
    const nestedAnchor = node.querySelector?.(
      'a[href*="/jobs/view/"], a[href*="currentJobId="], a[data-control-name*="job"], a.job-card-list__title--link, a.job-card-container__link'
    );
    if (nestedAnchor) {
      const anchorCard = findLegacyJobCardClickTarget(nestedAnchor.parentElement || node);
      if (anchorCard) return anchorCard;
      return nestedAnchor;
    }
    return node;
  }

  function isAllowedClickableNode(clickableNode) {
    if (!clickableNode) return false;
    if (clickableNode.matches?.('div[role="button"][componentkey]')) {
      return isLikelyJobCardButton(clickableNode);
    }
    if (clickableNode.matches?.('.job-card-container--clickable, .job-card-container[data-job-id], .job-card-container')) {
      return true;
    }
    if (clickableNode.matches?.('li[data-occludable-job-id], li[data-job-id]')) {
      return Boolean(findLegacyJobCardClickTarget(clickableNode));
    }
    if (clickableNode.matches?.('a[href*="/jobs/view/"], a[href*="currentJobId="]')) {
      return false;
    }
    return true;
  }

  function targetDedupeKey(selector, node, clickableNode) {
    const href = clickableNode.getAttribute('href') || clickableNode.href || '';
    const nodeJobId =
      node.getAttribute?.('data-occludable-job-id') ||
      node.getAttribute?.('data-job-id') ||
      clickableNode.getAttribute?.('data-job-id') ||
      '';
    const componentKey = clickableNode.getAttribute?.('componentkey') || '';
    return (
      selector +
      '::' +
      href +
      '::' +
      nodeJobId +
      '::' +
      componentKey +
      '::' +
      (clickableNode.textContent || '').trim().slice(0, 180)
    );
  }

  function pushTarget(targets, seen, selector, node, clickableNode, listRoot, doc) {
    if (!clickableNode || !listRoot || !listRoot.contains(clickableNode)) return;
    if (isExcludedClickTarget(clickableNode, doc)) return;
    if (!isAllowedClickableNode(clickableNode)) return;
    const key = targetDedupeKey(selector, node, clickableNode);
    if (seen.has(key)) return;
    seen.add(key);
    targets.push(clickableNode);
  }

  /**
   * Ordered click targets for the current results list.
   */
  function getClickableTargets(doc) {
    const document = doc || global.document;
    const listRoot = getJobsListRoot(document);
    const seen = new Set();
    const targets = [];

    if (listRoot) {
      const scopedSelectors = [
        'div[role="button"][componentkey]',
        'div.job-card-container--clickable',
        'div.job-card-container[data-job-id]',
        'li[data-occludable-job-id]',
        'li[data-job-id]',
        'a[href*="currentJobId="]',
        'a[data-control-name*="job"]',
      ];
      for (const selector of scopedSelectors) {
        for (const node of Array.from(listRoot.querySelectorAll(selector))) {
          const clickableNode = toClickableNode(node);
          pushTarget(targets, seen, selector, node, clickableNode, listRoot, document);
        }
      }
      return targets;
    }

    const legacySelectors = [
      'div[data-testid="lazy-column"] div[role="button"][componentkey]',
      'div.job-card-container--clickable',
      'li[data-occludable-job-id]',
      'li[data-job-id]',
      'div[role="button"][componentkey]',
    ];
    for (const selector of legacySelectors) {
      for (const node of Array.from(document.querySelectorAll(selector))) {
        const clickableNode = toClickableNode(node);
        if (!clickableNode || isExcludedClickTarget(clickableNode, document)) continue;
        if (!isAllowedClickableNode(clickableNode)) continue;
        const key = targetDedupeKey(selector, node, clickableNode);
        if (!seen.has(key)) {
          seen.add(key);
          targets.push(clickableNode);
        }
      }
    }
    return targets;
  }

  /**
   * Scroll container for infinite list loading.
   */
  function getScrollableResultsContainer(doc) {
    const document = doc || global.document;
    const listRoot = getJobsListRoot(document);
    const candidates = [];
    if (listRoot) candidates.push(listRoot);
    candidates.push(
      document.querySelector('.jobs-search-results-list'),
      document.querySelector('.scaffold-layout__list'),
      document.querySelector('.jobs-search__results-list'),
      document.querySelector('.scaffold-layout__list-container'),
      document.querySelector('ul[role="list"]')
    );
    for (const el of candidates) {
      if (el && el.scrollHeight > el.clientHeight + 80) return el;
    }
    return null;
  }

  const api = {
    getJobsListRoot,
    isInsideJobDetailPanel,
    isExcludedClickTarget,
    isLikelyJobCardButton,
    findLegacyJobCardClickTarget,
    toClickableNode,
    getClickableTargets,
    getScrollableResultsContainer,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.__jobBotLiClickTargets = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : {});
