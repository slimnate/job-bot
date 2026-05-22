/**
 * Run: npm run test --workspace=@job-bot/worker
 */
import assert from 'node:assert';
import { test } from 'node:test';

import {
  buildLinkedInUiSearchQuery,
  resolveLinkedInSearchCriteria,
} from './linkedinSearchCriteria.ts';

test('buildLinkedInUiSearchQuery combines search and location', () => {
  assert.equal(
    buildLinkedInUiSearchQuery('software engineer', 'Austin, TX'),
    'software engineer in Austin, TX'
  );
});

test('buildLinkedInUiSearchQuery returns search only when location empty', () => {
  assert.equal(buildLinkedInUiSearchQuery('software engineer', ''), 'software engineer');
});

test('buildLinkedInUiSearchQuery returns empty when search is missing', () => {
  assert.equal(buildLinkedInUiSearchQuery('', 'Remote'), '');
  assert.equal(buildLinkedInUiSearchQuery('  ', 'Austin, TX'), '');
});

test('resolveLinkedInSearchCriteria ignores location when search is empty', () => {
  const resolved = resolveLinkedInSearchCriteria({ location: 'Remote' });
  assert.equal(resolved.search, '');
  assert.equal(resolved.location, '');
  assert.equal(resolved.uiQuery, '');
});

test('resolveLinkedInSearchCriteria ignores legacy geoId field', () => {
  const resolved = resolveLinkedInSearchCriteria({
    search: 'engineer',
    location: 'Texas',
    geoId: '90000096',
  });
  assert.equal(resolved.search, 'engineer');
  assert.equal(resolved.location, 'Texas');
  assert.equal(resolved.uiQuery, 'engineer in Texas');
});
