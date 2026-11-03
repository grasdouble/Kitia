"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { CatalogError, readUtf8, validateSourceCatalog } = require("../resources/index.js");
const { validateSourceConfiguration } = require("./config.js");

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

module.exports = { MAX_INDEX_BYTES, validateCatalogSet, loadSourceCatalogsFromDirectory };
