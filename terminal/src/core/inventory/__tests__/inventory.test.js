'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const { readInstallState } = require('../inventory.ts');
let root;
afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = undefined;
});

test('initializes a valid empty install state for a target', () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-inventory-'));
  const state = readInstallState(root);
  assert.equal(Number.isSafeInteger(state.lock_version), true);
  assert.deepEqual(state.sources, {});
  assert.equal(fs.existsSync(path.join(root, '.agents/kitia-lock.json')), false);
});
