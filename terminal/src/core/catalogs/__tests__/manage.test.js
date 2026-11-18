'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { importCatalogConfigurationText, exportCatalogConfigurationData } = require('../manage.ts');
const { CatalogError } = require('../../resources/model.ts');

test('catalog configuration export and import validate input and produce canonical structure', () => {
  const previous = process.env.KITIA_CONFIG_DIR;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-manage-'));
  process.env.KITIA_CONFIG_DIR = root;
  try {
    assert.deepEqual(exportCatalogConfigurationData(), { catalog_version: 1, sources: [] });
    assert.throws(() => importCatalogConfigurationText('{broken'), SyntaxError);
    const result = importCatalogConfigurationText(JSON.stringify({ catalog_version: 1, sources: [] }));
    assert.deepEqual(result, { added: [], ignored: [], refreshed: [], refreshFailures: [] });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.KITIA_CONFIG_DIR;
    else process.env.KITIA_CONFIG_DIR = previous;
  }
});
