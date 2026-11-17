"use strict";

const { CatalogError } = require("../resources/model.js");
const { validateCollectionSignatureEnvelope } = require("./signatures.js");
const { validateSourceConfiguration, catalogNameKey } = require("../catalogs/model.js");
const { validateSourceCatalog } = require("../resources/manifest.js");
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


module.exports = { collectionData, validateCollectionManifest };

export {};
