'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validateSourceCatalog } = require('../manifest.ts');
test('source catalog enriches valid resources and rejects traversal paths', () => {
  const base = {
    catalog_version: 1,
    catalog_name: 'tools',
    source_repository: 'owner/repo',
    source_ref: 'a'.repeat(40),
    resources: [
      { id: 'demo', kind: 'skill', source_path: 'skills/demo', description: ' Demo ', license_status: 'MIT' },
    ],
  };
  const [r] = validateSourceCatalog(base, { name: 'tools', repositoryId: 'owner/repo' });
  assert.equal(r.description, 'Demo');
  assert.equal(r.license_spdx, 'MIT');
  assert.throws(
    () =>
      validateSourceCatalog(
        { ...base, resources: [{ ...base.resources[0], source_path: '../demo' }] },
        { name: 'tools', repositoryId: 'owner/repo' },
      ),
    /safe repository-relative/,
  );
});
