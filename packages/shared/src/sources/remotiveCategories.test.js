import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildRemotiveFeedUrls,
  formatRemotiveCategoriesForDisplay,
  getRemotiveCategoryBySlug,
  normalizeRemotiveCategoriesCriteria,
  parseRemotiveCategorySlugs,
  REMOTIVE_ALL_JOBS_FEED_URL,
} from '@job-bot/shared';

describe('remotiveCategories', () => {
  it('buildRemotiveFeedUrls returns category feeds', () => {
    const urls = buildRemotiveFeedUrls(['devops', 'data', 'devops']);
    assert.equal(urls.length, 2);
    assert.ok(urls.every((u) => u.startsWith('https://remotive.com/remote-jobs/')));
  });

  it('parseRemotiveCategorySlugs filters unknown', () => {
    assert.deepEqual(parseRemotiveCategorySlugs('software-development, bogus'), ['software-development']);
  });

  it('normalizeRemotiveCategoriesCriteria throws on unknown slug', () => {
    assert.throws(() => normalizeRemotiveCategoriesCriteria('not-a-category'), /Unknown Remotive/);
  });

  it('normalizeRemotiveCategoriesCriteria sorts and dedupes', () => {
    assert.equal(
      normalizeRemotiveCategoriesCriteria('devops, data, devops'),
      'data,devops'
    );
  });

  it('formatRemotiveCategoriesForDisplay', () => {
    assert.equal(formatRemotiveCategoriesForDisplay(''), 'All jobs');
    assert.equal(
      formatRemotiveCategoriesForDisplay('devops,data'),
      'Data and Analytics, Devops'
    );
  });

  it('getRemotiveCategoryBySlug is case-insensitive', () => {
    assert.equal(getRemotiveCategoryBySlug('DEVOPS')?.slug, 'devops');
  });

  it('all jobs feed constant', () => {
    assert.equal(REMOTIVE_ALL_JOBS_FEED_URL, 'https://remotive.com/remote-jobs/feed');
  });
});
