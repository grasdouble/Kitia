'use strict';

const {
  loadUserSourceConfiguration,
  userCatalogIndexDirectory,
  userCatalogSourcesFile,
  userCatalogDirectory,
  catalogIndexFileName,
} = require('./config.js');
const {
  isValidCatalogName,
  isReservedCatalogName,
  repositoryId,
  catalogNameKey,
  validateSourceConfiguration,
} = require('./model.js');
const { CatalogError } = require('../resources/model.js');
const { fetchSourceIndex, remoteHead } = require('./repository.js');

const fs = require('node:fs');
const path = require('node:path');
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}
function writeCatalogIndex(directory, name, index) {
  const canonical = path.join(directory, catalogIndexFileName(name));
  writeJson(canonical, index);
  removeLegacyCatalogIndexes(directory, name, canonical);
}
function removeLegacyCatalogIndexes(directory, name, canonicalPath) {
  if (!fs.existsSync(directory)) return;
  const legacyNames = fs
    .readdirSync(directory)
    .filter((entry) => entry.toLowerCase().endsWith('.json') && entry.toUpperCase() !== 'CATALOGSOURCES.JSON')
    .filter((entry) => catalogNameKey(entry.slice(0, -5)) === catalogNameKey(name));
  for (const entry of legacyNames) {
    const candidate = path.join(directory, entry);
    if (candidate !== canonicalPath) fs.rmSync(candidate);
  }
}

function catalogIndexPath(directory, name) {
  const canonical = path.join(directory, catalogIndexFileName(name));
  if (fs.existsSync(canonical)) return canonical;
  const legacyNames = fs
    .readdirSync(directory)
    .filter((entry) => entry.toLowerCase().endsWith('.json') && entry.toUpperCase() !== 'CATALOGSOURCES.JSON')
    .filter((entry) => catalogNameKey(entry.slice(0, -5)) === catalogNameKey(name));
  if (legacyNames.length > 1) throw new CatalogError(`Catalog ${name} has multiple legacy indexes`);
  return path.join(directory, legacyNames[0] || `${name}.json`);
}

function removeCatalogIndexes(directory, name) {
  const canonical = path.join(directory, catalogIndexFileName(name));
  if (fs.existsSync(canonical)) fs.rmSync(canonical);
  removeLegacyCatalogIndexes(directory, name, canonical);
}

function addCatalog(name, repository, configuration = { mode: 'basic', entries: [] }) {
  name = typeof name === 'string' ? name.trim() : name;
  if (!isValidCatalogName(name) || isReservedCatalogName(name)) {
    throw new CatalogError('Catalog name must be valid and cannot use the reserved catalogSources registry name');
  }
  const repositoryRef = repositoryId(repository);
  const mode = configuration?.mode ?? 'basic';
  if (
    !configuration ||
    typeof configuration !== 'object' ||
    Array.isArray(configuration) ||
    !['basic', 'custom'].includes(mode) ||
    (mode === 'custom' && !Array.isArray(configuration.entries)) ||
    (mode === 'basic' && configuration.entries !== undefined && configuration.entries.length !== 0)
  ) {
    throw new CatalogError('Catalog configuration must use basic mode or custom mode with explicit entries');
  }
  const current = loadUserSourceConfiguration();
  if (current.some((source) => catalogNameKey(source.name) === catalogNameKey(name))) {
    throw new CatalogError(`Catalog already exists: ${name}`);
  }
  if (current.some((source) => source.repositoryId === repositoryRef)) {
    throw new CatalogError(`Catalog repository is already registered: ${repositoryRef}`);
  }
  const source = {
    name,
    repository,
    repositoryId: repositoryRef,
    mode,
    entries: configuration.entries || [],
  };
  const priorUserSources = require('./config.js').loadUserSourceConfiguration();
  const validated = validateSourceConfiguration({
    catalog_version: 1,
    sources: [
      ...priorUserSources.map(({ name: sourceName, repository: sourceRepository, mode: sourceMode, entries }) => ({
        name: sourceName,
        repository: sourceRepository,
        ...(sourceMode ? { mode: sourceMode, entries } : {}),
      })),
      { name, repository, mode, entries: source.entries },
    ],
  });
  const normalized = validated.at(-1);
  const index = fetchSourceIndex(normalized);
  const userSources = [...priorUserSources, source].map(
    ({ name: sourceName, repository: sourceRepository, mode: sourceMode, entries }) => ({
      name: sourceName,
      repository: sourceRepository,
      ...(sourceMode ? { mode: sourceMode, entries } : {}),
    }),
  );
  validateSourceConfiguration({ catalog_version: 1, sources: userSources });
  const directory = userCatalogIndexDirectory();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeJson(userCatalogSourcesFile(), { catalog_version: 1, sources: userSources });
  writeJson(path.join(directory, 'catalogSources.json'), {
    catalog_version: 1,
    sources: userSources,
  });
  writeCatalogIndex(directory, name, index);
  return index;
}

function updateCatalog(originalName, name, repository, configuration = { mode: 'basic', entries: [] }) {
  name = typeof name === 'string' ? name.trim() : name;
  if (!isValidCatalogName(name) || isReservedCatalogName(name)) {
    throw new CatalogError('Catalog name must be valid and cannot use the reserved catalogSources registry name');
  }
  const repositoryRef = repositoryId(repository);
  const mode = configuration?.mode ?? 'basic';
  if (
    !configuration ||
    typeof configuration !== 'object' ||
    Array.isArray(configuration) ||
    !['basic', 'custom'].includes(mode) ||
    (mode === 'custom' && !Array.isArray(configuration.entries)) ||
    (mode === 'basic' && configuration.entries !== undefined && configuration.entries.length !== 0)
  ) {
    throw new CatalogError('Catalog configuration must use basic mode or custom mode with explicit entries');
  }

  const userSources = require('./config.js').loadUserSourceConfiguration();
  const original = userSources.find(
    ({ name: sourceName }) => catalogNameKey(sourceName) === catalogNameKey(originalName),
  );
  if (!original) throw new CatalogError(`User catalog not found: ${originalName}`);
  const otherSources = userSources.filter(
    ({ name: sourceName }) => catalogNameKey(sourceName) !== catalogNameKey(original.name),
  );
  if (otherSources.some(({ name: sourceName }) => catalogNameKey(sourceName) === catalogNameKey(name))) {
    throw new CatalogError(`Catalog already exists: ${name}`);
  }
  if (otherSources.some(({ repositoryId: sourceRepository }) => sourceRepository === repositoryRef)) {
    throw new CatalogError(`Catalog repository is already registered: ${repositoryRef}`);
  }

  const validated = validateSourceConfiguration({
    catalog_version: 1,
    sources: userSources.map(({ name: sourceName, repository: sourceRepository, mode: sourceMode, entries }) =>
      catalogNameKey(sourceName) === catalogNameKey(original.name)
        ? { name, repository, mode, entries: configuration.entries || [] }
        : { name: sourceName, repository: sourceRepository, mode: sourceMode, entries },
    ),
  });
  const normalized = validated.find(({ name: sourceName }) => catalogNameKey(sourceName) === catalogNameKey(name));
  if (!normalized) throw new CatalogError(`User catalog not found: ${originalName}`);
  const index = fetchSourceIndex(normalized);
  const sources = validated.map(({ name: sourceName, repository: sourceRepository, mode: sourceMode, entries }) => ({
    name: sourceName,
    repository: sourceRepository,
    mode: sourceMode,
    entries,
  }));
  const manifest = { catalog_version: 1, sources };
  const directory = userCatalogIndexDirectory();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const canonical = path.join(directory, catalogIndexFileName(name));
  writeJson(userCatalogSourcesFile(), manifest);
  writeJson(path.join(directory, 'catalogSources.json'), manifest);
  writeCatalogIndex(directory, name, index);
  if (original.name !== name) {
    const previousCanonical = path.join(directory, catalogIndexFileName(original.name));
    if (previousCanonical !== canonical && fs.existsSync(previousCanonical)) fs.rmSync(previousCanonical);
    removeLegacyCatalogIndexes(directory, original.name, canonical);
  }
  return index;
}

function refreshCatalogs(names) {
  const userSources = require('./config.js').loadUserSourceConfiguration();
  const selected =
    names === undefined
      ? userSources
      : names.map((name) => {
          const source = userSources.find((entry) => catalogNameKey(entry.name) === catalogNameKey(name));
          if (!source) throw new CatalogError(`User catalog not found: ${name}`);
          return source;
        });
  if (!selected.length) throw new CatalogError('No user catalogs are configured to refresh');
  const refreshed = [];
  const failures = [];
  for (const source of selected) {
    try {
      const index = fetchSourceIndex(source);
      const directory = userCatalogIndexDirectory();
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      writeCatalogIndex(directory, source.name, index);
      refreshed.push({ name: source.name, count: index.resources.length });
    } catch (error) {
      failures.push({
        name: source.name,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { refreshed, failures };
}

async function checkCatalogFreshness(run = undefined, names) {
  const sources = require('./config.js').loadUserSourceConfiguration();
  const selected =
    names === undefined
      ? sources
      : sources.filter((source) => names.some((name) => catalogNameKey(name) === catalogNameKey(source.name)));
  const directory = userCatalogIndexDirectory();
  return Promise.all(
    selected.map(async (source) => {
      try {
        const indexFile = catalogIndexPath(directory, source.name);
        const stat = fs.lstatSync(indexFile);
        if (!stat.isFile() || stat.isSymbolicLink()) return { name: source.name, status: 'unknown' };
        const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
        if (
          index.catalog_name !== source.name ||
          index.source_repository !== source.repositoryId ||
          !/^[a-f0-9]{40}$/i.test(index.source_ref || '')
        ) {
          return { name: source.name, status: 'unknown' };
        }
        const remote = await remoteHead(source.repository, run);
        return {
          name: source.name,
          status: remote === index.source_ref.toLowerCase() ? 'current' : 'outdated',
        };
      } catch {
        return { name: source.name, status: 'unknown' };
      }
    }),
  );
}

function removeCatalog(name) {
  const userSources = require('./config.js').loadUserSourceConfiguration();
  const source = userSources.find((entry) => catalogNameKey(entry.name) === catalogNameKey(name));
  if (!source) throw new CatalogError(`User catalog not found: ${name}`);
  const remaining = userSources.filter((entry) => entry !== source);
  const entries = remaining.map(({ name: sourceName, repository, mode, entries: mappings }) => ({
    name: sourceName,
    repository,
    ...(mode ? { mode, entries: mappings } : {}),
  }));
  const directory = userCatalogIndexDirectory();
  writeJson(userCatalogSourcesFile(), { catalog_version: 1, sources: entries });
  if (fs.existsSync(directory)) {
    removeCatalogIndexes(directory, source.name);
    writeJson(path.join(directory, 'catalogSources.json'), {
      catalog_version: 1,
      sources: entries,
    });
  }
}

function exportCatalogConfigurationData() {
  const sources = loadUserSourceConfiguration().map(({ name, repository, mode, entries }) => ({
    name,
    repository,
    ...(mode ? { mode, entries } : {}),
  }));
  return { catalog_version: 1, sources };
}

function exportCatalogConfiguration(file) {
  writeJson(path.resolve(file), exportCatalogConfigurationData());
}

function importCatalogConfigurationText(contents, refresh = refreshCatalogs) {
  const manifest = JSON.parse(contents);
  validateSourceConfiguration({ catalog_version: manifest?.catalog_version, sources: [] });
  if (!Array.isArray(manifest.sources)) {
    throw new CatalogError('catalogSources.json must have catalog_version: 1 and a sources array');
  }
  const current = loadUserSourceConfiguration();
  const names = new Set(current.map(({ name }) => catalogNameKey(name)));
  const repositories = new Set(current.map(({ repositoryId: repository }) => repository));
  const added = [];
  const ignored = [];
  for (const rawSource of manifest.sources) {
    const [source] = validateSourceConfiguration({ catalog_version: 1, sources: [rawSource] });
    if (isReservedCatalogName(source.name)) {
      throw new CatalogError(`Catalog name is reserved for the catalogSources registry: ${source.name}`);
    }
    if (names.has(catalogNameKey(source.name))) {
      ignored.push({ name: source.name, reason: 'Catalog name already exists.' });
    } else if (repositories.has(source.repositoryId)) {
      ignored.push({
        name: source.name,
        reason: `Repository already registered as another catalog (${source.repositoryId}).`,
      });
    } else {
      names.add(catalogNameKey(source.name));
      repositories.add(source.repositoryId);
      added.push({
        name: source.name,
        repository: source.repository,
        ...(source.mode ? { mode: source.mode, entries: source.entries } : {}),
      });
    }
  }
  if (added.length) {
    const combined = [
      ...current.map(({ name, repository, mode, entries }) => ({
        name,
        repository,
        ...(mode ? { mode, entries } : {}),
      })),
      ...added,
    ];
    const directory = userCatalogDirectory();
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeJson(userCatalogSourcesFile(), { catalog_version: 1, sources: combined });
    const indexDirectory = userCatalogIndexDirectory();
    fs.mkdirSync(indexDirectory, { recursive: true, mode: 0o700 });
    writeJson(path.join(indexDirectory, 'catalogSources.json'), {
      catalog_version: 1,
      sources: combined,
    });
  }
  const refreshResult = added.length ? refresh(added.map(({ name }) => name)) : { refreshed: [], failures: [] };
  return {
    added: added.map(({ name }) => name),
    ignored,
    refreshed: refreshResult.refreshed,
    refreshFailures: refreshResult.failures,
  };
}

module.exports = {
  addCatalog,
  updateCatalog,
  refreshCatalogs,
  checkCatalogFreshness,
  removeCatalog,
  exportCatalogConfiguration,
  exportCatalogConfigurationData,
  importCatalogConfigurationText,
};
export {};
