'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { catalogLabel, assertSourceResourceCanBeInstalled } = require('../mutations.ts');

test('labels catalogs and permits a source file with no tracked provenance conflict', () => {
  assert.equal(catalogLabel({ catalog: 'community' }), 'community catalog');
  assert.equal(catalogLabel({}), 'source catalog');
  assert.doesNotThrow(() => assertSourceResourceCanBeInstalled({ kind: 'instruction', id: 'review' }, '/tmp'));
});
