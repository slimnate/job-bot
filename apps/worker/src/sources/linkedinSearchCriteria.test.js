import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveLinkedInSearchCriteria } from './linkedinSearchCriteria.ts';

test('resolveLinkedInSearchCriteria prefers geoId over location', () => {
  const resolved = resolveLinkedInSearchCriteria({
    search: 'engineer',
    location: 'Austin, TX',
    geoId: '90000096',
  });
  assert.equal(resolved.search, 'engineer');
  assert.equal(resolved.geoId, '90000096');
  assert.equal(resolved.location, '');
});

test('resolveLinkedInSearchCriteria keeps location when geoId is absent', () => {
  const resolved = resolveLinkedInSearchCriteria({
    search: 'engineer',
    location: 'Austin, TX',
  });
  assert.equal(resolved.location, 'Austin, TX');
  assert.equal(resolved.geoId, '');
});
