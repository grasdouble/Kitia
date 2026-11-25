'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { importCollectionText, publishCollectionFiles } = require('../import.ts');
test('collection import rejects malformed and oversized payloads before filesystem changes', () => {
  let writes = 0;
  const io = {
    writeFileSync() {
      writes++;
    },
  };
  assert.throws(() => importCollectionText('{bad', io), /not valid JSON/);
  assert.throws(() => importCollectionText('x'.repeat(2 * 1024 * 1024 + 1), io), /no larger than 2 MiB/);
  assert.equal(writes, 0);
});

test('collection rollback does not restore a target that was never published', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-collection-publish-'));
  const first = path.join(root, 'first.json');
  const second = path.join(root, 'second.json');
  const firstOriginal = Buffer.from('old-first\r\n');
  const secondOriginal = Buffer.from('old-second\n');
  fs.writeFileSync(first, firstOriginal);
  fs.writeFileSync(second, secondOriginal);
  const restorationTargets = [];
  let failedPublication = false;
  const io = Object.create(fs);
  io.renameSync = (from, to) => {
    if (from.endsWith('.backup')) restorationTargets.push(to);
    if (to === second && from.endsWith('.stage') && !failedPublication) {
      failedPublication = true;
      assert.equal(fs.readFileSync(first, 'utf8'), 'new-first');
      throw new Error('injected publication failure');
    }
    return fs.renameSync(from, to);
  };
  try {
    assert.throws(
      () =>
        publishCollectionFiles(
          [
            { target: first, contents: 'new-first' },
            { target: second, contents: 'new-second' },
          ],
          io,
        ),
      /injected publication failure/,
    );
    assert.deepEqual(restorationTargets, [first]);
    assert.deepEqual(fs.readFileSync(first), firstOriginal);
    assert.deepEqual(fs.readFileSync(second), secondOriginal);
    assert.deepEqual(fs.readdirSync(root).sort(), ['first.json', 'second.json']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('collection publication retains and reports a backup when restoration fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-collection-recovery-'));
  const target = path.join(root, 'catalog.json');
  const later = path.join(root, 'later.json');
  const original = Buffer.from('original\r\n');
  const laterOriginal = Buffer.from('untouched\n');
  fs.writeFileSync(target, original);
  fs.writeFileSync(later, laterOriginal);
  const io = Object.create(fs);
  io.renameSync = (from, to) => {
    if (to === target && from.endsWith('.backup')) throw new Error('injected restoration failure');
    if (to === later && from.endsWith('.stage')) throw new Error('injected publication failure');
    return fs.renameSync(from, to);
  };
  try {
    let backup;
    assert.throws(
      () =>
        publishCollectionFiles(
          [
            { target, contents: 'replacement' },
            { target: later, contents: 'not-published' },
          ],
          io,
        ),
      (failure) => {
        assert.match(failure.message, /injected publication failure.*injected restoration failure/);
        backup = failure.message.match(/recovery copy retained at (.+)$/)?.[1];
        assert.ok(backup, failure.message);
        return true;
      },
    );
    assert.equal(path.dirname(backup), root);
    assert.deepEqual(fs.readFileSync(backup), original);
    assert.equal(fs.readFileSync(target, 'utf8'), 'replacement');
    assert.deepEqual(fs.readFileSync(later), laterOriginal);
    assert.deepEqual(fs.readdirSync(root).sort(), ['catalog.json', 'later.json', path.basename(backup)].sort());
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
