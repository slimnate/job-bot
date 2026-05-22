/**
 * Regression tests for list-scoped LinkedIn job card click targeting.
 * Run: npm run test --workspace=@job-bot/worker
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLICK_TARGETS = readFileSync(join(__dirname, 'linkedinScrapeClickTargets.js'), 'utf8');

function loadClickTargets(dom) {
  const { window } = dom;
  const script = window.document.createElement('script');
  script.textContent = CLICK_TARGETS;
  window.document.documentElement.appendChild(script);
  return window.__jobBotLiClickTargets;
}

const SEARCH_RESULTS_LIST = `
  <div data-testid="lazy-column" data-component-type="LazyColumn" componentkey="SearchResultsMainContent">
    <div role="button" tabindex="0" componentkey="a6659559-56a3-4267-ab81-5e5689fb8bd8">
      <button aria-label="Dismiss Software Engineer job">Dismiss</button>
      <a class="job-card-list__title" href="https://www.linkedin.com/jobs/view/1111111111/">Software Engineer</a>
      <p>Acme Corp · Remote</p>
    </div>
    <div role="button" tabindex="0" componentkey="6d49a6dc-c091-44b5-a07f-2dc9e134a9a9">
      <button aria-label="Dismiss Product Engineer job">Dismiss</button>
      <a href="https://www.linkedin.com/jobs/view/2222222222/">Product Engineer</a>
      <p>Other Co · United States (Remote)</p>
    </div>
  </div>
`;

const DETAIL_PANE = `
  <div class="jobs-search__job-details" componentkey="JobDetails_AboutTheJob_1111111111">
    <a class="job-card-list__title" href="https://www.linkedin.com/jobs/view/1111111111/">Software Engineer</a>
    <h2>About the job</h2>
    <p>Detail body for selected job.</p>
  </div>
`;

test('geo-shaped page: prefers dismiss card button over title anchor', () => {
  const html = `<html><body>${SEARCH_RESULTS_LIST}${DETAIL_PANE}</body></html>`;
  const dom = new JSDOM(html, {
    url: 'https://www.linkedin.com/jobs/search/?currentJobId=1111111111',
    runScripts: 'dangerously',
  });
  const ct = loadClickTargets(dom);
  const targets = ct.getClickableTargets(dom.window.document);
  assert.ok(targets.length >= 2);
  assert.strictEqual(targets[0].getAttribute('role'), 'button');
  assert.ok(ct.isLikelyJobCardButton(targets[0]));
  assert.strictEqual(
    targets[0].querySelector('button[aria-label^="Dismiss "]')?.getAttribute('aria-label'),
    'Dismiss Software Engineer job'
  );
  const detailTitle = dom.window.document.querySelector(
    '.jobs-search__job-details a.job-card-list__title'
  );
  assert.ok(detailTitle);
  assert.ok(!targets.includes(detailTitle));
});

test('default-shaped page: preferences label outside list is not a click target', () => {
  const html = `<html><body>
    <p>Jobs based on your preferences</p>
    ${SEARCH_RESULTS_LIST}
    ${DETAIL_PANE}
  </body></html>`;
  const dom = new JSDOM(html, {
    url: 'https://www.linkedin.com/jobs/search/?currentJobId=1111111111',
    runScripts: 'dangerously',
  });
  const ct = loadClickTargets(dom);
  const targets = ct.getClickableTargets(dom.window.document);
  assert.ok(targets.every((t) => ct.getJobsListRoot(dom.window.document).contains(t)));
  assert.ok(targets.every((t) => !ct.isInsideJobDetailPanel(t, dom.window.document)));
});

test('SearchResultsMainContent is the list root', () => {
  const html = `<html><body>${SEARCH_RESULTS_LIST}</body></html>`;
  const dom = new JSDOM(html, {
    url: 'https://www.linkedin.com/jobs/search/',
    runScripts: 'dangerously',
  });
  const ct = loadClickTargets(dom);
  const root = ct.getJobsListRoot(dom.window.document);
  assert.strictEqual(root?.getAttribute('componentkey'), 'SearchResultsMainContent');
});

test('example-search legacy layout: clicks job-card-container not title link', () => {
  const html = `<html><body>
    <div class="scaffold-layout__list-container">
      <ul class="scaffold-layout__list jobs-search-results-list">
        <li data-occludable-job-id="4414001767" class="scaffold-layout__list-item">
          <div data-job-id="4414001767" class="job-card-container job-card-container--clickable jobs-search-two-pane__job-card-container">
            <a class="job-card-container__link job-card-list__title--link" href="/jobs/view/4414001767/?refId=test">Frontend Developer</a>
            <button aria-label="Dismiss Frontend Developer job">Dismiss</button>
          </div>
        </li>
        <li data-occludable-job-id="4414001768" class="scaffold-layout__list-item">
          <div data-job-id="4414001768" class="job-card-container job-card-container--clickable">
            <a class="job-card-list__title--link" href="/jobs/view/4414001768/">Other role</a>
          </div>
        </li>
      </ul>
    </div>
    <div class="jobs-search__job-details">
      <a class="job-card-list__title--link" href="/jobs/view/4414001767/">Frontend Developer</a>
    </div>
  </body></html>`;
  const dom = new JSDOM(html, {
    url: 'https://www.linkedin.com/jobs/search/?currentJobId=4414001767',
    runScripts: 'dangerously',
  });
  const ct = loadClickTargets(dom);
  const targets = ct.getClickableTargets(dom.window.document);
  assert.ok(targets.length >= 2);
  assert.ok(targets[0].classList.contains('job-card-container'));
  assert.strictEqual(
    targets[0].getAttribute('data-job-id') || targets[0].closest('[data-job-id]')?.getAttribute('data-job-id'),
    '4414001767'
  );
  const titleLink = dom.window.document.querySelector(
    'li[data-occludable-job-id] a.job-card-list__title--link'
  );
  assert.ok(titleLink);
  assert.ok(!targets.includes(titleLink));
});

test('legacy page without SearchResultsMainContent still returns list-scoped targets', () => {
  const html = `<html><body>
    <ul class="scaffold-layout__list">
      <li data-occludable-job-id="3333333333">
        <div role="button" componentkey="eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee">
          <button aria-label="Dismiss Legacy job">Dismiss</button>
          <a href="https://www.linkedin.com/jobs/view/3333333333/">Legacy Software Engineer</a>
          <p>Legacy Corp · Austin, Texas Metropolitan Area · On-site</p>
        </div>
      </li>
    </ul>
  </body></html>`;
  const dom = new JSDOM(html, {
    url: 'https://www.linkedin.com/jobs/search/?currentJobId=3333333333',
    runScripts: 'dangerously',
  });
  const ct = loadClickTargets(dom);
  const targets = ct.getClickableTargets(dom.window.document);
  assert.ok(targets.length >= 1);
  assert.strictEqual(targets[0].getAttribute('role'), 'button');
});
