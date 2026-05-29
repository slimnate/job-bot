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

test('description salary with single dollar sign on range is captured', () => {
  const html = `
    <html><body>
      <ul class="scaffold-layout__list">
        <li data-occludable-job-id="4399229719">
          <a href="https://www.linkedin.com/jobs/view/4399229719/">Full Stack Software Engineer</a>
          <p>Terralytiq · United States (Remote)</p>
        </li>
      </ul>
      <div class="jobs-search__job-details">
        <h2>About the job</h2>
        <div data-testid="expandable-text-box">
          Benefits: $90,000-120,000 base salary plus equity; healthcare and 401k benefits available for US roles.
        </div>
      </div>
    </body></html>`;
  const dom = new JSDOM(html, {
    url: 'https://www.linkedin.com/jobs/search/?currentJobId=4399229719',
    runScripts: 'dangerously',
  });
  const li = loadLi(dom);
  const details = li.getCurrentDetails(dom.window.document, dom.window);
  assert.match(details.salary, /\$90,000-120,000/);
  assert.strictEqual(details.extractionDiagnostics.salarySource, 'detail');
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

test('description preserves markdown structure from DOM blocks', () => {
  const html = `
    <html><body>
      <ul class="scaffold-layout__list">
        <li data-occludable-job-id="4399229719">
          <a href="https://www.linkedin.com/jobs/view/4399229719/">Full Stack Software Engineer</a>
          <p>Terralytiq · United States (Remote)</p>
        </li>
      </ul>
      <div class="jobs-search__job-details">
        <h2>About the job</h2>
        <div data-testid="expandable-text-box">
          <p>Terralytiq is the decarbonization copilot for manufacturers.</p>
          <strong>About the Role</strong>
          <p>Own end-to-end feature development across our Next.js/React frontend and Python API.</p>
          <p>Ship to production infrastructure on AWS (ECS Fargate, SQS, S3) and Vercel.</p>
          <strong>About You</strong>
          <p>2–4 years as a self-directed engineer who thrives in small teams.</p>
          <p><strong>Must-have experience:</strong> TypeScript/Next.js/React, Python with Flask.</p>
          <strong>Benefits:</strong>
          <p>$90,000-120,000 base salary plus equity; healthcare and 401k benefits available for US roles.</p>
        </div>
      </div>
    </body></html>`;
  const dom = new JSDOM(html, {
    url: 'https://www.linkedin.com/jobs/search/?currentJobId=4399229719',
    runScripts: 'dangerously',
  });
  const li = loadLi(dom);
  const details = li.getCurrentDetails(dom.window.document, dom.window);
  assert.match(details.description, /\*\*About the Role\*\*/);
  assert.match(details.description, /^- Own end-to-end/m);
  assert.match(details.description, /^- Ship to production/m);
  assert.match(details.description, /\*\*Must-have experience:\*\*/);
  assert.match(details.description, /\*\*Benefits:\*\*/);
  assert.match(details.description, /\$90,000-120,000 base salary/);
  assert.doesNotMatch(details.description, /copilot for\nmanufacturers/);
});

test('description ul/li lists are captured as markdown bullets', () => {
  const html = `
    <html><body>
      <ul class="scaffold-layout__list">
        <li data-occludable-job-id="1">
          <a href="https://www.linkedin.com/jobs/view/1/">Engineer</a>
        </li>
      </ul>
      <div class="jobs-search__job-details">
        <h2>About the job</h2>
        <div data-testid="expandable-text-box">
          <strong>Benefits</strong>
          <ul>
            <li>$120K - $140K base salary</li>
            <li>Fully remote</li>
          </ul>
        </div>
      </div>
    </body></html>`;
  const dom = new JSDOM(html, {
    url: 'https://www.linkedin.com/jobs/search/?currentJobId=1',
    runScripts: 'dangerously',
  });
  const li = loadLi(dom);
  const details = li.getCurrentDetails(dom.window.document, dom.window);
  assert.match(details.description, /- \$120K - \$140K base salary/);
  assert.match(details.description, /- Fully remote/);
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
