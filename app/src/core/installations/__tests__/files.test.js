'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const { targetPath, installedFingerprint, sameFingerprint, writeInstallPlan } = require('../files.ts');
let root;
afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = undefined;
});

test('fingerprints installed files and rejects traversal while applying plans', () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-files-'));
  assert.throws(() => targetPath(root, '../escape'));
  assert.equal(installedFingerprint(root, 'notes.md'), null);
  const plan = new Map([['notes.md', { content: Buffer.from('hello'), executable: false }]]);
  writeInstallPlan(plan, root);
  const actual = installedFingerprint(root, 'notes.md');
  assert.equal(actual.sha256.length, 64);
  assert.equal(sameFingerprint(actual, actual), true);
  assert.equal(fs.readFileSync(path.join(root, 'notes.md'), 'utf8'), 'hello');
});
