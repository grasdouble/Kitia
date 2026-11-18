'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { listCatalogResources, enrichInstalledResources } = require('../queries.ts');
test('queries apply filters, default catalog and enrich installed records', () => {
  const list = listCatalogResources(
    [
      { id: 'x', kind: 'skill', tags: ['cli'], description: 'cli helper', license_status: 'MIT' },
      { id: 'y', kind: 'agent', tags: [] },
    ],
    { tag: 'cli' },
  );
  assert.equal(list[0].catalog, 'source');
  const out = enrichInstalledResources(
    [{ id: 'x', kind: 'skill', catalog: 'source', scope: 'user', managed: true }],
    list,
  );
  assert.equal(out[0].description, 'cli helper');
});
