"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { CatalogError, validateSourceCatalog } = require("./resources/index.js");
const {
  catalogNameKey, repositoryId, validateSourceConfiguration, loadUserSourceConfiguration,
  userCatalogDirectory, userCatalogIndexDirectory,
} = require("./sources/config.js");

const COLLECTION_SIGNATURE_DOMAIN = Buffer.from("Kitia resource collection signature v1\0", "utf8");

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new CatalogError("Collection signature payload contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const entries = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw new CatalogError("Collection signature payload contains a sparse array");
      entries.push(canonicalJson(value[index]));
    }
    return `[${entries.join(",")}]`;
  }
  if (!value || typeof value !== "object" ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new CatalogError("Collection signature payload must contain only JSON values");
  }
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function collectionSignaturePayload(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || manifest.collection_version !== 1) {
    throw new CatalogError("Collection signature requires collection_version: 1");
  }
  const payload = {};
  for (const key of Object.keys(manifest)) {
    if (key !== "signature") payload[key] = manifest[key];
  }
  return Buffer.concat([COLLECTION_SIGNATURE_DOMAIN, Buffer.from(canonicalJson(payload), "utf8")]);
}

function publicKeyObject(input) {
  let publicKey;
  try {
    publicKey = input instanceof crypto.KeyObject && input.type === "public"
      ? input
      : crypto.createPublicKey(input);
  } catch (error) {
    throw new CatalogError(`Invalid collection public key: ${error.message}`);
  }
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new CatalogError("Collection signatures require an Ed25519 public key");
  }
  return publicKey;
}

function collectionKeyId(key) {
  const publicKey = publicKeyObject(key);
  const der = publicKey.export({ format: "der", type: "spki" });
  return `sha256:${crypto.createHash("sha256").update(der).digest("hex")}`;
}

function validateCollectionSignatureEnvelope(signature) {
  if (!signature || typeof signature !== "object" || Array.isArray(signature) ||
      Object.keys(signature).some((key) => !["signature_version", "algorithm", "key_id", "value"].includes(key)) ||
      signature.signature_version !== 1 || signature.algorithm !== "Ed25519" ||
      typeof signature.key_id !== "string" || !/^sha256:[a-f0-9]{64}$/.test(signature.key_id) ||
      typeof signature.value !== "string") {
    throw new CatalogError("Collection signature must use signature_version: 1 and Ed25519");
  }
  const bytes = Buffer.from(signature.value, "base64");
  if (bytes.length !== 64 || bytes.toString("base64") !== signature.value) {
    throw new CatalogError("Collection signature value must be a canonical Ed25519 signature");
  }
}

function signCollectionManifest(manifest, privateKeyInput) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) ||
      Object.hasOwn(manifest, "signature")) {
    throw new CatalogError("Sign an unsigned collection manifest object");
  }
  let privateKey;
  try {
    privateKey = privateKeyInput instanceof crypto.KeyObject && privateKeyInput.type === "private"
      ? privateKeyInput
      : crypto.createPrivateKey(privateKeyInput);
  } catch (error) {
    throw new CatalogError(`Invalid collection private key: ${error.message}`);
  }
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new CatalogError("Collection signatures require an Ed25519 private key");
  }
  const publicKey = crypto.createPublicKey(privateKey);
  const signature = crypto.sign(null, collectionSignaturePayload(manifest), privateKey);
  return {
    ...manifest,
    signature: {
      signature_version: 1,
      algorithm: "Ed25519",
      key_id: collectionKeyId(publicKey),
      value: signature.toString("base64"),
    },
  };
}

function verifyCollectionSignature(manifest, trustedPublicKey) {
  const isObject = manifest && typeof manifest === "object" && !Array.isArray(manifest);
  const hasSignature = isObject && Object.hasOwn(manifest, "signature");
  const hasTrustedKey = trustedPublicKey !== undefined && trustedPublicKey !== null;
  if (!hasSignature) {
    if (hasTrustedKey) throw new CatalogError("A trusted collection key was provided, but the collection is unsigned");
    return { signed: false, key_id: null };
  }
  if (!hasTrustedKey) {
    throw new CatalogError("Signed collection requires a public key explicitly approved out of band");
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
      Buffer.from(manifest.signature.value, "base64"),
    );
  } catch (error) {
    throw new CatalogError(`Cannot verify collection signature: ${error.message}`);
  }
  if (!verified) throw new CatalogError("Collection signature verification failed");
  return { signed: true, key_id: keyId };
}

function collectionData(resources, sources, selectors) {
  const byKey = new Map(resources.map((resource) => [
    `${resource.catalog}:${resource.kind}:${resource.id}`, resource,
  ]));
  const selected = selectors.map((selector) => {
    const resource = byKey.get(selector);
    if (!resource) throw new CatalogError(`Collection resource is not available: ${selector}`, "RESOURCE_NOT_FOUND");
    return resource;
  });
  if (!selected.length) throw new CatalogError("A resource collection must select at least one resource");
  const grouped = new Map();
  for (const resource of selected) {
    const source = sources.find(({ name }) => name === resource.catalog);
    if (!source) throw new CatalogError(`Resource catalog is not configured: ${resource.catalog}`);
    if (!/^[a-f0-9]{40}$/i.test(resource.source_ref || "")) {
      throw new CatalogError(`Resource has no full commit pin: ${resource.catalog}:${resource.kind}:${resource.id}`);
    }
    const existing = grouped.get(source.name);
    if (existing && existing.source_ref.toLowerCase() !== resource.source_ref.toLowerCase()) {
      throw new CatalogError(`Catalog ${source.name} has resources pinned to different commits`);
    }
    const catalog = existing || {
      name: source.name,
      repository: source.repository,
      mode: source.mode,
      ...(source.mode === "custom" ? { entries: source.entries } : {}),
      source_ref: resource.source_ref.toLowerCase(),
      resources: [],
    };
    catalog.resources.push({
      kind: resource.kind,
      id: resource.id,
      source_path: resource.source_path,
      description: resource.description,
      license_status: resource.license_status,
      ...(resource.kind === "instruction" ? { apply_to: resource.apply_to || resource.applyTo } : {}),
    });
    grouped.set(source.name, catalog);
  }
  return { collection_version: 1, catalogs: [...grouped.values()] };
}
function validateCollectionManifest(input) {

  const allowedRootKeys = new Set(["collection_version", "catalogs", "signature"]);
  if (!input || typeof input !== "object" || Array.isArray(input) || input.collection_version !== 1 ||
      Object.keys(input).some((key) => !allowedRootKeys.has(key)) ||
      !Array.isArray(input.catalogs) || !input.catalogs.length) {
    throw new CatalogError("Resource collection must have collection_version: 1 and a non-empty catalogs array");
  }
  if (Object.hasOwn(input, "signature")) validateCollectionSignatureEnvelope(input.signature);
  const names = new Set();
  const repositories = new Set();
  const validated = input.catalogs.map((entry, index) => {
    const label = `collection catalogs[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        Object.keys(entry).some((key) => !["name", "repository", "mode", "entries", "source_ref", "resources"].includes(key))) {
      throw new CatalogError(`${label} contains unsupported or invalid fields`);
    }
    const rawSource: Record<string, unknown> = { name: entry.name, repository: entry.repository };
    if (Object.hasOwn(entry, "mode")) rawSource.mode = entry.mode;
    if (Object.hasOwn(entry, "entries")) rawSource.entries = entry.entries;
    const [source] = validateSourceConfiguration({ catalog_version: 1, sources: [rawSource] });
    const nameKey = catalogNameKey(source.name);
    if (names.has(nameKey) || repositories.has(source.repositoryId)) {
      throw new CatalogError(`${label} duplicates a catalog name or repository`);
    }
    names.add(nameKey);
    repositories.add(source.repositoryId);
    if (!/^[a-f0-9]{40}$/i.test(entry.source_ref || "")) {
      throw new CatalogError(`${label}.source_ref must be a full 40-character commit SHA`);
    }
    if (!Array.isArray(entry.resources) || entry.resources.some((resource) =>
      !resource || typeof resource !== "object" || Array.isArray(resource) ||
      Object.keys(resource).some((key) =>
        !["kind", "id", "source_path", "description", "license_status", "apply_to"].includes(key)))) {
      throw new CatalogError(`${label}.resources must contain only resource references and metadata`);
    }
    const indexData = {
      catalog_version: 1,
      catalog_name: source.name,
      source_repository: source.repositoryId,
      source_ref: entry.source_ref.toLowerCase(),
      resources: entry.resources,
    };
    const resources = validateSourceCatalog(indexData, { name: source.name, repositoryId: source.repositoryId, label });
    if (!resources.length) throw new CatalogError(`${label}.resources must not be empty`);
    return {
      source: { name: source.name, repository: source.repository, ...(source.mode === "custom" ? { mode: source.mode, entries: source.entries } : {}) },
      index: indexData,
    };
  });
  return validated;
}

function publishCollectionFiles(files, io) {
  const staged = [];
  const cleanup = () => {
    for (const entry of staged) {
      for (const temporary of [entry.stagePath, entry.backupPath]) {
        if (!temporary) continue;
        try { if (io.existsSync(temporary)) io.unlinkSync(temporary); } catch {}
      }
    }
  };
  try {
    for (const file of files) {
      const suffix = `${process.pid}-${crypto.randomUUID()}`;
      const entry = {
        target: file.target,
        stagePath: `${file.target}.${suffix}.stage`,
        backupPath: null,
        existed: io.existsSync(file.target),
        mode: 0o600,
      };
      staged.push(entry);
      if (entry.existed) {
        const stat = io.lstatSync(file.target);
        if (!stat.isFile() || stat.isSymbolicLink()) {
          throw new CatalogError(`Cannot publish collection over non-regular file: ${file.target}`);
        }
        entry.mode = stat.mode & 0o777;
        entry.backupPath = `${file.target}.${suffix}.backup`;
        io.writeFileSync(entry.backupPath, io.readFileSync(file.target), { flag: "wx", mode: entry.mode });
      }
      io.writeFileSync(entry.stagePath, file.contents, { flag: "wx", mode: entry.mode });
    }
  } catch (error) {
    cleanup();
    throw error;
  }
  try {
    for (const entry of staged) io.renameSync(entry.stagePath, entry.target);
  } catch (error) {
    const rollbackErrors = [];
    for (const entry of [...staged].reverse()) {
      try {
        if (entry.existed) io.renameSync(entry.backupPath, entry.target);
        else if (io.existsSync(entry.target)) io.unlinkSync(entry.target);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError.message);
      }
    }
    cleanup();
    const rollback = rollbackErrors.length ? ` Rollback failed: ${rollbackErrors.join("; ")}` : "";
    throw new CatalogError(`Cannot publish resource collection: ${error.message}.${rollback}`);
  }
  cleanup();
}

function importCollectionText(contents, io = fs, { trustedKey }: { trustedKey?: unknown } = {}) {
  if (typeof contents !== "string" || Buffer.byteLength(contents, "utf8") > 2 * 1024 * 1024) {
    throw new CatalogError("Resource collection must be a JSON file no larger than 2 MiB");
  }
  let manifest;
  try { manifest = JSON.parse(contents); } catch { throw new CatalogError("Resource collection is not valid JSON"); }
  verifyCollectionSignature(manifest, trustedKey);
  const incoming = validateCollectionManifest(manifest);
  const current = loadUserSourceConfiguration();
  const existingNames = new Set(current.map(({ name }) => catalogNameKey(name)));
  const existingRepositories = new Set(current.map(({ repositoryId: id }) => id));
  for (const { source } of incoming) {
    if (existingNames.has(catalogNameKey(source.name)) || existingRepositories.has(repositoryId(source.repository))) {
      throw new CatalogError(`Cannot import collection: catalog name or repository is already configured (${source.name})`);
    }
  }
  // All untrusted manifest data and configuration conflicts are checked before persistent changes.
  const directory = userCatalogDirectory();
  const indexDirectory = userCatalogIndexDirectory();
  const combined = [...current.map(({ name, repository, mode, entries }) => ({
    name, repository, ...(mode === "custom" ? { mode, entries } : {}),
  })), ...incoming.map(({ source }) => source)];
  validateSourceConfiguration({ catalog_version: 1, sources: combined });
  for (const { source } of incoming) {
    if (io.existsSync(path.join(indexDirectory, `${source.name}.json`))) {
      throw new CatalogError(`Cannot import collection: an unregistered catalog index already exists for ${source.name}`);
    }
  }
  io.mkdirSync(directory, { recursive: true, mode: 0o700 });
  io.mkdirSync(indexDirectory, { recursive: true, mode: 0o700 });
  const registry = `${JSON.stringify({ catalog_version: 1, sources: combined }, null, 2)}\n`;
  const files = incoming.map(({ source, index }) => ({
    target: path.join(indexDirectory, `${source.name}.json`),
    contents: `${JSON.stringify(index, null, 2)}\n`,
  }));
  files.push(
    { target: path.join(indexDirectory, "catalogSources.json"), contents: registry },
    { target: path.join(directory, "catalogSources.json"), contents: registry },
  );
  publishCollectionFiles(files, io);
  return incoming.map(({ source }) => source.name);
}

module.exports = {
  canonicalJson, publishCollectionFiles,
  collectionData, validateCollectionManifest, importCollectionText,
  collectionKeyId, signCollectionManifest, verifyCollectionSignature,
};
