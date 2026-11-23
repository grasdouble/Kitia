'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parseArguments } = require('../arguments.ts');
const { listCatalogResources } = require('../../core/resources/queries.ts');

const resources = [
  {
    id: 'mit-only',
    kind: 'skill',
    catalog: 'licenses',
    description: 'MIT-only test resource.',
    license_status: 'MIT',
    license_spdx: 'MIT',
  },
  {
    id: 'dual-license',
    kind: 'skill',
    catalog: 'licenses',
    description: 'Dual-license test resource.',
    license_status: 'MIT OR Apache-2.0',
    license_spdx: 'MIT OR Apache-2.0',
  },
  {
    id: 'custom-license',
    kind: 'skill',
    catalog: 'licenses',
    description: 'Custom-license test resource.',
    license_status: 'Acme  commercial license',
  },
  {
    id: 'no-license',
    kind: 'skill',
    catalog: 'licenses',
    description: 'No-license test resource.',
    license_status: 'not-declared',
  },
];

test('CLI --license arguments filter indexed resources by SPDX expression or declared value', () => {
  assert.deepEqual(
    listCatalogResources(resources, parseArguments(['list', '--license', 'Apache-2.0'])).map(({ id }) => id),
    ['dual-license'],
  );
  assert.deepEqual(
    listCatalogResources(resources, parseArguments(['search', 'mit', '--license', 'MIT'])).map(({ id }) => id),
    ['mit-only', 'dual-license'],
  );
  assert.deepEqual(
    listCatalogResources(resources, parseArguments(['list', '--license', 'Acme  commercial license'])).map(
      ({ id }) => id,
    ),
    ['custom-license'],
  );
  assert.deepEqual(
    listCatalogResources(resources, parseArguments(['list', '--license', 'not-declared'])).map(({ id }) => id),
    ['no-license'],
  );
});
