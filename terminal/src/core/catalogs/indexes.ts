'use strict';

import type { CatalogResource } from '../resources/model.js';
import type { SourceConfiguration } from './model.js';
const { CatalogError } = require('../resources/model.js');
const { readUtf8 } = require('../resources/content.js');
const { validateSourceCatalog } = require('../resources/manifest.js');
const { catalogNameKey, validateSourceConfiguration } = require('./model.js');
const { loadUserSourceConfiguration, userCatalogIndexDirectory, catalogIndexFileName } = require('./config.js');

const fs = require('node:fs');
const path = require('node:path');
const MAX_INDEX_BYTES = 2 * 1024 * 1024;

function readIndex(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > MAX_INDEX_BYTES) {
    throw new CatalogError(`Catalog index must be a regular JSON file of at most ${MAX_INDEX_BYTES} bytes`);
  }
  try {
    return JSON.parse(readUtf8(file, 'Catalog index'));
  } catch (error) {
    if (error instanceof CatalogError) throw error;
    throw new CatalogError(`Cannot read catalog index: ${error.message}`);
  }
}

function sameSources(left, right) {
  return (
    left.length === right.length &&
    left.every(
      (source, index) => source.name === right[index].name && source.repositoryId === right[index].repositoryId,
    )
  );
}

function sourceDirectorySnapshot(directory) {
  let entries = [];
  let error;
  try {
    if (fs.existsSync(directory)) entries = fs.readdirSync(directory);
  } catch (caught) {
    error = caught;
  }
  const legacyIndexes = new Map();
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith('.json') || entry.toUpperCase() === 'CATALOGSOURCES.JSON') continue;
    const key = catalogNameKey(entry.slice(0, -5));
    const names = legacyIndexes.get(key) || [];
    names.push(entry);
    legacyIndexes.set(key, names);
  }
  return { entries, error, legacyIndexes };
}

function indexPaths(directory, source, snapshot = sourceDirectorySnapshot(directory)) {
  if (snapshot.error) throw snapshot.error;
  const canonical = path.join(directory, catalogIndexFileName(source.name));
  const legacyNames = snapshot.legacyIndexes.get(catalogNameKey(source.name)) || [];
  if (legacyNames.length > 1) throw new CatalogError(`Catalog ${source.name} has multiple legacy index files`);
  const legacy = path.join(directory, legacyNames[0] || `${source.name}.json`);
  return {
    canonical,
    legacy,
    selected: fs.existsSync(canonical) ? canonical : legacy,
  };
}

function loadSourceCatalogFromDirectory(directory, source, snapshot = sourceDirectorySnapshot(directory)) {
  const { canonical, legacy, selected } = indexPaths(directory, source, snapshot);
  if (!fs.existsSync(selected)) throw new CatalogError(`Catalog index not found for ${source.name}`);
  if (canonical !== legacy && fs.existsSync(canonical) && fs.existsSync(legacy)) {
    throw new CatalogError(`Catalog ${source.name} has both canonical and legacy index files`);
  }
  return validateSourceCatalog(readIndex(selected), {
    ...source,
    label: path.relative(directory, selected),
  }).map((resource) => ({ ...resource, catalog: source.name }));
}

function validateCatalogSet(entries, sources, sourceDirectory = '') {
  if (!Array.isArray(entries) || entries.length !== sources.length) {
    throw new CatalogError('User source catalog set does not match its registry');
  }
  const byName = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry.name !== 'string' || byName.has(entry.name)) {
      throw new CatalogError('User source catalog set contains an invalid or duplicate catalog name');
    }
    byName.set(entry.name, entry.catalog);
  }
  return sources.flatMap((source) => {
    if (!byName.has(source.name)) {
      throw new CatalogError(`User source catalog set is missing ${source.name}`);
    }
    return validateSourceCatalog(byName.get(source.name), {
      ...source,
      label: `${sourceDirectory ? `${sourceDirectory}/` : ''}${source.name}.json`,
    }).map((resource) => ({ ...resource, catalog: source.name }));
  });
}

function loadSourceCatalogsFromDirectory(directory, sources, snapshot = sourceDirectorySnapshot(directory)) {
  if (snapshot.error) throw snapshot.error;
  const expectedLegacyFiles = [];
  const expectedCanonicalFiles = [];
  for (const source of sources) {
    const { canonical, legacy, selected } = indexPaths(directory, source, snapshot);
    if (canonical !== legacy && fs.existsSync(canonical) && fs.existsSync(legacy)) {
      throw new CatalogError(`Catalog ${source.name} has both canonical and legacy index files`);
    }
    if (selected === canonical) expectedCanonicalFiles.push(path.basename(canonical));
    else expectedLegacyFiles.push(path.basename(selected));
  }
  expectedLegacyFiles.sort();
  expectedCanonicalFiles.sort();
  const internalDirectory = path.join(directory, '.kitia-index');
  const hasInternalDirectory = fs.existsSync(internalDirectory);
  if (hasInternalDirectory) {
    const stat = fs.lstatSync(internalDirectory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new CatalogError('Canonical catalog index directory must be a regular directory');
    }
    const actualCanonicalFiles = fs.readdirSync(internalDirectory).sort();
    if (
      actualCanonicalFiles.length !== expectedCanonicalFiles.length ||
      actualCanonicalFiles.some((file, index) => file !== expectedCanonicalFiles[index])
    ) {
      throw new CatalogError('Canonical catalog index directory must contain exactly one index per configured catalog');
    }
  } else if (expectedCanonicalFiles.length) {
    throw new CatalogError('Canonical catalog index directory is missing');
  }
  const expectedRootFiles = ['catalogSources.json', ...expectedLegacyFiles];
  if (hasInternalDirectory) expectedRootFiles.push('.kitia-index');
  expectedRootFiles.sort();
  const actualRootFiles = snapshot.entries.slice().sort();
  if (
    actualRootFiles.length !== expectedRootFiles.length ||
    actualRootFiles.some((file, index) => file !== expectedRootFiles[index])
  ) {
    throw new CatalogError(
      'User source catalog directory must contain catalogSources.json and exactly one index per configured catalog',
    );
  }
  const registry = validateSourceConfiguration(readIndex(path.join(directory, 'catalogSources.json')));
  if (!sameSources(registry, sources)) {
    throw new CatalogError('User source registry differs from its catalogSources.json index');
  }
  return sources.flatMap((source) => loadSourceCatalogFromDirectory(directory, source, snapshot));
}

export interface CatalogLoadRequest {
  names?: string[];
  sources?: SourceConfiguration[];
  sourceResources?: CatalogResource[];
  allowUnavailable?: boolean;
  strictAggregate?: boolean;
}
export interface CatalogLoadWarning {
  code: string;
  catalog: string;
  message: string;
}
function loadCatalogs(
  {
    names,
    sources = loadUserSourceConfiguration(),
    sourceResources: suppliedResources,
    allowUnavailable = false,
    strictAggregate = false,
  }: CatalogLoadRequest = {},
  warn: (warning: CatalogLoadWarning) => void = () => {},
) {
  names ||= sources.map(({ name }) => name);
  const loaded = { sourceResources: [], unavailable: [] };
  const directory = userCatalogIndexDirectory();
  const snapshot =
    !suppliedResources && (strictAggregate ? sources.length > 0 : names.length > 0)
      ? sourceDirectorySnapshot(directory)
      : undefined;
  if (strictAggregate) {
    try {
      loaded.sourceResources =
        suppliedResources || (sources.length ? loadSourceCatalogsFromDirectory(directory, sources, snapshot) : []);
      return loaded;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const errorCode = (error as Error & { code?: string }).code;
      const code =
        errorCode &&
        ['UNSUPPORTED_CATALOG_VERSION', 'UNSUPPORTED_RESOURCE_KIND', 'INVALID_ARGUMENT'].includes(errorCode)
          ? errorCode
          : 'CATALOG_UNAVAILABLE';
      throw new CatalogError(error.message, code);
    }
  }
  const sourceByName = new Map(sources.map((source) => [source.name, source]));
  for (const name of names) {
    const source = sourceByName.get(name);
    if (!source) throw new CatalogError(`Unknown catalog: ${name}`, 'INVALID_ARGUMENT');
    try {
      loaded.sourceResources.push(
        ...(suppliedResources
          ? suppliedResources.filter((resource) => resource.catalog === name)
          : loadSourceCatalogFromDirectory(directory, source, snapshot)),
      );
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const message = `${name} catalog unavailable: ${error.message}`;
      const errorCode = (error as Error & { code?: string }).code;
      const code =
        errorCode &&
        ['UNSUPPORTED_CATALOG_VERSION', 'UNSUPPORTED_RESOURCE_KIND', 'INVALID_ARGUMENT'].includes(errorCode)
          ? errorCode
          : 'CATALOG_UNAVAILABLE';
      if (!allowUnavailable) throw new CatalogError(message, code);
      loaded.unavailable.push(name);
      warn({ code, catalog: name, message });
    }
  }
  return loaded;
}
module.exports = {
  MAX_INDEX_BYTES,
  validateCatalogSet,
  loadSourceCatalogsFromDirectory,
  loadCatalogs,
};

export {};
