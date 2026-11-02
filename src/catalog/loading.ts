"use strict";

const fs = require("node:fs");
const {
  CatalogError, LOCAL_KINDS, loadCatalog,
} = require("./resources/index.js");
const { validateCatalog } = require("./resources/files.js");
const { readInstallState } = require("./inventory/index.js");
const {
  loadSourceConfiguration, loadUserSourceConfiguration, userCatalogIndexDirectory,
} = require("./sources/config.js");
const {
  sourceResourceRecords, inventorySourceNames,
} = require("./sources/installed.js");
const {
  loadSourceCatalogsFromDirectory, loadPublishedSourceCatalogs,
} = require("./sources/loader.js");
import type { CatalogResource, InstallState } from "../types.js";

function sourceCatalogNames(sources) {
  return sources.map(({ name }) => name);
}

function sourceResourcesFromInventory(state: InstallState): CatalogResource[] {
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

function loadCommandCatalogs(options, root, warn) {
  const { command, catalog, kind, id } = options;
  const sources = loadSourceConfiguration(root);
  const sourceNames = sourceCatalogNames(sources);
  const allNames = ["internal", ...sourceNames];
  let names;
  if (command === "validate") names = catalog ? [catalog] : allNames;
  else if (catalog) names = [catalog];
  else if (["check", "dashboard"].includes(command) || (command === "update" && !id)) {
    names = allNames;
  }
  else if (command === "update" || command === "uninstall") {
    const state = readInstallState(fs.realpathSync(options.target));
    const internal = [...Object.keys(state.resources), ...Object.keys(state.bundles || {}).map((key) => `bundle:${key}`),
      ...Object.keys(state.mcps || {}).map((key) => `mcp:${key}`)].some((key) =>
      (!id || key.split(":")[1] === id) && (!kind || key.split(":")[0] === kind));
    const sourceRecords = sourceResourceRecords(state);
    const installedSources = inventorySourceNames(state).filter((name) =>
      (command === "uninstall" || sourceNames.includes(name)) &&
      [...sourceRecords.keys()].some((key) => key.startsWith(`${name}:`) &&
        (!id || key.split(":")[2] === id) && (!kind || key.split(":")[1] === kind)));
    names = [...(internal ? ["internal"] : []), ...installedSources];
  } else if (options.group) names = ["internal"];
  else names = allNames;

  const loaded = { resources: [], sourceResources: [], unavailable: [] };
  if (command === "uninstall") {
    const state = readInstallState(fs.realpathSync(options.target));
    loaded.resources = names.includes("internal") ? Object.keys(state.resources).map((key) => {
      const [resourceKind, resourceId] = key.split(":");
      return { kind: resourceKind, id: resourceId, catalog: "internal", description: "Tracked local installation." };
    }) : [];
    const installedSourceNames = inventorySourceNames(state);
    names = names.filter((name) => name === "internal" || installedSourceNames.includes(name) ||
      name === options.catalog);
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
    if (options.sourceResources) {
      sourceResources = options.sourceResources;
    } else if (process.env.KITI_SOURCE_CATALOGS) {
      if (options.refreshCatalog) {
        throw new CatalogError("--refresh-catalog cannot be combined with KITI_SOURCE_CATALOGS", "INVALID_ARGUMENT");
      }
      sourceResources = loadSourceCatalogsFromDirectory(process.env.KITI_SOURCE_CATALOGS, sources);
    } else {
      const userSources = loadUserSourceConfiguration();
      const userNames = new Set(userSources.map(({ name }) => name));
      const bundledSources = sources.filter((source) => !userNames.has(source.name));
      sourceResources = [];
      if (userSources.length) {
        sourceResources.push(...loadSourceCatalogsFromDirectory(userCatalogIndexDirectory(), userSources));
      }
      if (bundledSources.length) {
        sourceResources.push(...loadPublishedSourceCatalogs(options, (warning) => {
          if (warning.code === "SOURCE_CATALOG_STALE") loaded.unavailable.push(...bundledSources.map(({ name }) => name));
          warn(warning);
        }, undefined, bundledSources));
      }
    }
    return sourceResources;
  };

  const loaders = {
    internal: () => {
      const resources = command === "validate" ? validateCatalog(root) : loadCatalog(root);
      if (resources.some((entry) => !LOCAL_KINDS.has(entry.kind) || !entry.group)) {
        throw new CatalogError("catalog.json may contain only grouped installable resources");
      }
      loaded.resources = resources;
    },
  };
  for (const source of sources) {
    loaders[source.name] = () => {
      loaded.sourceResources.push(...loadSources().filter((resource) => resource.catalog === source.name));
    };
  }
  for (const name of names) {
    if (command === "uninstall" && name === "internal") continue;
    const loader = loaders[name];
    if (!loader) {
      throw new CatalogError(`Unknown catalog: ${name}`, "INVALID_ARGUMENT");
    }
    try {
      loader();
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const message = `${name} catalog unavailable: ${error.message}`;
      const errorCode = (error as Error & { code?: string }).code;
      const code = errorCode && ["UNSUPPORTED_CATALOG_VERSION", "UNSUPPORTED_RESOURCE_KIND", "INVALID_ARGUMENT"].includes(errorCode)
        ? errorCode : "CATALOG_UNAVAILABLE";
      if (!["list", "search"].includes(command)) {
        throw new CatalogError(message, code);
      }
      loaded.unavailable.push(name);
      warn({ code, catalog: name, message });
    }
  }
  return loaded;
}

module.exports = { loadCommandCatalogs };
