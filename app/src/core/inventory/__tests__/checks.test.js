'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { checkInstalledResources, collectInstalledScopes } = require('../checks.ts');
const { CatalogError } = require('../../resources/model.ts');

test('inventory checks reject missing targets and collect scan failures by scope', () => {
  assert.throws(() => checkInstalledResources('/missing-kit-ia-target', []), CatalogError);
  const result = collectInstalledScopes({ project: '/missing-kit-ia-target' }, []);
  assert.equal(result.resources.length, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].scope, 'project');
});
