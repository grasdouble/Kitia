'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { CATALOG_PRESETS } = require('../presets.ts');

test('catalog presets expose unique command aliases and valid repository URLs', () => {
  assert.ok(CATALOG_PRESETS.length > 0);
  assert.equal(new Set(CATALOG_PRESETS.map(({ command }) => command)).size, CATALOG_PRESETS.length);
  for (const preset of CATALOG_PRESETS) {
    assert.equal(new URL(preset.repository).protocol, 'https:');
    assert.ok(preset.catalogName);
  }
});
