import crypto, { KeyObject } from 'node:crypto';

import { CatalogError } from '../resources/model.js';
const COLLECTION_SIGNATURE_DOMAIN = Buffer.from('Kitia resource collection signature v1\0', 'utf8');
interface CollectionSignatureEnvelope {
  signature_version: 1;
  algorithm: 'Ed25519';
  key_id: string;
  value: string;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value */
function canonicalJson(value: unknown): string {
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
    !isRecord(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new CatalogError('Collection signature payload must contain only JSON values');
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}

function collectionSignaturePayload(manifest: unknown) {
  if (!isRecord(manifest) || manifest.collection_version !== 1) {
    throw new CatalogError('Collection signature requires collection_version: 1');
  }
  const payload: Record<string, unknown> = {};
  for (const key of Object.keys(manifest)) {
    if (key !== 'signature') payload[key] = manifest[key];
  }
  return Buffer.concat([COLLECTION_SIGNATURE_DOMAIN, Buffer.from(canonicalJson(payload), 'utf8')]);
}

function publicKeyObject(input: string | Buffer | KeyObject): KeyObject {
  let publicKey: KeyObject;
  try {
    publicKey = input instanceof KeyObject && input.type === 'public' ? input : crypto.createPublicKey(input);
  } catch (error) {
    throw new CatalogError(`Invalid collection public key: ${(error as { message: string }).message}`);
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new CatalogError('Collection signatures require an Ed25519 public key');
  }
  return publicKey;
}

function collectionKeyId(key: string | Buffer | KeyObject) {
  const publicKey = publicKeyObject(key);
  const der = publicKey.export({ format: 'der', type: 'spki' });
  return `sha256:${crypto.createHash('sha256').update(der).digest('hex')}`;
}

function validateCollectionSignatureEnvelope(signature: unknown): asserts signature is CollectionSignatureEnvelope {
  if (
    !isRecord(signature) ||
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

function signCollectionManifest(manifest: unknown, privateKeyInput: string | Buffer | KeyObject) {
  if (!isRecord(manifest) || Object.hasOwn(manifest, 'signature')) {
    throw new CatalogError('Sign an unsigned collection manifest object');
  }
  let privateKey: KeyObject;
  try {
    privateKey =
      privateKeyInput instanceof KeyObject && privateKeyInput.type === 'private'
        ? privateKeyInput
        : crypto.createPrivateKey(privateKeyInput as string | Buffer);
  } catch (error) {
    throw new CatalogError(`Invalid collection private key: ${(error as { message: string }).message}`);
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

function verifyCollectionSignature(
  manifest: unknown,
  trustedPublicKey: string | Buffer | KeyObject | null | undefined,
) {
  const value = isRecord(manifest) ? manifest : undefined;
  if (!value || !Object.hasOwn(value, 'signature')) {
    if (trustedPublicKey !== undefined && trustedPublicKey !== null) {
      throw new CatalogError('A trusted collection key was provided, but the collection is unsigned');
    }
    return { signed: false, key_id: null };
  }
  if (trustedPublicKey === undefined || trustedPublicKey === null) {
    throw new CatalogError('Signed collection requires a public key explicitly approved out of band');
  }
  const signature = value.signature;
  validateCollectionSignatureEnvelope(signature);
  const publicKey = publicKeyObject(trustedPublicKey);
  const keyId = collectionKeyId(publicKey);
  if (signature.key_id !== keyId) {
    throw new CatalogError(`Approved collection key does not match signer key_id ${signature.key_id}`);
  }
  let verified = false;
  try {
    verified = crypto.verify(
      null,
      collectionSignaturePayload(value),
      publicKey,
      Buffer.from(signature.value, 'base64'),
    );
  } catch (error) {
    throw new CatalogError(`Cannot verify collection signature: ${(error as { message: string }).message}`);
  }
  if (!verified) throw new CatalogError('Collection signature verification failed');
  return { signed: true, key_id: keyId };
}

export {
  canonicalJson,
  collectionSignaturePayload,
  collectionKeyId,
  validateCollectionSignatureEnvelope,
  signCollectionManifest,
  verifyCollectionSignature,
};
