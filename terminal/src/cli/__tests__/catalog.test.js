'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { listCatalogResources } = require('../../core/resources/queries.ts');

test('catalog discovery ranks exact identifiers and preserves existing filters', () => {
  const resources = [
    {
      id: 'release-helper',
      kind: 'skill',
      catalog: 'main',
      description: 'Helps with release notes',
      tags: ['release'],
    },
    {
      id: 'release',
      kind: 'agent',
      catalog: 'main',
      description: 'Prepares software releases',
      tags: ['automation'],
    },
    {
      id: 'release-guide',
      kind: 'instruction',
      catalog: 'other',
      description: 'Release process',
      tags: ['release'],
    },
  ];
  const ranked = listCatalogResources(resources, { query: 'release' });
  assert.deepEqual(
    ranked.map(({ id }) => id),
    ['release', 'release-helper', 'release-guide'],
  );
  assert.deepEqual(
    listCatalogResources(resources, {
      query: 'release',
      kind: 'skill',
      tag: 'release',
    }).map(({ id }) => id),
    ['release-helper'],
  );
});
