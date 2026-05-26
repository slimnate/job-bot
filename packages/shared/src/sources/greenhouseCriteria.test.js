import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  filterGreenhouseJobs,
  formatGreenhouseCriteriaForDisplay,
  normalizeGreenhouseBoardToken,
  parseGreenhouseIncludeProspects,
  requireGreenhouseBoardToken,
  resolveGreenhouseSearchCriteria,
} from './greenhouseCriteria.ts';

const sampleJobs = [
  {
    id: 1,
    internal_job_id: 10,
    title: 'Backend Engineer',
    location: { name: 'San Francisco, CA' },
    absolute_url: 'https://boards.greenhouse.io/acme/jobs/1',
    departments: [{ id: 1, name: 'Engineering' }],
    offices: [{ id: 2, name: 'San Francisco' }],
    content: '<p>Build APIs</p>',
  },
  {
    id: 2,
    internal_job_id: null,
    title: 'General Application',
    location: { name: 'Remote' },
    absolute_url: 'https://boards.greenhouse.io/acme/jobs/2',
    departments: [],
    offices: [],
    content: 'Prospect pool',
  },
  {
    id: 3,
    internal_job_id: 11,
    title: 'Account Executive',
    location: { name: 'New York, NY' },
    absolute_url: 'https://boards.greenhouse.io/acme/jobs/3',
    departments: [{ id: 3, name: 'Sales' }],
    offices: [{ id: 4, name: 'New York City' }],
    content: 'Sell things',
  },
];

describe('greenhouseCriteria', () => {
  it('normalizeGreenhouseBoardToken handles slug and URLs', () => {
    assert.equal(normalizeGreenhouseBoardToken('Stripe'), 'stripe');
    assert.equal(
      normalizeGreenhouseBoardToken('https://boards.greenhouse.io/stripe/jobs/123'),
      'stripe'
    );
    assert.equal(
      normalizeGreenhouseBoardToken('https://boards-api.greenhouse.io/v1/boards/gitlab/jobs'),
      'gitlab'
    );
    assert.equal(
      normalizeGreenhouseBoardToken('https://job-boards.greenhouse.io/embed/job_board?for=figma'),
      'figma'
    );
  });

  it('parseGreenhouseIncludeProspects accepts true-ish values', () => {
    assert.equal(parseGreenhouseIncludeProspects('true'), true);
    assert.equal(parseGreenhouseIncludeProspects('YES'), true);
    assert.equal(parseGreenhouseIncludeProspects('false'), false);
    assert.equal(parseGreenhouseIncludeProspects(''), false);
  });

  it('resolveGreenhouseSearchCriteria trims fields', () => {
    const resolved = resolveGreenhouseSearchCriteria({
      boardToken: ' https://boards.greenhouse.io/Acme ',
      keyword: ' engineer ',
      department: 'Eng',
      office: 'SF',
      includeProspects: '1',
    });
    assert.equal(resolved.boardToken, 'acme');
    assert.equal(resolved.keyword, 'engineer');
    assert.equal(resolved.includeProspects, true);
  });

  it('filterGreenhouseJobs excludes prospects by default', () => {
    const filtered = filterGreenhouseJobs(sampleJobs, resolveGreenhouseSearchCriteria({}));
    assert.equal(filtered.length, 2);
    assert.ok(filtered.every((j) => j.internal_job_id != null));
  });

  it('filterGreenhouseJobs filters by department and keyword', () => {
    const filtered = filterGreenhouseJobs(
      sampleJobs,
      resolveGreenhouseSearchCriteria({
        department: 'engineering',
        keyword: 'api',
      })
    );
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.id, 1);
  });

  it('requireGreenhouseBoardToken throws when missing', () => {
    assert.throws(() => requireGreenhouseBoardToken(''), /requires a board token/);
    assert.equal(requireGreenhouseBoardToken('stripe'), 'stripe');
  });

  it('formatGreenhouseCriteriaForDisplay summarizes criteria', () => {
    assert.equal(
      formatGreenhouseCriteriaForDisplay({ boardToken: 'stripe', keyword: 'payments' }),
      'board: stripe | keyword: payments'
    );
  });
});
