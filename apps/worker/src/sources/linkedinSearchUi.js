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
    '[data-testid="typeahead-input"][componentkey="jobSearchBox"]',
    'input[data-testid="typeahead-input"]',
    '[data-testid="typeahead-input"][contenteditable="true"]',
    'input[placeholder="Describe the job you want"]',
    'input[aria-label*="Search by title"]',
    'input[aria-label*="Search jobs"]',
    'input[id*="jobs-search-box-keyword-id"]',
    'input[name*="keywords"]',
  ];

  /**
   * True for SDUI keyword field (`input` or contenteditable typeahead).
   */
  function isJobsSearchField(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    if (el instanceof HTMLInputElement) return true;
    return (
      el.getAttribute('data-testid') === 'typeahead-input' &&
      el.getAttribute('contenteditable') === 'true'
    );
  }

  /**
   * Returns true when the element is visible enough to interact with.
   * Falls back to connected + not display:none when layout size is zero (e.g. jsdom).
   */
  function isVisibleInput(el) {
    if (!isJobsSearchField(el)) return false;
    if (el instanceof HTMLInputElement && el.disabled) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
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
   * Clicks collapsed jobs search chrome so the typeahead input can mount or become visible.
   */
  function expandJobsSearchUi(doc) {
    const document = doc || global.document;
    const collapsed = document.querySelector(
      'div[role="search"][data-expanded="false"], [role="search"][data-expanded="false"]'
    );
    if (collapsed instanceof HTMLElement) {
      collapsed.click();
      return true;
    }
    const jobBox = document.querySelector(
      'div[data-sdui-component*="jobSearchBox"], [componentkey="navBarJobTypeaheadComponentRef"]'
    );
    if (jobBox instanceof HTMLElement) {
      jobBox.click();
      return true;
    }
    return false;
  }

  /**
   * Finds the primary jobs search input on /jobs/ (combined typeahead query).
   */
  function findJobsSearchInput(doc) {
    const document = doc || global.document;
    for (let pass = 0; pass < 2; pass++) {
      for (const selector of KEYWORD_INPUT_SELECTORS) {
        const nodes = document.querySelectorAll(selector);
        for (const found of nodes) {
          if (isVisibleInput(found)) {
            return { input: found, selector };
          }
        }
      }
      if (pass === 0 && expandJobsSearchUi(document)) {
        continue;
      }
      break;
    }
    return null;
  }

  /**
   * LinkedIn SDUI full-page error shell (visible copy only — `meta[name="como-err"]` is always
   * present as error-boundary config, even on healthy /jobs/ pages).
   */
  function linkedInJobsPageHasError(doc) {
    const document = doc || global.document;
    const body = document.body;
    const bodyText =
      (body && (body.innerText || body.textContent)) || '';
    if (!/something went wrong/i.test(bodyText)) {
      return false;
    }
    if (/try again/i.test(bodyText)) {
      return true;
    }
    const retryControl = document.querySelector(
      'button[aria-label*="Try again" i], a[aria-label*="Try again" i], [role="button"][aria-label*="Try again" i]'
    );
    return Boolean(retryControl && retryControl instanceof HTMLElement);
  }

  /**
   * Poll helper: whether the jobs keyword typeahead is present and interactable.
   */
  function pollJobsSearchInputReady(doc) {
    const document = doc || global.document;
    if (linkedInJobsPageHasError(document)) {
      return { ready: false, pageError: true, selector: null };
    }
    const found = findJobsSearchInput(document);
    return { ready: Boolean(found), pageError: false, selector: found?.selector ?? null };
  }

  /**
   * Sets a React/SDUI-controlled input value and emits input events.
   */
  function setInputValue(input, value) {
    input.focus();
    input.click();
    if (input instanceof HTMLInputElement) {
      const proto = Object.getPrototypeOf(input);
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
      if (descriptor && descriptor.set) {
        descriptor.set.call(input, value);
      } else {
        input.value = value;
      }
    } else if (input.getAttribute('contenteditable') === 'true') {
      input.textContent = value;
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
    expandJobsSearchUi,
    linkedInJobsPageHasError,
    pollJobsSearchInputReady,
    setInputValue,
    submitJobsSearch,
    applyJobsSearchUi,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.__jobBotLiSearchUi = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : {});
