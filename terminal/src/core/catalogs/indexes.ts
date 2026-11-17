"use strict";

const { CatalogError } = require("../resources/model.js");
const { readUtf8 } = require("../resources/content.js");
const { validateSourceCatalog } = require("../resources/manifest.js");
const { validateSourceConfiguration } = require("./model.js");
const { loadUserSourceConfiguration, userCatalogIndexDirectory } = require("./config.js");

const fs = require("node:fs");
const path = require("node:path");
const MAX_INDEX_BYTES = 2 * 1024 * 1024;

function readIndex(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > MAX_INDEX_BYTES) {
    throw new CatalogError(`Catalog index must be a regular JSON file of at most ${MAX_INDEX_BYTES} bytes`);
  }
  try {
    return JSON.parse(readUtf8(file, "Catalog index"));
  } catch (error) {
    if (error instanceof CatalogError) throw error;
    throw new CatalogError(`Cannot read catalog index: ${error.message}`);
  }
}

function sameSources(left, right) {
  return left.length === right.length && left.every((source, index) =>
    source.name === right[index].name && source.repositoryId === right[index].repositoryId);
}

function validateCatalogSet(entries, sources, sourceDirectory = "") {
  if (!Array.isArray(entries) || entries.length !== sources.length) {
    throw new CatalogError("User source catalog set does not match its registry");
  }
  const byName = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry.name !== "string" || byName.has(entry.name)) {
      throw new CatalogError("User source catalog set contains an invalid or duplicate catalog name");
    }
    byName.set(entry.name, entry.catalog);
  }
  return sources.flatMap((source) => {
    if (!byName.has(source.name)) {
      throw new CatalogError(`User source catalog set is missing ${source.name}`);
    }
    return validateSourceCatalog(byName.get(source.name), {
      ...source,
      label: `${sourceDirectory ? `${sourceDirectory}/` : ""}${source.name}.json`,
    }).map((resource) => ({ ...resource, catalog: source.name }));
  });
}

function loadSourceCatalogsFromDirectory(directory, sources) {
  const expectedFiles = ["catalogSources.json", ...sources.map(({ name }) => `${name}.json`)].sort();
  const actualFiles = fs.readdirSync(directory).sort();
  if (actualFiles.length !== expectedFiles.length ||
      actualFiles.some((file, index) => file !== expectedFiles[index])) {
    throw new CatalogError(
      "User source catalog directory must contain catalogSources.json and exactly its configured indexes",
    );
  }
  const registry = validateSourceConfiguration(readIndex(path.join(directory, "catalogSources.json")));
  if (!sameSources(registry, sources)) {
    throw new CatalogError("User source registry differs from its catalogSources.json index");
  }
  const entries = sources.map((source) => ({
    name: source.name,
    catalog: readIndex(path.join(directory, `${source.name}.json`)),
  }));
  return validateCatalogSet(entries, sources, "user source catalogs");
}

export interface CatalogLoadRequest {
  names?: string[];
  sources?: Array<{ name: string; repository: string; repositoryId: string; mode?: string; entries?: Array<{kind: string; id?: string; path: string}> }>;
  sourceResources?: import("../resources/model.js").CatalogResource[];
  allowUnavailable?: boolean;
}
export interface CatalogLoadWarning { code: string; catalog: string; message: string; }
function loadCatalogs({ names, sources = loadUserSourceConfiguration(), sourceResources: suppliedResources, allowUnavailable = false }: CatalogLoadRequest = {}, warn: (warning: CatalogLoadWarning) => void = () => {}) {
  names ||= sources.map(({ name }) => name);
  const loaded = { sourceResources: [], unavailable: [] };
  let sourceResources;
  const loadSources = () => {
    if (sourceResources) return sourceResources;
    sourceResources = suppliedResources || (sources.length
      ? loadSourceCatalogsFromDirectory(userCatalogIndexDirectory(), sources)
      : []);
    return sourceResources;
  };
  const loaders = Object.fromEntries(sources.map((source) => [source.name, () => {
    loaded.sourceResources.push(...loadSources().filter((resource) => resource.catalog === source.name));
  }]));
  for (const name of names) {
    const loader = loaders[name];
    if (!loader) throw new CatalogError(`Unknown catalog: ${name}`, "INVALID_ARGUMENT");
    try {
      loader();
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const message = `${name} catalog unavailable: ${error.message}`;
      const errorCode = (error as Error & { code?: string }).code;
      const code = errorCode && ["UNSUPPORTED_CATALOG_VERSION", "UNSUPPORTED_RESOURCE_KIND", "INVALID_ARGUMENT"].includes(errorCode)
        ? errorCode : "CATALOG_UNAVAILABLE";
      if (!allowUnavailable) throw new CatalogError(message, code);
      loaded.unavailable.push(name);
      warn({ code, catalog: name, message });
    }
  }
  return loaded;
}
module.exports = { MAX_INDEX_BYTES, validateCatalogSet, loadSourceCatalogsFromDirectory, loadCatalogs };

export {};
