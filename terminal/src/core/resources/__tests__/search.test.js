'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { matchesSearch, matchesSearchText, searchRelevance } = require('../search.ts');
test('search requires all terms and ranks exact identifiers above descriptions', () => {
  const resource = { id: 'shell-tools', description: 'Tools for shell automation', tags: ['automation'] };
  assert.equal(matchesSearch(resource, 'shell automation'), true);
  assert.equal(matchesSearch(resource, 'shell missing'), false);
  assert.ok(searchRelevance(resource, 'shell') > searchRelevance({ id: 'other', description: 'shell' }, 'shell'));
  assert.equal(matchesSearchText('alpha beta', ['Alpha collection', 'beta']), true);
});
