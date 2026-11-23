'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { isJsonValue, isJsonObject } = require('../json.ts');
test('JSON guards accept recursive values and follow enumerable own JSON-like values', () => {
  assert.equal(isJsonObject({ a: [1, null, { b: true }] }), true);
  assert.equal(isJsonValue(null), true);
  const accessor = {};
  Object.defineProperty(accessor, 'x', {
    get() {
      return 1;
    },
    enumerable: true,
  });
  assert.equal(isJsonObject(accessor), false);
  assert.equal(isJsonValue([undefined]), false);
});
