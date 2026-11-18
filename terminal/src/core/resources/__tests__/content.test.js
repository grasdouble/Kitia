'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isWithin, readUtf8, preparePinnedSourceFile } = require('../content.ts');
test('content helpers constrain paths and decode UTF-8 strictly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-test-'));
  try {
    const f = path.join(dir, 'x');
    fs.writeFileSync(f, 'ok');
    assert.equal(isWithin(f, dir), true);
    assert.equal(isWithin(path.join(dir + 'x', 'bad'), dir), false);
    assert.equal(readUtf8(f), 'ok');
    fs.writeFileSync(f, Buffer.from([255]));
    assert.throws(() => readUtf8(f, 'resource'), /not valid UTF-8/);
    assert.throws(() => preparePinnedSourceFile({ kind: 'agent' }), { code: 'INVALID_ARGUMENT' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
