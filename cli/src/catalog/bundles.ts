"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
import type { CatalogResource } from "./entries.js";
const { CatalogError } = require("./resources/index.js");
const {
  canonicalJson, collectionData, collectionKeyId, validateCollectionManifest, publishCollectionFiles,
} = require("./collections.js");
const {
  repositoryId, validateSourceConfiguration, loadUserSourceConfiguration,
  userCatalogDirectory, userCatalogIndexDirectory,
} = require("./sources/config.js");

const BUNDLE_SIGNATURE_DOMAIN = Buffer.from("Kitia resource bundle signature v1\0", "utf8");
const MAX_BUNDLE_BYTES = 128 * 1024 * 1024;
const MAX_BUNDLE_CONTENT_BYTES = 64 * 1024 * 1024;
const MAX_BUNDLE_FILE_BYTES = 16 * 1024 * 1024;
const MAX_BUNDLE_FILES = 4096;
const MAX_BUNDLE_CACHE_KEY_BYTES = 16 * 1024;

function bundlePayload(bundle) {
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle) || bundle.bundle_version !== 1) {
    throw new CatalogError("Resource bundle signature requires bundle_version: 1");
  }
  const payload = {};
  for (const key of Object.keys(bundle)) {
    if (key !== "signature") payload[key] = bundle[key];
  }
  return Buffer.concat([BUNDLE_SIGNATURE_DOMAIN, Buffer.from(canonicalJson(payload), "utf8")]);
}

function publicKeyObject(input) {
  let key;
  try { key = input instanceof crypto.KeyObject && input.type === "public" ? input : crypto.createPublicKey(input); }
  catch (error) { throw new CatalogError(`Invalid resource bundle public key: ${error.message}`); }
  if (key.asymmetricKeyType !== "ed25519") throw new CatalogError("Resource bundle signatures require an Ed25519 public key");
  return key;
}

function validateBundleSignature(signature) {
  if (!signature || typeof signature !== "object" || Array.isArray(signature) ||
      Object.keys(signature).some((key) => !["signature_version", "algorithm", "key_id", "value"].includes(key)) ||
      signature.signature_version !== 1 || signature.algorithm !== "Ed25519" ||
      typeof signature.key_id !== "string" || !/^sha256:[a-f0-9]{64}$/.test(signature.key_id) ||
      typeof signature.value !== "string") {
    throw new CatalogError("Resource bundle must have a version-1 Ed25519 signature");
  }
  const value = Buffer.from(signature.value, "base64");
  if (value.length !== 64 || value.toString("base64") !== signature.value) {
    throw new CatalogError("Resource bundle signature must be a canonical Ed25519 signature");
  }
}

function signResourceBundle(bundle, privateKeyInput) {
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle) || Object.hasOwn(bundle, "signature")) {
    throw new CatalogError("Sign an unsigned resource bundle object");
  }
  let privateKey;
  try {
    privateKey = privateKeyInput instanceof crypto.KeyObject && privateKeyInput.type === "private"
      ? privateKeyInput : crypto.createPrivateKey(privateKeyInput);
  } catch (error) { throw new CatalogError(`Invalid resource bundle private key: ${error.message}`); }
  if (privateKey.asymmetricKeyType !== "ed25519") throw new CatalogError("Resource bundle signatures require an Ed25519 private key");
  const publicKey = crypto.createPublicKey(privateKey);
  return {
    ...bundle,
    signature: {
      signature_version: 1,
      algorithm: "Ed25519",
      key_id: collectionKeyId(publicKey),
      value: crypto.sign(null, bundlePayload(bundle), privateKey).toString("base64"),
    },
  };
}

function verifyResourceBundleSignature(bundle, trustedPublicKey) {
  if (trustedPublicKey === undefined || trustedPublicKey === null) {
    throw new CatalogError("Resource bundle import requires an explicitly approved public key");
  }
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle) || !Object.hasOwn(bundle, "signature")) {
    throw new CatalogError("Resource bundle must be signed");
  }
  validateBundleSignature(bundle.signature);
  const publicKey = publicKeyObject(trustedPublicKey);
  const keyId = collectionKeyId(publicKey);
  if (bundle.signature.key_id !== keyId) {
    throw new CatalogError(`Approved bundle key does not match signer key_id ${bundle.signature.key_id}`);
  }
  let verified;
  try {
    verified = crypto.verify(null, bundlePayload(bundle), publicKey, Buffer.from(bundle.signature.value, "base64"));
  } catch (error) { throw new CatalogError(`Cannot verify resource bundle signature: ${error.message}`); }
  if (!verified) throw new CatalogError("Resource bundle signature verification failed");
  return { signed: true, key_id: keyId };
}

// This collision key intentionally over-normalizes Unicode and case; stored paths are never rewritten.
function portableBundlePath(filePath) {
  return filePath.split("/").map((part) => part.normalize("NFKC").toUpperCase().toLowerCase()).join("/");
}

function safeBundlePath(filePath) {
  return typeof filePath === "string" && filePath.length > 0 &&
    Buffer.from(filePath, "utf8").toString("utf8") === filePath && !filePath.startsWith("/") &&
    !/^[A-Za-z]:/.test(filePath) &&
    filePath.split("/").every((part) => {
      const normalized = part.normalize("NFKC");
      if (!part || part === "." || part === ".." ||
          /[. ]$/u.test(normalized) || /[\u0000-\u001f\u007f-\u009f\\/:*?"<>|]/u.test(normalized)) {
        return false;
      }
      const deviceName = normalized.replace(/\..*$/u, "").replace(/[ .]+$/u, "").toUpperCase();
      return !/^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|CLOCK\$|COM[1-9]|LPT[1-9])$/u.test(deviceName);
    });
}

function registerPortableBundlePath(filePath, registeredFiles, registeredDirectories) {
  const portablePath = portableBundlePath(filePath);
  if (registeredFiles.has(portablePath)) {
    throw new CatalogError(`Bundle resource paths alias on portable filesystems: ${registeredFiles.get(portablePath)} and ${filePath}`);
  }
  if (registeredDirectories.has(portablePath)) {
    throw new CatalogError(`Bundle resource path ${filePath} conflicts with descendant ${registeredDirectories.get(portablePath)} on portable filesystems`);
  }
  let parent = "";
  for (const part of portablePath.split("/").slice(0, -1)) {
    parent = parent ? `${parent}/${part}` : part;
    if (registeredFiles.has(parent)) {
      throw new CatalogError(`Bundle resource paths conflict as file and directory on portable filesystems: ${registeredFiles.get(parent)} and ${filePath}`);
    }
    if (!registeredDirectories.has(parent)) registeredDirectories.set(parent, filePath);
  }
  registeredFiles.set(portablePath, filePath);
}

function resourceKey(catalog, resource) {
  return `${catalog}:${resource.kind}:${resource.id}`;
}

function bundleData(resources, sources, selectors, readResourceFiles) {
  const collection = collectionData(resources, sources, selectors);
  let fileCount = 0;
  let totalBytes = 0;
  const byKey = new Map<string, CatalogResource>(resources.map((resource: CatalogResource) => [
    `${resource.catalog}:${resource.kind}:${resource.id}`, resource,
  ] as const));
  const catalogs = collection.catalogs.map((catalog) => ({
    ...catalog,
    resources: catalog.resources.map((reference) => {
      const resource = byKey.get(resourceKey(catalog.name, reference));
      if (!resource) throw new CatalogError(`Bundle resource is unavailable: ${resourceKey(catalog.name, reference)}`);
      const files = readResourceFiles(resource, {
        maxFiles: MAX_BUNDLE_FILES - fileCount,
        maxBytes: MAX_BUNDLE_CONTENT_BYTES - totalBytes,
      });
      return {
        ...reference,
        files: files.map(({ path: filePath, content, executable = false }) => {
          fileCount += 1;
          if (fileCount > MAX_BUNDLE_FILES) throw new CatalogError(`Resource bundle exceeds ${MAX_BUNDLE_FILES} files`);
          const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
          totalBytes += bytes.byteLength;
          if (totalBytes > MAX_BUNDLE_CONTENT_BYTES) {
            throw new CatalogError(`Resource bundle exceeds ${MAX_BUNDLE_CONTENT_BYTES} content bytes`);
          }
          if (!safeBundlePath(filePath)) throw new CatalogError(`Unsafe bundle file path: ${filePath}`);
          if (bytes.byteLength > MAX_BUNDLE_FILE_BYTES) throw new CatalogError(`Bundle file exceeds ${MAX_BUNDLE_FILE_BYTES} byte limit: ${filePath}`);
          if (typeof executable !== "boolean") throw new CatalogError(`Invalid executable flag for bundle file: ${filePath}`);
          return {
            path: filePath,
            sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
            executable,
            content: bytes.toString("base64"),
          };
        }),
      };
    }),
  }));
  const bundle = { bundle_version: 1, catalogs };
  validateResourceBundle(bundle, { requireSignature: false });
  if (Buffer.byteLength(JSON.stringify(bundle), "utf8") > MAX_BUNDLE_BYTES) {
    throw new CatalogError(`Resource bundle exceeds ${MAX_BUNDLE_BYTES} byte limit`);
  }
  return bundle;
}

function validateResourceBundle(input, { requireSignature = true } = {}) {
  const rootKeys = new Set(["bundle_version", "catalogs", "signature"]);
  if (!input || typeof input !== "object" || Array.isArray(input) || input.bundle_version !== 1 ||
      Object.keys(input).some((key) => !rootKeys.has(key)) || !Array.isArray(input.catalogs)) {
    throw new CatalogError("Resource bundle must have bundle_version: 1 and a catalogs array");
  }
  if (requireSignature || Object.hasOwn(input, "signature")) validateBundleSignature(input.signature);
  let fileCount = 0;
  let totalBytes = 0;
  const stripped = {
    collection_version: 1,
    catalogs: input.catalogs.map((catalog, catalogIndex) => {
      if (!catalog || typeof catalog !== "object" || Array.isArray(catalog) || !Array.isArray(catalog.resources)) {
        throw new CatalogError(`Bundle catalogs[${catalogIndex}] must contain resources`);
      }
      return {
        ...catalog,
        resources: catalog.resources.map((resource, resourceIndex) => {
          const label = `Bundle catalogs[${catalogIndex}].resources[${resourceIndex}]`;
          if (!resource || typeof resource !== "object" || Array.isArray(resource) || !Array.isArray(resource.files) ||
              Object.keys(resource).some((key) => !["kind", "id", "source_path", "description", "license_status", "apply_to", "files"].includes(key))) {
            throw new CatalogError(`${label} must contain supported resource metadata and files`);
          }
          const seenPaths = new Map();
          const seenDirectories = new Map();
          let hasSkillEntryPoint = false;
          const files = resource.files.map((file, fileIndex) => {
            fileCount++;
            if (fileCount > MAX_BUNDLE_FILES) throw new CatalogError(`Resource bundle exceeds ${MAX_BUNDLE_FILES} files`);
            if (!file || typeof file !== "object" || Array.isArray(file) ||
                Object.keys(file).some((key) => !["path", "sha256", "executable", "content"].includes(key)) ||
                !safeBundlePath(file.path) ||
                !/^[a-f0-9]{64}$/.test(file.sha256 || "") || typeof file.executable !== "boolean" ||
                typeof file.content !== "string") {
              throw new CatalogError(`${label}.files[${fileIndex}] has invalid or unsafe fields`);
            }
            registerPortableBundlePath(file.path, seenPaths, seenDirectories);
            if (file.path === "SKILL.md") hasSkillEntryPoint = true;
            const content = Buffer.from(file.content, "base64");
            if (content.toString("base64") !== file.content || content.byteLength > MAX_BUNDLE_FILE_BYTES ||
                crypto.createHash("sha256").update(content).digest("hex") !== file.sha256) {
              throw new CatalogError(`${label}.files[${fileIndex}] content does not match its SHA-256 fingerprint`);
            }
            totalBytes += content.byteLength;
            if (totalBytes > MAX_BUNDLE_CONTENT_BYTES) throw new CatalogError(`Resource bundle exceeds ${MAX_BUNDLE_CONTENT_BYTES} content bytes`);
            return { path: file.path, content, executable: file.executable, sha256: file.sha256 };
          });
          if (resource.kind === "skill" && !hasSkillEntryPoint) {
            throw new CatalogError(`${label} skill bundle must contain SKILL.md`);
          }
          if (resource.kind !== "skill" &&
              (files.length !== 1 || files[0].path !== path.posix.basename(resource.source_path || ""))) {
            throw new CatalogError(`${label} ${resource.kind} bundle must contain exactly its source file`);
          }
          const reference = { ...resource };
          delete reference.files;
          return reference;
        }),
      };
    }),
  };
  const bundleIdentifier = bundleId(input);
  const catalogs = validateCollectionManifest(stripped).map(({ source, index }, catalogIndex) => {
    index.resources = index.resources.map((resource, resourceIndex) => ({
      ...resource,
      bundle_id: bundleIdentifier,
    }));
    const original = input.catalogs[catalogIndex];
    const resources = original.resources.map((resource, resourceIndex) => ({
      resource,
      files: resource.files.map((file) => ({
        path: file.path,
        content: Buffer.from(file.content, "base64"),
        executable: file.executable,
        sha256: file.sha256,
      })),
      indexResource: index.resources[resourceIndex],
    }));
    return { source, index, resources };
  });
  return { bundleId: bundleIdentifier, catalogs, contentBytes: totalBytes, fileCount };
}

function bundleId(bundle) {
  const payload = {};
  for (const key of Object.keys(bundle)) if (key !== "signature") payload[key] = bundle[key];
  return crypto.createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
}

function trustedPublicKeyBytes(input) {
  return Buffer.from(publicKeyObject(input).export({ format: "pem", type: "spki" }));
}

function ensureDirectory(io, directory, label) {
  let stat;
  try { stat = io.lstatSync(directory); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    io.mkdirSync(directory, { recursive: true, mode: 0o700 });
    return true;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new CatalogError(`${label} must be a real directory: ${directory}`);
  }
  return false;
}

function requireDirectory(io, directory, label) {
  let stat;
  try { stat = io.lstatSync(directory); }
  catch (error) { throw new CatalogError(`${label} is unavailable: ${error.message}`); }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new CatalogError(`${label} must be a real directory: ${directory}`);
  }
}


type ConfiguredCatalogSource = {
  name: string;
  repository: string;
  repositoryId: string;
  mode: "basic" | "custom";
  entries: Array<{ kind: string; id?: string; path: string }>;
};
function sameBundleCatalogDefinition(existing, incoming) {
  const existingMode = existing.mode || "basic";
  const incomingMode = incoming.mode || "basic";
  return existing.name === incoming.name &&
    repositoryId(existing.repository).toLowerCase() === repositoryId(incoming.repository).toLowerCase() &&
    existingMode === incomingMode &&
    (existingMode !== "custom" || canonicalJson(existing.entries) === canonicalJson(incoming.entries));
}
function importResourceBundleText(contents, io = fs, { trustedKey, replace = false }: { trustedKey?: unknown; replace?: boolean } = {}) {
  if (typeof contents !== "string" || Buffer.byteLength(contents, "utf8") > MAX_BUNDLE_BYTES) {
    throw new CatalogError(`Resource bundle must be a JSON file no larger than ${MAX_BUNDLE_BYTES} bytes`);
  }
  let bundle;
  try { bundle = JSON.parse(contents); } catch { throw new CatalogError("Resource bundle is not valid JSON"); }
  verifyResourceBundleSignature(bundle, trustedKey);
  const validated = validateResourceBundle(bundle);
  const current: ConfiguredCatalogSource[] = loadUserSourceConfiguration();
  const currentByName = new Map<string, ConfiguredCatalogSource>(
    current.map((source) => [source.name.toUpperCase(), source] as const),
  );
  const currentByRepository = new Map<string, ConfiguredCatalogSource>(
    current.map((source) => [source.repositoryId.toLowerCase(), source] as const),
  );
  const replacementNames = new Set();
  const additions = [];
  for (const { source } of validated.catalogs) {
    const existingByName = currentByName.get(source.name.toUpperCase());
    const existingByRepository = currentByRepository.get(repositoryId(source.repository).toLowerCase());
    if (existingByName || existingByRepository) {
      if (!replace || !existingByName || existingByName !== existingByRepository ||
          !sameBundleCatalogDefinition(existingByName, source)) {
        throw new CatalogError(`Cannot import bundle: catalog conflicts with configured name, repository, or mappings (${source.name})`);
      }
      replacementNames.add(existingByName.name);
    } else {
      additions.push(source);
    }
  }
  const combined = [...current.map(({ name, repository, mode, entries }) => ({
    name, repository, ...(mode === "custom" ? { mode, entries } : {}),
  })), ...additions];
  validateSourceConfiguration({ catalog_version: 1, sources: combined });

  const configDirectory = userCatalogDirectory();
  const indexDirectory = userCatalogIndexDirectory();
  const cacheRoot = path.join(configDirectory, "source-bundles");
  const bundleCache = path.join(cacheRoot, validated.bundleId);
  const cacheManifest = path.join(bundleCache, "bundle.json");
  const cacheKey = path.join(bundleCache, "trusted-key.pem");
  for (const { source } of validated.catalogs) {
    if (replacementNames.has(source.name)) continue;
    if (io.existsSync(path.join(indexDirectory, `${source.name}.json`))) {
      throw new CatalogError(`Cannot import bundle: an unregistered catalog index already exists for ${source.name}`);
    }
  }
  ensureDirectory(io, configDirectory, "Configuration directory");
  ensureDirectory(io, indexDirectory, "Catalog index directory");
  const createdCacheRoot = ensureDirectory(io, cacheRoot, "Resource bundle cache");
  const createdBundleCache = ensureDirectory(io, bundleCache, "Resource bundle cache entry");
  const registry = `${JSON.stringify({ catalog_version: 1, sources: combined }, null, 2)}\n`;
  const files = validated.catalogs.map(({ source, index }) => ({
    target: path.join(indexDirectory, `${source.name}.json`),
    contents: `${JSON.stringify(index, null, 2)}\n`,
  }));
  files.push(
    { target: cacheManifest, contents: `${JSON.stringify(bundle, null, 2)}\n`, mode: 0o600 },
    { target: cacheKey, contents: trustedPublicKeyBytes(trustedKey), mode: 0o600 },
    { target: path.join(indexDirectory, "catalogSources.json"), contents: registry },
    { target: path.join(configDirectory, "catalogSources.json"), contents: registry },
  );
  try {
    publishCollectionFiles(files, io);
  } catch (error) {
    if (createdBundleCache) io.rmdirSync(bundleCache);
    if (createdCacheRoot) io.rmdirSync(cacheRoot);
    throw error;
  }
  return {
    catalogs: validated.catalogs.map(({ source }) => source.name),
    added: validated.catalogs.map(({ source }) => source.name).filter((name) => !replacementNames.has(name)),
    replaced: validated.catalogs.map(({ source }) => source.name).filter((name) => replacementNames.has(name)),
    bundle_id: validated.bundleId,
  };
}

function readRegularFile(file, maxBytes, label) {
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (error) { throw new CatalogError(`Cannot read cached resource bundle ${label}: ${error.message}`); }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) {
    throw new CatalogError(`Cached resource bundle ${label} must be a regular file within size limits`);
  }
  return fs.readFileSync(file);
}

function readCachedResourceFiles(resource) {
  if (!/^[a-f0-9]{64}$/.test(resource.bundle_id || "")) {
    throw new CatalogError(`Resource ${resource.id} has no valid imported bundle reference`);
  }
  const cacheRoot = path.join(userCatalogDirectory(), "source-bundles");
  const cacheDirectory = path.join(cacheRoot, resource.bundle_id);
  requireDirectory(fs, cacheRoot, "Resource bundle cache");
  requireDirectory(fs, cacheDirectory, "Resource bundle cache entry");
  const contents = readRegularFile(path.join(cacheDirectory, "bundle.json"), MAX_BUNDLE_BYTES, "manifest").toString("utf8");
  const trustedKey = readRegularFile(path.join(cacheDirectory, "trusted-key.pem"), MAX_BUNDLE_CACHE_KEY_BYTES, "approved key");
  let bundle;
  try { bundle = JSON.parse(contents); } catch { throw new CatalogError("Cached resource bundle is not valid JSON"); }
  verifyResourceBundleSignature(bundle, trustedKey);
  const validated = validateResourceBundle(bundle);
  if (validated.bundleId !== resource.bundle_id) throw new CatalogError("Cached resource bundle does not match its configured bundle reference");
  const sourceRepository = resource.source_repository?.toLowerCase();
  const catalog = validated.catalogs.find(({ source }) => source.name === resource.catalog &&
    repositoryId(source.repository).toLowerCase() === sourceRepository);
  const bundled = catalog?.resources.find(({ resource: entry }) => entry.kind === resource.kind &&
    entry.id === resource.id && entry.source_path === resource.source_path &&
    catalog.index.source_ref.toLowerCase() === String(resource.source_ref || "").toLowerCase());
  if (!bundled) throw new CatalogError(`Cached bundle does not contain the pinned resource ${resource.catalog}:${resource.kind}:${resource.id}`);
  return bundled.files;
}

module.exports = {
  MAX_BUNDLE_BYTES, MAX_BUNDLE_CONTENT_BYTES, MAX_BUNDLE_FILE_BYTES, MAX_BUNDLE_FILES,
  bundleData, validateResourceBundle, bundleId, signResourceBundle, verifyResourceBundleSignature,
  importResourceBundleText, readCachedResourceFiles,
};
