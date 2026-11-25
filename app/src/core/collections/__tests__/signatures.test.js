'use strict';
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { test } = require('node:test');
const { signCollectionManifest, verifyCollectionSignature, collectionKeyId } = require('../signatures.ts');
test('collection signatures verify canonical payloads and reject tampering', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const manifest = { collection_version: 1, catalogs: [{ name: 'tools' }] };
  const signed = signCollectionManifest(manifest, privateKey);
  assert.deepEqual(verifyCollectionSignature(signed, publicKey), { signed: true, key_id: collectionKeyId(publicKey) });
  assert.throws(() => verifyCollectionSignature({ ...signed, catalogs: [] }, publicKey), /verification failed/);
  assert.deepEqual(verifyCollectionSignature(manifest), { signed: false, key_id: null });
});
