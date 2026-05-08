/**
 * Regression tests for scoped LinkedIn extraction (salary / field bleed).
 * Run: npm run test --workspace=@job-bot/worker
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INPAGE = readFileSync(join(__dirname, 'linkedinScrapeInpage.js'), 'utf8');

function loadLi(dom) {
  const { window } = dom;
  const script = window.document.createElement('script');
  script.textContent = INPAGE;
  window.document.documentElement.appendChild(script);
  return window.__jobBotLiScrape;
}

test('salary from other list cards is not applied when active job card has no chip', () => {
  const html = `
    <html><body>
      <ul class="scaffold-layout__list">
        <li data-occludable-job-id="4399229719">
          <a href="https://www.linkedin.com/jobs/view/4399229719/">Full Stack Software Engineer</a>
          <p>Terralytiq · United States (Remote)</p>
        </li>
        <li data-occludable-job-id="4395579019">
          <a href="https://www.linkedin.com/jobs/view/4395579019/">Product Engineer</a>
          <p>Scrunch · United States (Remote)</p>
          <span class="salary-chip">$140K/yr - $200K/yr</span>
        </li>
      </ul>
      <div class="jobs-search__job-details">
        <h2>About the job</h2>
        <div data-testid="expandable-text-box">Build great products. No pay range listed here.</div>
      </div>
    </body></html>`;
  const dom = new JSDOM(html, {
    url: 'https://www.linkedin.com/jobs/search/?currentJobId=4399229719',
    runScripts: 'dangerously',
  });
  const li = loadLi(dom);
  const details = li.getCurrentDetails(dom.window.document, dom.window);
  assert.strictEqual(details.externalId, '4399229719');
  assert.strictEqual(details.salary, li.na);
  assert.strictEqual(details.extractionDiagnostics.salarySource, null);
});

test('salary chip on the active list card is captured', () => {
  const html = `
    <html><body>
      <ul class="scaffold-layout__list">
        <li data-occludable-job-id="4399229719">
          <a href="https://www.linkedin.com/jobs/view/4399229719/">Other job</a>
        </li>
        <li data-occludable-job-id="4395579019">
          <a href="https://www.linkedin.com/jobs/view/4395579019/">Product Engineer</a>
          <p>Scrunch · United States (Remote)</p>
          <span>$140K/yr - $200K/yr</span>
        </li>
      </ul>
      <div class="jobs-search__job-details">
        <h2>About the job</h2>
        <div data-testid="expandable-text-box">About the role.</div>
      </div>
    </body></html>`;
  const dom = new JSDOM(html, {
    url: 'https://www.linkedin.com/jobs/search/?currentJobId=4395579019',
    runScripts: 'dangerously',
  });
  const li = loadLi(dom);
  const details = li.getCurrentDetails(dom.window.document, dom.window);
  assert.strictEqual(details.externalId, '4395579019');
  assert.strictEqual(details.salary, '$140K/yr - $200K/yr');
  assert.strictEqual(details.extractionDiagnostics.salarySource, 'card');
});

test('description pay range wins over list card when both exist', () => {
  const html = `
    <html><body>
      <ul class="scaffold-layout__list">
        <li data-occludable-job-id="4395579019">
          <a href="https://www.linkedin.com/jobs/view/4395579019/">Product Engineer</a>
          <span>$140K/yr - $200K/yr</span>
        </li>
      </ul>
      <div class="jobs-search__job-details">
        <h2>About the job</h2>
        <div data-testid="expandable-text-box">
          In California the standard base pay range for this role is $136,300.00 - $217,700.00 annually.
        </div>
      </div>
    </body></html>`;
  const dom = new JSDOM(html, {
    url: 'https://www.linkedin.com/jobs/search/?currentJobId=4395579019',
    runScripts: 'dangerously',
  });
  const li = loadLi(dom);
  const details = li.getCurrentDetails(dom.window.document, dom.window);
  assert.match(details.salary, /\$136,300/);
  assert.strictEqual(details.extractionDiagnostics.salarySource, 'detail');
});

test('verifyCaptureIntegrity rejects url vs posting id mismatch', () => {
  const dom = new JSDOM('<html><body></body></html>', { runScripts: 'dangerously' });
  const li = loadLi(dom);
  const v = li.verifyCaptureIntegrity({
    externalId: '1',
    extractionDiagnostics: {
      currentJobIdFromUrl: '2',
      hasListCard: true,
      hasDetailRoot: true,
    },
  });
  assert.strictEqual(v.ok, false);
});
