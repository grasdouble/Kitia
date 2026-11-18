'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { checkCatalogFreshness, importCatalogConfigurationText } = require('../manage.ts');
const { loadUserSourceConfiguration } = require('../config.ts');
const { validateSourceConfiguration } = require('../model.ts');
const { setupTemporaryDirectory, writeJson } = require('../../../../test/fixtures/source-catalog-fixtures.js');

const makeTemporaryDirectory = setupTemporaryDirectory();

test('catalog freshness compares cached index with remote default branch', async () => {
  const temporary = makeTemporaryDirectory('kitia-catalog-freshness-');
  const previousConfig = process.env.KITIA_CONFIG_DIR;
  const configDirectory = path.join(temporary, 'config');
  const repository = 'https://github.com/example/test';
  const revision = 'a'.repeat(40);
  const remote = (ref) => async () => ({ stdout: `${ref}\tHEAD\n` });
  try {
    process.env.KITIA_CONFIG_DIR = configDirectory;
    writeJson(path.join(configDirectory, 'catalogSources.json'), {
      catalog_version: 1,
      sources: [{ name: 'Test', repository }],
    });
    writeJson(path.join(configDirectory, 'source-catalogs', 'Test.json'), {
      catalog_name: 'Test',
      source_repository: 'example/test',
      source_ref: revision,
      resources: [],
    });
    assert.deepEqual(await checkCatalogFreshness(remote(revision)), [{ name: 'Test', status: 'current' }]);
    assert.deepEqual(await checkCatalogFreshness(remote('b'.repeat(40))), [{ name: 'Test', status: 'outdated' }]);
    assert.deepEqual(
      await checkCatalogFreshness(async () => {
        throw new Error('network unavailable');
      }),
      [{ name: 'Test', status: 'unknown' }],
    );
  } finally {
    if (previousConfig === undefined) delete process.env.KITIA_CONFIG_DIR;
    else process.env.KITIA_CONFIG_DIR = previousConfig;
  }
});

test('catalog import skips same-name and same-repository entries but adds non-conflicting catalogs', () => {
  const temporary = makeTemporaryDirectory('kitia-import-catalog-config-');
  const previousConfig = process.env.KITIA_CONFIG_DIR;
  const directory = path.join(temporary, 'config');
  process.env.KITIA_CONFIG_DIR = directory;
  try {
    const existing = {
      catalog_version: 1,
      sources: [{ name: 'Shared', repository: 'https://github.com/example/existing' }],
    };
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'catalogSources.json'), JSON.stringify(existing));
    const summary = importCatalogConfigurationText(
      JSON.stringify({
        catalog_version: 1,
        sources: [
          { name: 'Shared', repository: 'https://github.com/example/other' },
          { name: 'Renamed', repository: 'https://github.com/example/existing' },
          { name: 'New', repository: 'https://github.com/example/new' },
          { name: 'Offline', repository: 'https://github.com/example/offline' },
        ],
      }),
      (names) => {
        assert.deepEqual(names, ['New', 'Offline']);
        return {
          refreshed: [{ name: 'New', count: 2 }],
          failures: [{ name: 'Offline', message: 'network unavailable' }],
        };
      },
    );
    assert.deepEqual(summary, {
      added: ['New', 'Offline'],
      ignored: [
        { name: 'Shared', reason: 'Catalog name already exists.' },
        {
          name: 'Renamed',
          reason: 'Repository already registered as another catalog (example/existing).',
        },
      ],
      refreshed: [{ name: 'New', count: 2 }],
      refreshFailures: [{ name: 'Offline', message: 'network unavailable' }],
    });
    assert.deepEqual(
      loadUserSourceConfiguration().map(({ name }) => name),
      ['Shared', 'New', 'Offline'],
    );
  } finally {
    if (previousConfig === undefined) delete process.env.KITIA_CONFIG_DIR;
    else process.env.KITIA_CONFIG_DIR = previousConfig;
  }
});

test('user source configuration rejects duplicate names and non-GitHub repositories', () => {
  assert.throws(
    () =>
      validateSourceConfiguration({
        catalog_version: 1,
        sources: [
          { name: 'duplicate', repository: 'https://github.com/example/one' },
          { name: 'Duplicate', repository: 'https://github.com/example/two' },
        ],
      }),
    /Duplicate catalog source name/,
  );
  assert.deepEqual(
    validateSourceConfiguration({
      catalog_version: 1,
      sources: [
        { name: 'Test', repository: 'https://github.com/example/test' },
        { name: 'AI Kit', repository: 'https://github.com/example/ai-kit' },
        { name: 'skills_catalog.v2', repository: 'https://github.com/example/skills' },
      ],
    }).map(({ name }) => name),
    ['Test', 'AI Kit', 'skills_catalog.v2'],
  );
  assert.throws(
    () =>
      validateSourceConfiguration({
        catalog_version: 1,
        sources: [{ name: 'unsupported', repository: 'https://example.com/team/repo' }],
      }),
    /Invalid GitHub source repository URL/,
  );
});
