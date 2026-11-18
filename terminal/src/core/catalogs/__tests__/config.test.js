'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const { loadUserSourceConfiguration, userCatalogSourcesFile, userCatalogIndexDirectory } = require('../config.ts');
let previous;
afterEach(() => {
  if (previous === undefined) delete process.env.KITIA_CONFIG_DIR;
  else process.env.KITIA_CONFIG_DIR = previous;
});

test('loads configured catalog sources from the configured directory', () => {
  previous = process.env.KITIA_CONFIG_DIR;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-config-'));
  process.env.KITIA_CONFIG_DIR = root;
  try {
    assert.deepEqual(loadUserSourceConfiguration(), []);
    fs.writeFileSync(
      userCatalogSourcesFile(),
      JSON.stringify({ catalog_version: 1, sources: [{ name: 'team', repository: 'https://github.com/acme/repo' }] }),
    );
    assert.equal(loadUserSourceConfiguration()[0].name, 'team');
    assert.equal(userCatalogIndexDirectory(), path.join(root, 'source-catalogs'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
