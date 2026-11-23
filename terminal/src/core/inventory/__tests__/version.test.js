'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { CURRENT_INVENTORY_VERSION } = require('../version.ts');

test('inventory format version is a positive integer', () => {
  assert.equal(Number.isSafeInteger(CURRENT_INVENTORY_VERSION), true);
  assert.ok(CURRENT_INVENTORY_VERSION > 0);
});
