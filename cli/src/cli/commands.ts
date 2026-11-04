"use strict";

const fs = require("node:fs");
const os = require("node:os");
const { CatalogError, USER_INSTALLABLE_KINDS } = require("../catalog/resources/index.js");
const inventoryApi = require("../catalog/inventory/index.js");
const terminalApi = require("../dashboard/terminal.js");
const sourceSkillsApi = require("../catalog/sources/skills.js");
const sourceInventoryApi = require("../catalog/sources/installed.js");
const lifecycleApi = require("../catalog/lifecycle.js");
const { acquireOperationLock } = require("../catalog/operation.js");
const { loadCommandCatalogs } = require("../catalog/loading.js");
const { diagnose } = require("../catalog/doctor.js");
const {
  manageCatalogCommand, addCatalog, updateCatalog, refreshCatalogs, checkCatalogFreshness, removeCatalog,
} = require("../catalog/sources/manage.js");
const { loadUserSourceConfiguration } = require("../catalog/sources/config.js");
const { catalogEntries, listCatalogResources, formatDashboardRows } = require("./catalog.js");
const { createDashboardActionHandler } = require("./dashboard.js");
const { parseArguments, printHelp } = require("./arguments.js");
const { readInstalledSourceSkills, readInstalledSourceResources } = sourceInventoryApi;
const {
  runSourceCommand, formatSourceResource, validateSourceUpdates, updateSourceResources, uninstallSourceResource,
} = sourceSkillsApi;
const { checkInstalledResources, collectInstalledScopes } = lifecycleApi;
const {
  formatCatalogHeader, formatCatalogRow, resolveCatalogResource, selectCatalogResource,
  renderInstalledResources, browseInstalledResources, colorize,
} = terminalApi;
const { executeDashboardAction } = (() => {
  const handler = createDashboardActionHandler(
    (options, report) => executeCommand(options, report),
  );
  return { executeDashboardAction: handler };
})();


function selectedSourceResource(resources, options) {
  return resolveCatalogResource(
    resources,
    options.id,
    options.kind,
    options.nonInteractive ? (candidates) => {
      throw new CatalogError(
        `Resource '${options.id}' is ambiguous: ${candidates.map((entry) => `${entry.catalog}:${entry.kind}:${entry.id}`).join(", ")}. Specify a kind and source catalog where needed.`,
        "AMBIGUOUS_RESOURCE",
      );
    } : selectCatalogResource,
  );
}

async function executeCommand(options, report) {
  const output = options.output || console;
  if (options.scope === "user") output.log(`User scope: ${options.target}`);
  if (options.command === "help") {
    printHelp();
    return 0;
  }
  if (options.command === "catalog") return manageCatalogCommand(options);
  if (options.command === "doctor") {
    const result = diagnose(options);
    if (report) {
      report.checks = result.checks;
    } else {
      for (const check of result.checks) console.log(`${check.status.toUpperCase()} ${check.id}: ${check.message}`);
    }
    return result.attention ? report ? 2 : 1 : 0;
  }

  const catalogWarnings = [];
  const { sourceResources, unavailable } = loadCommandCatalogs(options, (warning) => {
    catalogWarnings.push(warning);
    if (options.command === "dashboard") return;
    if (report) report.warnings.push(warning);
    else if (options.json) console.error(JSON.stringify(warning));
    else output.error(`Warning: ${warning.message}`);
  });
  const allResources = catalogEntries(sourceResources);

  if (options.command === "validate") {
    console.log(`Validated ${sourceResources.length} resources across configured user catalogs.`);
    return unavailable.length ? 1 : 0;
  }
  if (options.command === "list" || options.command === "search") {
    const matches = listCatalogResources(sourceResources, options);
    if (options.json) {
      console.log(JSON.stringify(matches.map(({ source, applyTo, ...entry }) => entry), null, 2));
    } else {
      console.log(formatCatalogHeader());
      for (const resource of matches) console.log(formatCatalogRow(resource));
      if (!matches.length) console.log("No matching resources.");
    }
    return unavailable.length ? 1 : 0;
  }
  if (options.command === "check") {
    const result = checkInstalledResources(options.target, sourceResources, options);
    if (report) {
      report.resources = result.resources;
      report.messages = result.messages;
      return result.updateAvailable || unavailable.length ? 2 : 0;
    }
    for (const message of result.messages) console.log(message);
    if (result.updateAvailable) console.log("Updates or installation issues require attention.");
    return result.updateAvailable || unavailable.length ? 1 : 0;
  }
  if (options.command === "dashboard") {
    const result = collectInstalledScopes(
      { project: options.target, user: os.homedir() },
      sourceResources,
    );
    result.errors.push(...catalogWarnings.map((warning) => ({ ...warning, scope: "catalog" })));
    const rows = formatDashboardRows(result.resources, allResources);
    if (!options.nonInteractive && process.stdin.isTTY && process.stdout.isTTY &&
        typeof process.stdin.setRawMode === "function") {
      const userCatalogState = () => loadUserSourceConfiguration().map(({ name, repository, mode, entries }) => ({
        name, repository, mode, entries,
      }));
      const completed = await browseInstalledResources(rows, process.stdin, process.stdout, result.errors, {
        catalogResources: sourceResources,
        addCatalog: async (request) => {
          const catalog = addCatalog(request.name, request.repository, {
            mode: request.mode,
            entries: request.entries,
          });
          const refreshed = loadCommandCatalogs({ command: "list" }, () => {});
          return {
            catalog: request.name,
            count: catalog.resources.length,
            catalogs: userCatalogState(),
            resources: catalogEntries(refreshed.sourceResources),
          };
        },
        updateCatalog: async (originalName, request) => {
          const catalog = updateCatalog(originalName, request.name, request.repository, {
            mode: request.mode,
            entries: request.entries,
          });
          const refreshed = loadCommandCatalogs({ command: "list" }, () => {});
          return {
            catalog: request.name,
            count: catalog.resources.length,
            catalogs: userCatalogState(),
            resources: catalogEntries(refreshed.sourceResources),
          };
        },
        userCatalogs: userCatalogState(),
        checkCatalogFreshness,
        removeCatalog: async (name) => {
          removeCatalog(name);
          const refreshed = loadCommandCatalogs({ command: "list" }, () => {});
          return { catalogs: userCatalogState(), resources: catalogEntries(refreshed.sourceResources) };
        },
        refreshCatalog: async (name) => {
          const result = refreshCatalogs(name ? [name] : undefined);
          const refreshed = loadCommandCatalogs({ command: "list" }, () => {});
          return { ...result, catalogs: userCatalogState(), resources: catalogEntries(refreshed.sourceResources) };
        },
        execute: (operation, resource, installOptions) => executeDashboardAction(
          operation,
          resource,
          { ...options, userTarget: os.homedir() },
          { sourceResources, warnings: catalogWarnings },
          installOptions,
        ),
      });
      return unavailable.length || result.errors.length || !completed ? 1 : 0;
    }
    console.log(renderInstalledResources(rows, process.stdout, result.errors));
    return unavailable.length || result.errors.length ? 1 : 0;
  }
  if (options.command === "uninstall") {
    const target = fs.realpathSync(options.target);
    const installed = [
      ...readInstalledSourceSkills(target, sourceResources, { catalog: options.catalog }),
      ...readInstalledSourceResources(target, sourceResources, { catalog: options.catalog }),
    ].filter(({ resource }) => resource.id === options.id && (!options.kind || resource.kind === options.kind));
    if (!installed.length) {
      throw new CatalogError(`No tracked source installation for ${options.kind ? `${options.kind}:` : ""}${options.id}`, "RESOURCE_NOT_FOUND");
    }
    const resource = installed.length === 1
      ? installed[0].resource
      : await selectedSourceResource(installed.map(({ resource: entry }) => entry), options);
    if (!resource) return 0;
    options.onResource?.({ catalog: resource.catalog || "source", kind: resource.kind, id: resource.id, status: "planned", source: true });
    for (const message of uninstallSourceResource(resource, target, options)) output.log(message);
    return 0;
  }
  if (options.command === "update") {
    const target = fs.realpathSync(options.target);
    const installed = [
      ...readInstalledSourceSkills(target, sourceResources, { catalog: options.catalog }),
      ...readInstalledSourceResources(target, sourceResources, { catalog: options.catalog }),
    ];
    let sourceToUpdate = options.id
      ? installed.filter(({ resource }) => resource.id === options.id && (!options.kind || resource.kind === options.kind))
      : installed;
    if (options.id && sourceToUpdate.length > 1) {
      const chosen = await selectedSourceResource(sourceToUpdate.map(({ resource }) => resource), options);
      if (!chosen) return 0;
      sourceToUpdate = sourceToUpdate.filter(({ resource }) => resource.catalog === chosen.catalog && resource.kind === chosen.kind);
    }
    if (!sourceToUpdate.length) {
      throw new CatalogError(options.id
        ? `No tracked source installation for ${options.kind ? `${options.kind}:` : ""}${options.id}`
        : "No tracked source resources to update.", "RESOURCE_NOT_FOUND");
    }
    const sourceToUpdateResources = sourceToUpdate.map(({ resource }) => resource);
    validateSourceUpdates(sourceToUpdate, options);
    if (options.offline && !options.dryRun) {
      throw new CatalogError("Updating source resources requires network access. Use --dry-run while offline.", "INVALID_ARGUMENT");
    }
    for (const resource of sourceToUpdateResources) {
      options.onResource?.({ catalog: resource.catalog || "source", kind: resource.kind, id: resource.id, status: "planned", source: true });
    }
    for (const message of updateSourceResources(sourceToUpdate, target, options)) output.log(message);
    return 0;
  }
  if (["show", "preview", "install"].includes(options.command)) {
    const resource = await selectedSourceResource(allResources, options);
    if (!resource) return 0;
    if (options.command === "show") {
      console.log(formatSourceResource(resource));
      return 0;
    }
    if (options.command === "preview") {
      return runSourceCommand({ ...options, action: "preview", id: resource.id, resource });
    }
    if (options.scope === "user" && !USER_INSTALLABLE_KINDS.has(resource.kind)) {
      throw new CatalogError("--scope user supports source skills and agents; instructions are project-only", "INVALID_ARGUMENT");
    }
    return runSourceCommand({ ...options, action: "install", id: resource.id, resource });
  }
  throw new CatalogError(`Unsupported command: ${options.command || "unknown"}`);
}

module.exports = {
  ...inventoryApi,
  ...terminalApi,
  ...sourceSkillsApi,
  ...sourceInventoryApi,
  ...lifecycleApi,
  parseArguments,
  printHelp,
  catalogEntries,
  listCatalogResources,
  executeDashboardAction,
  executeCommand,
};