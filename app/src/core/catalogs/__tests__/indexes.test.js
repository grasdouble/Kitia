'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const { loadCatalogs } = require('../indexes.ts');
const { validateSourceConfiguration } = require('../model.ts');
let root;
let previous;

afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = undefined;
  if (previous === undefined) delete process.env.KITIA_CONFIG_DIR;
  else process.env.KITIA_CONFIG_DIR = previous;
});

function makeCatalogs() {
  previous = process.env.KITIA_CONFIG_DIR;
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-indexes-'));
  process.env.KITIA_CONFIG_DIR = root;
  const sources = validateSourceConfiguration({
    catalog_version: 1,
    sources: [
      { name: 'Healthy', repository: 'https://github.com/acme/healthy' },
      { name: 'Unavailable', repository: 'https://github.com/acme/unavailable' },
    ],
  });
  const directory = path.join(root, 'source-catalogs');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'catalogSources.json'),
    JSON.stringify({ catalog_version: 1, sources: sources.map(({ name, repository }) => ({ name, repository })) }),
  );
  fs.writeFileSync(
    path.join(directory, 'Healthy.json'),
    JSON.stringify({
      catalog_version: 1,
      catalog_name: 'Healthy',
      source_repository: 'acme/healthy',
      source_ref: 'a'.repeat(40),
      resources: [
        {
          id: 'demo',
          kind: 'skill',
          source_path: 'skills/demo',
          description: 'A healthy fixture.',
          license_status: 'not-declared',
        },
      ],
    }),
  );
  return sources;
}

test('targeted catalog loading does not depend on other source indexes', () => {
  const sources = makeCatalogs();
  const loaded = loadCatalogs({ names: ['Healthy'], sources });
  assert.deepEqual(loaded.unavailable, []);
  assert.deepEqual(
    loaded.sourceResources.map(({ catalog, id }) => ({ catalog, id })),
    [{ catalog: 'Healthy', id: 'demo' }],
  );
});

test('aggregate discovery preserves healthy catalogs and identifies only unavailable indexes', () => {
  const sources = makeCatalogs();
  const warnings = [];
  const loaded = loadCatalogs({ sources, allowUnavailable: true }, (warning) => warnings.push(warning));
  assert.deepEqual(
    loaded.sourceResources.map(({ catalog, id }) => ({ catalog, id })),
    [{ catalog: 'Healthy', id: 'demo' }],
  );
  assert.deepEqual(loaded.unavailable, ['Unavailable']);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].catalog, 'Unavailable');
  assert.equal(warnings[0].code, 'CATALOG_UNAVAILABLE');
});

test('aggregate discovery retains healthy catalogs when another index is invalid', () => {
  const sources = makeCatalogs();
  const directory = path.join(root, 'source-catalogs');
  fs.writeFileSync(
    path.join(directory, 'Unavailable.json'),
    JSON.stringify({ catalog_version: 999, catalog_name: 'Unavailable', resources: [] }),
  );
  const warnings = [];
  const loaded = loadCatalogs({ sources, allowUnavailable: true }, (warning) => warnings.push(warning));
  assert.deepEqual(
    loaded.sourceResources.map(({ catalog, id }) => ({ catalog, id })),
    [{ catalog: 'Healthy', id: 'demo' }],
  );
  assert.deepEqual(loaded.unavailable, ['Unavailable']);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].catalog, 'Unavailable');
  assert.equal(warnings[0].code, 'UNSUPPORTED_CATALOG_VERSION');
});

test('explicit aggregate validation remains strict', () => {
  const sources = makeCatalogs();
  assert.throws(() => loadCatalogs({ sources, strictAggregate: true }), /index|catalog/i);
});
