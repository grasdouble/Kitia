'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const { collectionData, validateCollectionManifest } = require('../../core/collections/manifest.ts');
const {
  collectionKeyId,
  signCollectionManifest,
  verifyCollectionSignature,
} = require('../../core/collections/signatures.ts');
const { importCollectionText } = require('../../core/collections/import.ts');
const { loadUserSourceConfiguration } = require('../../core/catalogs/config.ts');
const { loadSourceCatalogsFromDirectory } = require('../../core/catalogs/indexes.ts');

let temporary;
const previousConfig = process.env.KITIA_CONFIG_DIR;
afterEach(() => {
  if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
  temporary = null;
  if (previousConfig === undefined) delete process.env.KITIA_CONFIG_DIR;
  else process.env.KITIA_CONFIG_DIR = previousConfig;
});

const sourceRef = '0123456789abcdef0123456789abcdef01234567';
const sourceResource = {
  catalog: 'Team',
  kind: 'agent',
  id: 'release-helper',
  source_path: 'agents/release-helper.md',
  source_repository: 'example/tools',
  source_ref: sourceRef,
  description: 'Release helper',
  license_status: 'MIT',
};
function collectionManifest() {
  return collectionData(
    [sourceResource],
    [
      {
        name: 'Team',
        repository: 'https://github.com/example/tools',
        repositoryId: 'example/tools',
        mode: 'basic',
        entries: [],
      },
    ],
    ['Team:agent:release-helper'],
  );
}

function createEd25519Keys() {
  return crypto.generateKeyPairSync('ed25519');
}
test('signed collection import verifies canonical Ed25519 signature with the approved public key', () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-collections-signed-'));
  process.env.KITIA_CONFIG_DIR = path.join(temporary, 'config');
  const keys = createEd25519Keys();
  const manifest = signCollectionManifest(collectionManifest(), keys.privateKey);
  assert.equal(manifest.signature.key_id, collectionKeyId(keys.publicKey));
  assert.deepEqual(verifyCollectionSignature(manifest, keys.publicKey), {
    signed: true,
    key_id: manifest.signature.key_id,
  });
  assert.equal(validateCollectionManifest(manifest).length, 1);
  const reordered = {
    signature: Object.fromEntries(Object.entries(manifest.signature).reverse()),
    catalogs: manifest.catalogs.map((catalog) => Object.fromEntries(Object.entries(catalog).reverse())),
    collection_version: manifest.collection_version,
  };
  assert.equal(verifyCollectionSignature(reordered, keys.publicKey).signed, true);
  assert.throws(() => importCollectionText(JSON.stringify(manifest)), /explicitly approved out of band/);
  assert.deepEqual(importCollectionText(JSON.stringify(manifest), fs, { trustedKey: keys.publicKey }), ['Team']);
});

test('signed collection rejects altered data and a different approved key before configuration writes', () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-collections-signature-reject-'));
  process.env.KITIA_CONFIG_DIR = path.join(temporary, 'config');
  const signer = createEd25519Keys();
  const wrongKey = createEd25519Keys();
  const manifest = signCollectionManifest(collectionManifest(), signer.privateKey);
  assert.throws(() => verifyCollectionSignature(manifest, wrongKey.publicKey), /does not match signer key_id/);
  assert.throws(
    () => importCollectionText(JSON.stringify(manifest), fs, { trustedKey: wrongKey.publicKey }),
    /does not match signer key_id/,
  );
  const altered = structuredClone(manifest);
  altered.catalogs[0].resources[0].description = 'Altered after signing';
  assert.throws(
    () => importCollectionText(JSON.stringify(altered), fs, { trustedKey: signer.publicKey }),
    /signature verification failed/,
  );
  assert.equal(fs.existsSync(path.join(process.env.KITIA_CONFIG_DIR, 'catalogSources.json')), false);
});

test('unsigned collections remain compatible unless a trusted key is required', () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-collections-unsigned-'));
  process.env.KITIA_CONFIG_DIR = path.join(temporary, 'config');
  const manifest = collectionManifest();
  const keys = createEd25519Keys();
  assert.deepEqual(verifyCollectionSignature(manifest), { signed: false, key_id: null });
  assert.throws(() => verifyCollectionSignature(manifest, keys.publicKey), /collection is unsigned/);
  assert.throws(
    () => importCollectionText(JSON.stringify(manifest), fs, { trustedKey: keys.publicKey }),
    /collection is unsigned/,
  );
  assert.deepEqual(importCollectionText(JSON.stringify(manifest)), ['Team']);
});

test('collection export writes pinned references and import restores a minimal selected index', () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-collections-'));
  process.env.KITIA_CONFIG_DIR = path.join(temporary, 'config');
  const sources = [
    {
      name: 'Team',
      repository: 'https://github.com/example/tools',
      repositoryId: 'example/tools',
      mode: 'basic',
      entries: [],
    },
  ];
  const manifest = collectionData([sourceResource], sources, ['Team:agent:release-helper']);
  assert.deepEqual(manifest, {
    collection_version: 1,
    catalogs: [
      {
        name: 'Team',
        repository: 'https://github.com/example/tools',
        mode: 'basic',
        source_ref: sourceRef,
        resources: [
          {
            kind: 'agent',
            id: 'release-helper',
            source_path: 'agents/release-helper.md',
            description: 'Release helper',
            license_status: 'MIT',
          },
        ],
      },
    ],
  });
  assert.equal(JSON.stringify(manifest).includes('upstream body'), false);
  assert.deepEqual(importCollectionText(JSON.stringify(manifest)), ['Team']);
  assert.deepEqual(
    loadUserSourceConfiguration().map(({ name, repositoryId }) => [name, repositoryId]),
    [['Team', 'example/tools']],
  );
  const cached = loadSourceCatalogsFromDirectory(
    path.join(process.env.KITIA_CONFIG_DIR, 'source-catalogs'),
    loadUserSourceConfiguration(),
  );
  assert.equal(cached.length, 1);
  assert.equal(cached[0].source_ref, sourceRef);
  assert.equal(cached[0].source_path, 'agents/release-helper.md');
});

test('collection import validates all references before changing configuration', () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-collections-invalid-'));
  process.env.KITIA_CONFIG_DIR = path.join(temporary, 'config');
  const invalid = {
    collection_version: 1,
    catalogs: [
      {
        name: 'Good',
        repository: 'https://github.com/example/good',
        source_ref: sourceRef,
        resources: [
          {
            kind: 'agent',
            id: 'helper',
            source_path: 'agents/helper.md',
            description: 'Helper',
            license_status: 'MIT',
          },
        ],
      },
      {
        name: 'Bad',
        repository: 'https://github.com/example/bad',
        source_ref: 'not-a-commit',
        resources: [],
      },
    ],
  };
  assert.throws(() => importCollectionText(JSON.stringify(invalid)), /full 40-character commit SHA/);
  assert.equal(fs.existsSync(path.join(process.env.KITIA_CONFIG_DIR, 'catalogSources.json')), false);
  assert.throws(
    () =>
      validateCollectionManifest({
        collection_version: 1,
        catalogs: [
          {
            ...invalid.catalogs[0],
            resources: [{ ...invalid.catalogs[0].resources[0], source_path: '../outside.md' }],
          },
        ],
      }),
    /safe repository-relative/,
  );
});

test('collection publication rolls back staged indexes and preserves both registries on rename failure', () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-collections-rollback-'));
  const config = path.join(temporary, 'config');
  const indexDirectory = path.join(config, 'source-catalogs');
  process.env.KITIA_CONFIG_DIR = config;
  fs.mkdirSync(indexDirectory, { recursive: true });
  const rootRegistryPath = path.join(config, 'catalogSources.json');
  const indexRegistryPath = path.join(indexDirectory, 'catalogSources.json');
  const originalRootRegistry = `${JSON.stringify({ catalog_version: 1, sources: [] }, null, 2)}\n`;
  const originalIndexRegistry = `{"catalog_version":1,"sources":[]}\n`;
  fs.writeFileSync(rootRegistryPath, originalRootRegistry);
  fs.writeFileSync(indexRegistryPath, originalIndexRegistry);
  const manifest = collectionData(
    [sourceResource],
    [
      {
        name: 'Team',
        repository: 'https://github.com/example/tools',
        repositoryId: 'example/tools',
        mode: 'basic',
        entries: [],
      },
    ],
    ['Team:agent:release-helper'],
  );
  let injected = false;
  const failingFs = new Proxy(fs, {
    get(target, property) {
      if (property === 'renameSync')
        return (from, to) => {
          if (to === rootRegistryPath && !injected) {
            injected = true;
            throw new Error('injected publication failure');
          }
          return fs.renameSync(from, to);
        };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  assert.throws(() => importCollectionText(JSON.stringify(manifest), failingFs), /injected publication failure/);
  assert.equal(injected, true);
  assert.equal(fs.readFileSync(rootRegistryPath, 'utf8'), originalRootRegistry);
  assert.equal(fs.readFileSync(indexRegistryPath, 'utf8'), originalIndexRegistry);
  assert.equal(fs.existsSync(path.join(indexDirectory, 'Team.json')), false);
  assert.equal(
    fs.readdirSync(config).some((name) => /\.(stage|backup)$/.test(name)),
    false,
  );
  assert.equal(
    fs.readdirSync(indexDirectory).some((name) => /\.(stage|backup)$/.test(name)),
    false,
  );
});
