'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { repositoryId, isValidCatalogName, validateSourceConfiguration } = require('../model.ts');
const { CatalogError } = require('../../resources/model.ts');

test('validates catalog names, GitHub URLs, and unique source configuration', () => {
  assert.equal(isValidCatalogName('Team Catalog'), true);
  assert.equal(isValidCatalogName('bad/name'), false);
  assert.equal(repositoryId('https://github.com/owner/repo.git'), 'owner/repo');
  assert.throws(() => repositoryId('http://github.com/owner/repo'), CatalogError);
  assert.throws(
    () =>
      validateSourceConfiguration({
        catalog_version: 1,
        sources: [
          { name: 'one', repository: 'https://github.com/owner/repo' },
          { name: 'ONE', repository: 'https://github.com/other/repo' },
        ],
      }),
    CatalogError,
  );
});
