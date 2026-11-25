'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  CatalogError,
  INSTALLABLE_KINDS,
  USER_INSTALLABLE_KINDS,
  RESOURCE_ID,
  rejectUnsupportedVersion,
} = require('../model.ts');
test('resource model exposes stable installability and error contracts', () => {
  assert.deepEqual([...INSTALLABLE_KINDS], ['skill', 'agent', 'instruction']);
  assert.equal(USER_INSTALLABLE_KINDS.has('instruction'), false);
  assert.equal(RESOURCE_ID.test('good-id'), true);
  assert.equal(RESOURCE_ID.test('bad--id'), false);
  assert.throws(() => rejectUnsupportedVersion(2, 1, 'catalog', 'UNSUPPORTED_CATALOG_VERSION'), {
    code: 'UNSUPPORTED_CATALOG_VERSION',
  });
  const e = new CatalogError('bad', 'X', { paths: ['a'] });
  assert.deepEqual(e.paths, ['a']);
});
