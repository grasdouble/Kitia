'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { resolveCatalogResource } = require('../selection.ts');
test('selection filters by kind and delegates ambiguous choices', async () => {
  const rs = [
    { id: 'a', kind: 'skill' },
    { id: 'a', kind: 'agent' },
  ];
  assert.equal((await resolveCatalogResource(rs, 'a', 'agent')).kind, 'agent');
  assert.equal(await resolveCatalogResource(rs, 'a', null, async (c) => c[1]), rs[1]);
  await assert.rejects(resolveCatalogResource(rs, 'missing'), { code: 'RESOURCE_NOT_FOUND' });
});
