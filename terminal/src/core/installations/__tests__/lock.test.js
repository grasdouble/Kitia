'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const { acquireOperationLock, inspectOperationLock } = require('../lock.ts');
let root;
afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = undefined;
});

test('operation lock excludes concurrent owners and releases cleanly', () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-lock-'));
  const release = acquireOperationLock(root);
  assert.equal(inspectOperationLock(root).status, 'active');
  assert.throws(() => acquireOperationLock(root), /locked/i);
  release();
  assert.equal(inspectOperationLock(root).status, 'absent');
});
