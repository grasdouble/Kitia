'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { remoteHead } = require('../repository.ts');
const { CatalogError } = require('../../resources/model.ts');

test('resolves remote default branch head and rejects malformed git output', async () => {
  assert.equal(
    await remoteHead('https://github.com/acme/repo', async () => ({ stdout: `${'A'.repeat(40)}\tHEAD\n` })),
    'a'.repeat(40),
  );
  await assert.rejects(
    remoteHead('https://github.com/acme/repo', async () => ({ stdout: 'not a ref' })),
    CatalogError,
  );
});
