'use strict';

const { CatalogError } = require('../resources/model.js');
const { verifyCollectionSignature } = require('./signatures.js');
const { validateCollectionManifest } = require('./manifest.js');
const {
  loadUserSourceConfiguration,
  userCatalogDirectory,
  userCatalogIndexDirectory,
  catalogIndexFileName,
} = require('../catalogs/config.js');
const {
  catalogNameKey,
  isReservedCatalogName,
  repositoryId,
  validateSourceConfiguration,
} = require('../catalogs/model.js');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function publishCollectionFiles(files, io) {
  const staged = [];
  const retainedBackups = new Set();
  const cleanup = () => {
    for (const entry of staged) {
      for (const temporary of [entry.stagePath, entry.backupPath]) {
        if (!temporary || retainedBackups.has(temporary)) continue;
        try {
          if (io.existsSync(temporary)) io.unlinkSync(temporary);
        } catch {}
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
        published: false,
      };
      staged.push(entry);
      if (entry.existed) {
        const stat = io.lstatSync(file.target);
        if (!stat.isFile() || stat.isSymbolicLink()) {
          throw new CatalogError(`Cannot publish collection over non-regular file: ${file.target}`);
        }
        entry.mode = stat.mode & 0o777;
        entry.backupPath = `${file.target}.${suffix}.backup`;
        io.writeFileSync(entry.backupPath, io.readFileSync(file.target), {
          flag: 'wx',
          mode: entry.mode,
        });
      }
      io.writeFileSync(entry.stagePath, file.contents, { flag: 'wx', mode: entry.mode });
    }
  } catch (error) {
    cleanup();
    throw error;
  }
  try {
    for (const entry of staged) {
      io.renameSync(entry.stagePath, entry.target);
      entry.published = true;
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const entry of [...staged].reverse()) {
      if (!entry.published) continue;
      try {
        if (entry.existed) io.renameSync(entry.backupPath, entry.target);
        else if (io.existsSync(entry.target)) io.unlinkSync(entry.target);
      } catch (rollbackError) {
        if (entry.backupPath) retainedBackups.add(entry.backupPath);
        rollbackErrors.push(
          entry.backupPath
            ? `${rollbackError.message}; recovery copy retained at ${entry.backupPath}`
            : rollbackError.message,
        );
      }
    }
    cleanup();
    const rollback = rollbackErrors.length ? ` Rollback failed: ${rollbackErrors.join('; ')}` : '';
    throw new CatalogError(`Cannot publish resource collection: ${error.message}.${rollback}`);
  }
  cleanup();
}

function importCollectionText(contents, io = fs, { trustedKey }: { trustedKey?: unknown } = {}) {
  if (typeof contents !== 'string' || Buffer.byteLength(contents, 'utf8') > 2 * 1024 * 1024) {
    throw new CatalogError('Resource collection must be a JSON file no larger than 2 MiB');
  }
  let manifest;
  try {
    manifest = JSON.parse(contents);
  } catch {
    throw new CatalogError('Resource collection is not valid JSON');
  }
  verifyCollectionSignature(manifest, trustedKey);
  const incoming = validateCollectionManifest(manifest);
  const current = loadUserSourceConfiguration();
  const existingNames = new Set(current.map(({ name }) => catalogNameKey(name)));
  const existingRepositories = new Set(current.map(({ repositoryId: id }) => id));
  for (const { source } of incoming) {
    if (isReservedCatalogName(source.name)) {
      throw new CatalogError(`Cannot import collection: catalog name is reserved (${source.name})`);
    }
    if (existingNames.has(catalogNameKey(source.name)) || existingRepositories.has(repositoryId(source.repository))) {
      throw new CatalogError(
        `Cannot import collection: catalog name or repository is already configured (${source.name})`,
      );
    }
  }
  // All untrusted manifest data and configuration conflicts are checked before persistent changes.
  const directory = userCatalogDirectory();
  const indexDirectory = userCatalogIndexDirectory();
  const combined = [
    ...current.map(({ name, repository, mode, entries }) => ({
      name,
      repository,
      ...(mode === 'custom' ? { mode, entries } : {}),
    })),
    ...incoming.map(({ source }) => source),
  ];
  validateSourceConfiguration({ catalog_version: 1, sources: combined });
  for (const { source } of incoming) {
    const existingLegacy = io.existsSync(indexDirectory)
      ? io
          .readdirSync(indexDirectory)
          .some(
            (entry) =>
              entry.toLowerCase().endsWith('.json') &&
              entry.toUpperCase() !== 'CATALOGSOURCES.JSON' &&
              catalogNameKey(entry.slice(0, -5)) === catalogNameKey(source.name),
          )
      : false;
    if (io.existsSync(path.join(indexDirectory, catalogIndexFileName(source.name))) || existingLegacy) {
      throw new CatalogError(
        `Cannot import collection: an unregistered catalog index already exists for ${source.name}`,
      );
    }
  }
  io.mkdirSync(directory, { recursive: true, mode: 0o700 });
  io.mkdirSync(indexDirectory, { recursive: true, mode: 0o700 });
  if (incoming.length) io.mkdirSync(path.join(indexDirectory, '.kitia-index'), { recursive: true, mode: 0o700 });
  const registry = `${JSON.stringify({ catalog_version: 1, sources: combined }, null, 2)}\n`;
  const files = incoming.map(({ source, index }) => ({
    target: path.join(indexDirectory, catalogIndexFileName(source.name)),
    contents: `${JSON.stringify(index, null, 2)}\n`,
  }));
  files.push(
    { target: path.join(indexDirectory, 'catalogSources.json'), contents: registry },
    { target: path.join(directory, 'catalogSources.json'), contents: registry },
  );
  publishCollectionFiles(files, io);
  return incoming.map(({ source }) => source.name);
}

module.exports = { publishCollectionFiles, importCollectionText };
