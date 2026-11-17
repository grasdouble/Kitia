'use strict';

const { CatalogError } = require('../resources/model.js');
const crypto = require('node:crypto');
const COLLECTION_SIGNATURE_DOMAIN = Buffer.from('Kitia resource collection signature v1\0', 'utf8');

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CatalogError('Collection signature payload contains a non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const entries = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw new CatalogError('Collection signature payload contains a sparse array');
      entries.push(canonicalJson(value[index]));
    }
    return `[${entries.join(',')}]`;
  }
  if (
    !value ||
    typeof value !== 'object' ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new CatalogError('Collection signature payload must contain only JSON values');
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}

function collectionSignaturePayload(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || manifest.collection_version !== 1) {
    throw new CatalogError('Collection signature requires collection_version: 1');
  }
  const payload = {};
  for (const key of Object.keys(manifest)) {
    if (key !== 'signature') payload[key] = manifest[key];
  }
  return Buffer.concat([COLLECTION_SIGNATURE_DOMAIN, Buffer.from(canonicalJson(payload), 'utf8')]);
}

function publicKeyObject(input) {
  let publicKey;
  try {
    publicKey = input instanceof crypto.KeyObject && input.type === 'public' ? input : crypto.createPublicKey(input);
  } catch (error) {
    throw new CatalogError(`Invalid collection public key: ${error.message}`);
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new CatalogError('Collection signatures require an Ed25519 public key');
  }
  return publicKey;
}

function collectionKeyId(key) {
  const publicKey = publicKeyObject(key);
  const der = publicKey.export({ format: 'der', type: 'spki' });
  return `sha256:${crypto.createHash('sha256').update(der).digest('hex')}`;
}

function validateCollectionSignatureEnvelope(signature) {
  if (
    !signature ||
    typeof signature !== 'object' ||
    Array.isArray(signature) ||
    Object.keys(signature).some((key) => !['signature_version', 'algorithm', 'key_id', 'value'].includes(key)) ||
    signature.signature_version !== 1 ||
    signature.algorithm !== 'Ed25519' ||
    typeof signature.key_id !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(signature.key_id) ||
    typeof signature.value !== 'string'
  ) {
    throw new CatalogError('Collection signature must use signature_version: 1 and Ed25519');
  }
  const bytes = Buffer.from(signature.value, 'base64');
  if (bytes.length !== 64 || bytes.toString('base64') !== signature.value) {
    throw new CatalogError('Collection signature value must be a canonical Ed25519 signature');
  }
}

function signCollectionManifest(manifest, privateKeyInput) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || Object.hasOwn(manifest, 'signature')) {
    throw new CatalogError('Sign an unsigned collection manifest object');
  }
  let privateKey;
  try {
    privateKey =
      privateKeyInput instanceof crypto.KeyObject && privateKeyInput.type === 'private'
        ? privateKeyInput
        : crypto.createPrivateKey(privateKeyInput);
  } catch (error) {
    throw new CatalogError(`Invalid collection private key: ${error.message}`);
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new CatalogError('Collection signatures require an Ed25519 private key');
  }
  const publicKey = crypto.createPublicKey(privateKey);
  const signature = crypto.sign(null, collectionSignaturePayload(manifest), privateKey);
  return {
    ...manifest,
    signature: {
      signature_version: 1,
      algorithm: 'Ed25519',
      key_id: collectionKeyId(publicKey),
      value: signature.toString('base64'),
    },
  };
}

function verifyCollectionSignature(manifest, trustedPublicKey) {
  const isObject = manifest && typeof manifest === 'object' && !Array.isArray(manifest);
  const hasSignature = isObject && Object.hasOwn(manifest, 'signature');
  const hasTrustedKey = trustedPublicKey !== undefined && trustedPublicKey !== null;
  if (!hasSignature) {
    if (hasTrustedKey) throw new CatalogError('A trusted collection key was provided, but the collection is unsigned');
    return { signed: false, key_id: null };
  }
  if (!hasTrustedKey) {
    throw new CatalogError('Signed collection requires a public key explicitly approved out of band');
  }
  validateCollectionSignatureEnvelope(manifest.signature);
  const publicKey = publicKeyObject(trustedPublicKey);
  const keyId = collectionKeyId(publicKey);
  if (manifest.signature.key_id !== keyId) {
    throw new CatalogError(`Approved collection key does not match signer key_id ${manifest.signature.key_id}`);
  }
  let verified = false;
  try {
    verified = crypto.verify(
      null,
      collectionSignaturePayload(manifest),
      publicKey,
      Buffer.from(manifest.signature.value, 'base64'),
    );
  } catch (error) {
    throw new CatalogError(`Cannot verify collection signature: ${error.message}`);
  }
  if (!verified) throw new CatalogError('Collection signature verification failed');
  return { signed: true, key_id: keyId };
}

module.exports = {
  canonicalJson,
  collectionSignaturePayload,
  collectionKeyId,
  validateCollectionSignatureEnvelope,
  signCollectionManifest,
  verifyCollectionSignature,
};
