'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { collectionData, validateCollectionManifest } = require('../manifest.ts');
test('collection manifest validates pinned catalog resources', () => {
  const m = {
    collection_version: 1,
    catalogs: [
      {
        name: 'tools',
        repository: 'https://github.com/owner/repo',
        source_ref: 'a'.repeat(40),
        resources: [
          { kind: 'skill', id: 'demo', source_path: 'skills/demo', description: 'Demo', license_status: 'MIT' },
        ],
      },
    ],
  };
  const [out] = validateCollectionManifest(m);
  assert.equal(out.index.resources[0].id, 'demo');
});
test('collection data groups selected resources and rejects missing selections', () => {
  const source = { name: 'tools', repository: 'https://github.com/owner/repo' };
  const resource = {
    catalog: 'tools',
    kind: 'skill',
    id: 'demo',
    source_ref: 'a'.repeat(40),
    source_path: 'skills/demo',
  };
  assert.equal(collectionData([resource], [source], ['tools:skill:demo']).catalogs[0].resources[0].id, 'demo');
  assert.throws(() => collectionData([], [], []), /select at least one/);
  assert.throws(() => validateCollectionManifest({ collection_version: 1, catalogs: [] }), /non-empty/);
});
