/**
 * In-page helpers to find and submit the LinkedIn /jobs/ search box (SDUI typeahead + legacy fallbacks).
 * Loaded into CDP evaluate strings and exercised in jsdom tests.
 */
(function initLinkedInSearchUi(global) {
  /**
   * Selectors for the jobs hub keyword/typeahead input (see ex/example-jobs.html).
   * Order: SDUI jobSearchBox first, then legacy Ember search fields.
   */
  const KEYWORD_INPUT_SELECTORS = [
    'input[data-testid="typeahead-input"][componentkey="jobSearchBox"]',
    'div[data-sdui-component*="jobSearchBox"] input[data-testid="typeahead-input"]',
    'div[componentkey="navBarJobTypeaheadComponentRef"] input[data-testid="typeahead-input"]',
    'div[role="search"] input[data-testid="typeahead-input"]',
    'input[componentkey="jobSearchBox"]',
    'input[data-testid="typeahead-input"]',
    'input[placeholder="Describe the job you want"]',
    'input[aria-label*="Search by title"]',
    'input[aria-label*="Search jobs"]',
    'input[id*="jobs-search-box-keyword-id"]',
    'input[name*="keywords"]',
  ];

  /**
   * Returns true when the element is visible enough to interact with.
   * Falls back to connected + not display:none when layout size is zero (e.g. jsdom).
   */
  function isVisibleInput(el) {
    if (!el || !(el instanceof HTMLInputElement)) return false;
    if (el.disabled || el.getAttribute('aria-hidden') === 'true') return false;
    if (!el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return true;
    const view = el.ownerDocument && el.ownerDocument.defaultView;
    if (view && typeof view.getComputedStyle === 'function') {
      const style = view.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  }

  /**
   * Finds the primary jobs search input on /jobs/ (combined typeahead query).
   */
  function findJobsSearchInput(doc) {
    const document = doc || global.document;
    for (const selector of KEYWORD_INPUT_SELECTORS) {
      const found = document.querySelector(selector);
      if (isVisibleInput(found)) {
        return { input: found, selector };
      }
    }
    return null;
  }

  /**
   * Sets a React/SDUI-controlled input value and emits input events.
   */
  function setInputValue(input, value) {
    input.focus();
    input.click();
    const proto = Object.getPrototypeOf(input);
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }
    try {
      input.dispatchEvent(
        new InputEvent('input', { bubbles: true, cancelable: true, data: value, inputType: 'insertText' })
      );
    } catch (e) {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * Submits the search via a nearby Search button or Enter on the typeahead.
   */
  function submitJobsSearch(input, doc) {
    const document = doc || global.document;
    const searchRoot = input.closest('[role="search"]') || input.parentElement;
    const localButtons = searchRoot
      ? Array.from(searchRoot.querySelectorAll('button'))
      : [];
    const globalButtons = Array.from(
      document.querySelectorAll(
        'button[aria-label*="Search"], .jobs-search-box__submit-button, button[type="submit"]'
      )
    );
    const candidates = [...localButtons, ...globalButtons];
    for (const node of candidates) {
      if (!(node instanceof HTMLElement)) continue;
      const label = (node.getAttribute('aria-label') || '').toLowerCase();
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (label.includes('notification') || label.includes('home,')) continue;
      if (
        label === 'search' ||
        label.includes('search jobs') ||
        label.includes('search by') ||
        text === 'search'
      ) {
        node.click();
        return { submitted: true, submitSelector: 'button[aria-label]' };
      }
    }
    const enterInit = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    input.dispatchEvent(new KeyboardEvent('keydown', enterInit));
    input.dispatchEvent(new KeyboardEvent('keypress', enterInit));
    input.dispatchEvent(new KeyboardEvent('keyup', enterInit));
    return { submitted: true, submitSelector: 'keyword_enter' };
  }

  /**
   * Fills the jobs search input with `uiQuery` and submits.
   */
  function applyJobsSearchUi(doc, uiQuery) {
    const document = doc || global.document;
    const uiQueryValue = (uiQuery || '').trim();
    if (!uiQueryValue) {
      return { ok: false, reason: 'empty_ui_query' };
    }
    const keyword = findJobsSearchInput(document);
    if (!keyword) {
      return { ok: false, reason: 'keyword_input_missing' };
    }
    setInputValue(keyword.input, uiQueryValue);
    const submit = submitJobsSearch(keyword.input, document);
    if (!submit.submitted) {
      return { ok: false, reason: 'search_submit_missing' };
    }
    return {
      ok: true,
      keywordSelector: keyword.selector,
      submitSelector: submit.submitSelector,
      uiQuery: uiQueryValue,
    };
  }

  const api = {
    KEYWORD_INPUT_SELECTORS,
    findJobsSearchInput,
    setInputValue,
    submitJobsSearch,
    applyJobsSearchUi,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.__jobBotLiSearchUi = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : {});
