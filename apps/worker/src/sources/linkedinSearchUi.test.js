/**
 * Regression tests for LinkedIn /jobs/ search box targeting (ex/example-jobs.html).
 * Run: npm run test --workspace=@job-bot/worker
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEARCH_UI = readFileSync(join(__dirname, 'linkedinSearchUi.js'), 'utf8');

/** Minimal DOM from ex/example-jobs.html (SDUI jobSearchBox typeahead). */
const JOBS_HUB_SEARCH_HTML = `
  <div componentkey="navBarJobTypeaheadComponentRef">
    <div data-sdui-component="com.linkedin.sdui.generated.jobseeker.dsl.impl.jobSearchBox">
      <div role="search" data-expanded="false">
        <input
          data-testid="typeahead-input"
          componentkey="jobSearchBox"
          placeholder="Describe the job you want"
          autocomplete="off"
          aria-autocomplete="list"
          value=""
        />
      </div>
    </div>
  </div>
`;

function loadSearchUi(dom) {
  const { window } = dom;
  const script = window.document.createElement('script');
  script.textContent = SEARCH_UI;
  window.document.documentElement.appendChild(script);
  return window.__jobBotLiSearchUi;
}

test('findJobsSearchInput locates SDUI typeahead from example-jobs layout', () => {
  const dom = new JSDOM(`<html><body>${JOBS_HUB_SEARCH_HTML}</body></html>`, {
    url: 'https://www.linkedin.com/jobs/',
    runScripts: 'dangerously',
  });
  const ui = loadSearchUi(dom);
  const found = ui.findJobsSearchInput(dom.window.document);
  assert.ok(found);
  assert.strictEqual(found.selector, 'input[data-testid="typeahead-input"][componentkey="jobSearchBox"]');
  assert.strictEqual(found.input.getAttribute('placeholder'), 'Describe the job you want');
});

test('applyJobsSearchUi fills typeahead and submits via Enter', () => {
  const dom = new JSDOM(`<html><body>${JOBS_HUB_SEARCH_HTML}</body></html>`, {
    url: 'https://www.linkedin.com/jobs/',
    runScripts: 'dangerously',
  });
  const ui = loadSearchUi(dom);
  const result = ui.applyJobsSearchUi(dom.window.document, 'software engineer in Austin, TX');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.uiQuery, 'software engineer in Austin, TX');
  const input = dom.window.document.querySelector('input[data-testid="typeahead-input"]');
  assert.strictEqual(input.value, 'software engineer in Austin, TX');
  assert.strictEqual(result.submitSelector, 'keyword_enter');
});

test('legacy keyword field still works when SDUI typeahead is absent', () => {
  const html = `
    <input aria-label="Search by title, skill or company" id="jobs-search-box-keyword-id-ember42" />
  `;
  const dom = new JSDOM(`<html><body>${html}</body></html>`, {
    url: 'https://www.linkedin.com/jobs/',
    runScripts: 'dangerously',
  });
  const ui = loadSearchUi(dom);
  const found = ui.findJobsSearchInput(dom.window.document);
  assert.ok(found);
  assert.match(found.selector, /Search by title|keyword/);
});
