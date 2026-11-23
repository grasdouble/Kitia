'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const { loadUserSourceConfiguration } = require('../dist/core/catalogs/config.js');
const { loadSourceCatalogsFromDirectory } = require('../dist/core/catalogs/indexes.js');

let temporary;
const previousConfig = process.env.KITIA_CONFIG_DIR;
afterEach(() => {
  if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
  temporary = null;
  if (previousConfig === undefined) delete process.env.KITIA_CONFIG_DIR;
  else process.env.KITIA_CONFIG_DIR = previousConfig;
});

const sourceRef = '0123456789abcdef0123456789abcdef01234567';

test('real CLI collection export and import round-trip a local pinned catalog fixture', () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-collections-cli-'));
  const source = { name: 'Team', repository: 'https://github.com/example/tools' };
  const registry = { catalog_version: 1, sources: [source] };
  const sourceConfig = path.join(temporary, 'source-config');
  const sourceIndex = path.join(sourceConfig, 'source-catalogs');
  fs.mkdirSync(sourceIndex, { recursive: true });
  fs.writeFileSync(path.join(sourceConfig, 'catalogSources.json'), JSON.stringify(registry));
  fs.writeFileSync(path.join(sourceIndex, 'catalogSources.json'), JSON.stringify(registry));
  fs.writeFileSync(
    path.join(sourceIndex, 'Team.json'),
    JSON.stringify({
      catalog_version: 1,
      catalog_name: 'Team',
      source_repository: 'example/tools',
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
    }),
  );
  const collectionFile = path.join(temporary, 'team.json');
  const cli = path.resolve(__dirname, '../dist/kitia.js');
  const run = (config, ...args) =>
    execFileSync(process.execPath, [cli, ...args], {
      encoding: 'utf8',
      env: { ...process.env, KITIA_CONFIG_DIR: config },
    });
  const exported = run(sourceConfig, 'collection', 'export', collectionFile, 'Team:agent:release-helper');
  assert.match(exported, /Exported resource collection/);
  const manifest = JSON.parse(fs.readFileSync(collectionFile, 'utf8'));
  assert.equal(manifest.catalogs[0].source_ref, sourceRef);
  assert.equal(JSON.stringify(manifest).includes('upstream body'), false);

  const importedConfig = path.join(temporary, 'imported-config');
  const imported = run(importedConfig, 'collection', 'import', collectionFile);
  assert.match(imported, /Imported resource collection/);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(importedConfig, 'catalogSources.json'), 'utf8')).sources[0].name,
    'Team',
  );
  process.env.KITIA_CONFIG_DIR = importedConfig;
  const importedResources = loadSourceCatalogsFromDirectory(
    path.join(importedConfig, 'source-catalogs'),
    loadUserSourceConfiguration(),
  );
  assert.equal(importedResources[0].source_ref, sourceRef);
});

test('real CLI signs exports and rejects missing, incorrect, or altered approvals', () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-collections-cli-signature-'));
  const source = { name: 'Team', repository: 'https://github.com/example/tools' };
  const registry = { catalog_version: 1, sources: [source] };
  const sourceConfig = path.join(temporary, 'source-config');
  const sourceIndex = path.join(sourceConfig, 'source-catalogs');
  fs.mkdirSync(sourceIndex, { recursive: true });
  fs.writeFileSync(path.join(sourceConfig, 'catalogSources.json'), JSON.stringify(registry));
  fs.writeFileSync(path.join(sourceIndex, 'catalogSources.json'), JSON.stringify(registry));
  fs.writeFileSync(
    path.join(sourceIndex, 'Team.json'),
    JSON.stringify({
      catalog_version: 1,
      catalog_name: 'Team',
      source_repository: 'example/tools',
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
    }),
  );

  const keys = crypto.generateKeyPairSync('ed25519');
  const wrongKeys = crypto.generateKeyPairSync('ed25519');
  const privateKeyPath = path.join(temporary, 'signer-private.pem');
  const publicKeyPath = path.join(temporary, 'signer-public.pem');
  const wrongPublicKeyPath = path.join(temporary, 'wrong-public.pem');
  fs.writeFileSync(privateKeyPath, keys.privateKey.export({ format: 'pem', type: 'pkcs8' }), {
    mode: 0o600,
  });
  fs.writeFileSync(publicKeyPath, keys.publicKey.export({ format: 'pem', type: 'spki' }));
  fs.writeFileSync(wrongPublicKeyPath, wrongKeys.publicKey.export({ format: 'pem', type: 'spki' }));

  const cli = path.resolve(__dirname, '../dist/kitia.js');
  const run = (config, ...args) =>
    execFileSync(process.execPath, [cli, ...args], {
      encoding: 'utf8',
      env: { ...process.env, KITIA_CONFIG_DIR: config },
    });
  const signedFile = path.join(temporary, 'signed.json');
  const exported = run(
    sourceConfig,
    'collection',
    'export',
    signedFile,
    'Team:agent:release-helper',
    '--signing-key',
    privateKeyPath,
  );
  const signedManifest = JSON.parse(fs.readFileSync(signedFile, 'utf8'));
  assert.match(exported, new RegExp(signedManifest.signature.key_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(signedManifest.signature.algorithm, 'Ed25519');

  const expectFailure = (config, expected, ...args) => {
    assert.throws(
      () => run(config, 'collection', 'import', ...args),
      (error) => {
        assert.equal(error.status, 1);
        assert.match(error.stderr, expected);
        return true;
      },
    );
    assert.equal(fs.existsSync(path.join(config, 'catalogSources.json')), false);
  };
  expectFailure(path.join(temporary, 'missing-key'), /explicitly approved out of band/, signedFile);
  expectFailure(
    path.join(temporary, 'wrong-key'),
    /does not match signer key_id/,
    signedFile,
    '--trusted-key',
    wrongPublicKeyPath,
  );

  const alteredFile = path.join(temporary, 'altered.json');
  const altered = structuredClone(signedManifest);
  altered.catalogs[0].resources[0].description = 'Changed after signing';
  fs.writeFileSync(alteredFile, JSON.stringify(altered));
  expectFailure(
    path.join(temporary, 'altered'),
    /signature verification failed/,
    alteredFile,
    '--trusted-key',
    publicKeyPath,
  );

  const importedConfig = path.join(temporary, 'approved-import');
  const imported = run(importedConfig, 'collection', 'import', signedFile, '--trusted-key', publicKeyPath);
  assert.match(imported, /Imported resource collection/);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(importedConfig, 'catalogSources.json'), 'utf8')).sources[0].name,
    'Team',
  );
});
