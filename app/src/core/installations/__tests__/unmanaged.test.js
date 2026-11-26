'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { removeUnmanagedResource } = require('../unmanaged.ts');

test('unmanaged removal refuses unsupported scopes and undetected resources', () => {
  assert.throws(
    () => removeUnmanagedResource('/tmp', { sources: {} }, { kind: 'agent', id: 'demo', scope: 'global' }),
    /scope/i,
  );
  assert.throws(
    () => removeUnmanagedResource('/tmp', { sources: {} }, { kind: 'agent', id: 'missing', scope: 'project' }),
    /no longer detected/i,
  );
});
