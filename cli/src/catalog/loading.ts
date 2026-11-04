"use strict";
const fs = require("node:fs");

const { CatalogError } = require("./resources/index.js");
const { readInstallState } = require("./inventory/index.js");
const { loadUserSourceConfiguration, userCatalogIndexDirectory } = require("./sources/config.js");
const { sourceResourceRecords, inventorySourceNames } = require("./sources/installed.js");
const { loadSourceCatalogsFromDirectory } = require("./sources/loader.js");

function sourceResourcesFromInventory(state) {
  return [...sourceResourceRecords(state)].map(([key, record]) => {
    const [catalog, kind, id] = key.split(":");
    return {
      id,
      kind,
      catalog,
      source_repository: record.source_repository,
      source_path: record.source_path,
      source_ref: record.source_ref || null,
      description: `Tracked source ${kind} installation.`,
      license_status: record.license_status || "not-declared",
      ...(record.apply_to ? { apply_to: record.apply_to, applyTo: record.apply_to } : {}),
    };
  });
}

function loadCommandCatalogs(options, warn = (_warning) => {}) {
  const { command, catalog, kind, id } = options;
  const sources = loadUserSourceConfiguration();
  const sourceNames = sources.map(({ name }) => name);
  let names;
  if (command === "validate") names = catalog ? [catalog] : sourceNames;
  else if (catalog) names = [catalog];
  else if (["check", "dashboard"].includes(command) || (command === "update" && !id)) {
    names = sourceNames;
  } else if (command === "update" || command === "uninstall") {
    const state = readInstallState(fs.realpathSync(options.target));
    const sourceRecords = sourceResourceRecords(state);
    names = inventorySourceNames(state).filter((name) =>
      (command === "uninstall" || sourceNames.includes(name)) &&
      [...sourceRecords.keys()].some((key) => key.startsWith(`${name}:`) &&
        (!id || key.split(":")[2] === id) && (!kind || key.split(":")[1] === kind)));
  } else names = sourceNames;

  const loaded = { sourceResources: [], unavailable: [] };
  if (command === "uninstall") {
    const state = readInstallState(fs.realpathSync(options.target));
    const installedSourceNames = inventorySourceNames(state);
    names = names.filter((name) => installedSourceNames.includes(name) || name === options.catalog);
    loaded.sourceResources = sourceResourcesFromInventory(state)
      .filter((resource) => names.includes(resource.catalog) &&
        (!id || resource.id === id) && (!kind || kind === resource.kind));
    const sourceCatalogNeedsDiscovery = options.catalog &&
      sourceNames.includes(options.catalog) && !installedSourceNames.includes(options.catalog);
    if (!sourceCatalogNeedsDiscovery) return loaded;
  }

  let sourceResources;
  const loadSources = () => {
    if (sourceResources) return sourceResources;
    sourceResources = options.sourceResources || (sources.length
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
      if (!["list", "search"].includes(command)) throw new CatalogError(message, code);
      loaded.unavailable.push(name);
      warn({ code, catalog: name, message });
    }
  }
  return loaded;
}

module.exports = { loadCommandCatalogs };