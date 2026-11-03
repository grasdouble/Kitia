"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createInterface } = require("node:readline/promises");
const resourcesApi = require("../catalog/resources/index.js");
const resourceFilesApi = require("../catalog/resources/files.js");
const installPlanApi = require("../catalog/resources/install-plan.js");
const inventoryApi = require("../catalog/inventory/index.js");
const terminalApi = require("../dashboard/terminal.js");
const sourceSkillsApi = require("../catalog/sources/skills.js");
const sourceInventoryApi = require("../catalog/sources/installed.js");
const lifecycleApi = require("../catalog/lifecycle.js");
const bundleApi = {
  ...require("../catalog/bundles/index.js"),
  ...require("../catalog/bundles/removal.js"),
  ...require("../catalog/bundles/check.js"),
};
const bundleUtilsApi = require("../catalog/bundles/utils.js");
const api = {
  ...resourcesApi, ...resourceFilesApi, ...installPlanApi, ...inventoryApi,
  ...terminalApi, ...sourceSkillsApi, ...sourceInventoryApi, ...lifecycleApi, ...bundleApi,
  ...bundleUtilsApi,
};
const {
  CATALOG_ROOT, CatalogError, LOCAL_KINDS, USER_INSTALLABLE_KINDS,
  runSourceCommand, validateCatalog,
  readInstallState, readInstalledSourceSkills, readInstalledSourceResources, sourceResourceRecords,
  uninstallSourceResource, resolveCatalogResource,
  uninstallResource, formatResource, formatSourceResource, formatCatalogHeader, formatCatalogRow,
  checkInstalledResources, collectInstalledScopes, readBuildInfo, previewResource, browseResourceFiles,
  renderInstalledResources, browseInstalledResources,
  validateSourceUpdates, installResources, updateSourceResources, colorize,
  validateResource, resourceOwnsPath, selectCatalogResource, isUserResource,
  installConfiguredResources, uninstallBundle, uninstallMcp, isUserMcp, validateBundleReferences,
  uninstallResourceWithBundles, cascadeSummaryText,
} = api;
const { acquireOperationLock } = require("../catalog/operation.js");
const { loadCommandCatalogs } = require("../catalog/loading.js");
const { diagnose } = require("../catalog/doctor.js");
const { parseArguments, printHelp } = require("./arguments.js");
const {
  manageCatalogCommand, addCatalog, updateCatalog, refreshCatalogs, checkCatalogFreshness, removeCatalog,
} = require("../catalog/sources/manage.js");
const { loadUserSourceConfiguration } = require("../catalog/sources/config.js");
const { catalogEntries, listCatalogResources, formatDashboardRows } = require("./catalog.js");
const { createDashboardActionHandler } = require("./dashboard.js");
import type { CliOptions } from "./arguments.js";
import type { InstallState } from "../catalog/inventory/files.js";
import type { CliReport } from "./report.js";
import type { CascadeSummary } from "../catalog/bundles/removal.js";

const executeDashboardAction = createDashboardActionHandler(
  (options, root, report) => executeCommand(options, root, report),
);

async function confirmCascade(
  summary: CascadeSummary,
  plan: string[],
  output: { log(message: string): void },
): Promise<boolean> {
  output.log(cascadeSummaryText(summary));
  for (const message of plan) output.log(message);
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^(y|yes)$/i.test(await terminal.question("Proceed with removing the bundles and dependencies above? [y/N] "));
  } finally {
    terminal.close();
  }
}

async function executeCommand(
  options: CliOptions,
  catalogRoot: string,
  report: CliReport | null,
): Promise<number> {
  const output = options.output || console;
  if (options.scope === "user") output.log(`User scope: ${options.target}`);
  const resolve = (resources, id, kind) => resolveCatalogResource(resources, id, kind,
    options.nonInteractive ? (candidates) => {
      const candidatesList = candidates.map((entry) =>
        entry.catalog === "internal" && !entry.source_repository
          ? `local:${entry.kind}:${entry.id}` : `${entry.catalog}:${entry.kind}:${entry.id}`);
      throw new CatalogError(`Resource '${id}' is ambiguous: ${candidatesList.join(", ")}. Specify a kind and a source catalog where needed.`, "AMBIGUOUS_RESOURCE");
    } : selectCatalogResource);
  if (options.command === "help") {
    printHelp();
    return 0;
  }
  if (options.command === "catalog") return manageCatalogCommand(options);
  if (options.command === "doctor") {
    const result = diagnose(options);
    if (report) report.checks = result.checks;
    else for (const check of result.checks) console.log(`${check.status.toUpperCase()} ${check.id}: ${check.message}`);
    return result.attention ? report ? 2 : 1 : 0;
  }
  const catalogWarnings = [];
  const { resources, sourceResources, unavailable } = loadCommandCatalogs(options, catalogRoot,
    (warning) => {
      catalogWarnings.push(warning);
      if (options.command === "dashboard") return;
      if (report) report.warnings.push(warning);
      else if (options.json) console.error(JSON.stringify(warning));
      else output.error(`Warning: ${warning.message}`);
    });
  const allResources = catalogEntries(resources, sourceResources);
  if (options.command === "uninstall") {
    const target = fs.realpathSync(options.target);
    const state: InstallState = readInstallState(target);
    const bundleRecords = state.bundles || {};
    const hasSourceInstallation = (resourceId: string) =>
      [...sourceResourceRecords(state).keys()].some((key) => key.endsWith(`:${resourceId}`));
    const matchingBundle = (!options.kind || options.kind === "bundle") &&
      !options.catalog && Object.hasOwn(state.bundles || {}, options.id) &&
      (options.scope !== "user" || state.bundles[options.id].scope === "user");
    if (matchingBundle) {
      const ambiguous = !options.kind && (Object.keys(state.resources).some((key) =>
        key.split(":")[1] === options.id) || Object.hasOwn(state.mcps || {}, options.id) ||
        hasSourceInstallation(options.id));
      if (ambiguous) throw new CatalogError(`Resource '${options.id}' is ambiguous; specify bundle as the kind.`, "AMBIGUOUS_RESOURCE");
      if (options.cascade) {
        throw new CatalogError("--cascade applies when uninstalling a resource required by bundles; uninstall a bundle directly without it.", "INVALID_ARGUMENT");
      }
      for (const message of uninstallBundle(options.id, target, options)) output.log(message);
      return 0;
    }
    const matchingMcp = (!options.kind || options.kind === "mcp") &&
      !options.catalog && Object.hasOwn(state.mcps || {}, options.id) &&
      (options.scope !== "user" || isUserMcp(state.mcps[options.id]));
    if (matchingMcp) {
      const ambiguous = !options.kind && (Object.keys(state.resources).some((key) =>
        key.split(":")[1] === options.id) || Object.hasOwn(state.bundles || {}, options.id) ||
        hasSourceInstallation(options.id));
      if (ambiguous) throw new CatalogError(`Resource '${options.id}' is ambiguous; specify mcp as the kind.`, "AMBIGUOUS_RESOURCE");
      const dependents = Object.entries(bundleRecords).filter(([, bundle]) =>
        bundle.resources.some((member) => member.kind === "mcp" && member.id === options.id));
      if (dependents.length && (options.dryRun || options.cascade ||
          !options.nonInteractive && process.stdin.isTTY && process.stdout.isTTY)) {
        const messages = await uninstallResourceWithBundles("mcp", options.id, target, {
          ...options,
          confirm: options.cascade ? undefined : (summary, plan) =>
            confirmCascade(summary, plan, output),
        });
        for (const message of messages) output.log(message);
        return 0;
      }
      if (dependents.length) {
        throw new CatalogError(
          `mcp:${options.id} is required by bundles: ${dependents.map(([bundleId]) => bundleId).join(", ")}. Re-run with --cascade to remove them non-interactively.`,
          "LOCAL_CONFLICT",
        );
      }
      if (options.cascade) {
        throw new CatalogError(`No bundles depend on mcp:${options.id}; --cascade is not needed.`, "INVALID_ARGUMENT");
      }
      if (!dependents.length) options.onResource?.({ catalog: "internal", kind: "mcp", id: options.id, status: "planned" });
      for (const message of uninstallMcp(options.id, target, options)) output.log(message);
      return 0;
    }
    const installedSourceResources = [
      ...readInstalledSourceSkills(target, sourceResources, { catalog: options.catalog }),
      ...readInstalledSourceResources(target, sourceResources, { catalog: options.catalog }),
    ].filter(({ resource }) =>
      resource.id === options.id && (!options.kind || resource.kind === options.kind),
    );
    let keys = (options.catalog ? [] : Object.keys(state.resources)).filter((key) => {
      const [kind, id] = key.split(":");
      return id === options.id && (!options.kind || kind === options.kind) &&
        (options.scope !== "user" || isUserResource(key, state.resources[key]));
    });
    if (keys.length && installedSourceResources.length) {
      throw new CatalogError(
        `Resource ID '${options.id}' is installed from multiple catalogs; specify --catalog.`,
      );
    }
    if (installedSourceResources.length > 1) {
      throw new CatalogError(`Resource ID '${options.id}' is installed from multiple source catalogs; specify --catalog.`);
    }
    if (!keys.length && !installedSourceResources.length) {
      throw new CatalogError(`No tracked installation for ${options.kind ? `${options.kind}:` : ""}${options.id}`, "RESOURCE_NOT_FOUND");
    }
    if (installedSourceResources.length) {
      if (options.cascade) {
        throw new CatalogError("--cascade applies only to locally managed resources used by bundles.", "INVALID_ARGUMENT");
      }
      options.onResource?.({
        catalog: installedSourceResources[0].resource.catalog || "source",
        kind: installedSourceResources[0].resource.kind, id: options.id, status: "planned", source: true,
      });
      for (const message of uninstallSourceResource(
        installedSourceResources[0].resource, target, options,
      )) {
        output.log(message);
      }
      return 0;
    }
    if (options.id && keys.length > 1) {
      const tracked = resources.filter((resource) =>
        keys.includes(`${resource.kind}:${resource.id}`),
      ).map((resource) => ({
        ...resource,
        catalog: "internal",
      }));
      const selectedResource = await resolve(
        tracked, options.id, options.kind,
      );
      if (!selectedResource) {
        return 0;
      }
      keys = [`${selectedResource.kind}:${selectedResource.id}`];
    }
    const [kind, id] = keys[0].split(":");
    const dependents = Object.entries(bundleRecords).filter(([, bundle]) =>
      bundle.resources.some((member) => member.kind === kind && member.id === id));
    if (dependents.length && (options.dryRun || options.cascade ||
        !options.nonInteractive && process.stdin.isTTY && process.stdout.isTTY)) {
      const messages = await uninstallResourceWithBundles(kind, id, target, {
        ...options,
        confirm: options.cascade ? undefined : (summary, plan) =>
          confirmCascade(summary, plan, output),
      });
      for (const message of messages) output.log(message);
      return 0;
    }
    if (dependents.length) {
      throw new CatalogError(
        `${kind}:${id} is required by bundles: ${dependents.map(([bundleId]) => bundleId).join(", ")}. Re-run with --cascade to remove them non-interactively.`,
        "LOCAL_CONFLICT",
      );
    }
    if (options.cascade) {
      throw new CatalogError(`No bundles depend on ${kind}:${id}; --cascade is not needed.`, "INVALID_ARGUMENT");
    }
    options.onResource?.({ catalog: "internal", kind, id, status: "planned" });
    for (const message of uninstallResource(kind, id, options.target, options)) {
      output.log(message);
    }
    return 0;
  }
  if (options.command === "validate") {
    if (resources.some((resource) => resource.kind === "bundle")) {
      validateBundleReferences(resources);
    }
    console.log(`Validated ${sourceResources.length} resources across configured user catalogs.`);
    return unavailable.length ? 1 : 0;
  }
  if (options.command === "list" || options.command === "search") {
    const matches = listCatalogResources(resources, sourceResources, options);
    if (options.json) {
      console.log(JSON.stringify(matches.map(({ source, applyTo, ...entry }) => entry), null, 2));
    } else {
      console.log(formatCatalogHeader());
      for (const resource of matches) {
        console.log(formatCatalogRow(resource));
      }
      if (!matches.length) {
        console.log("No matching resources.");
      }
    }
    return unavailable.length ? 1 : 0;
  }
  if (options.command === "check") {
    const result = checkInstalledResources(
      options.target,
      resources,
      catalogRoot,
      readBuildInfo(catalogRoot),
      sourceResources,
      options,
    );
    if (report) {
      const sourceIdentities = new Set(sourceResources.map((resource) =>
        `${resource.catalog}:${resource.kind}:${resource.id}`));
      report.resources = result.resources.map((resource) => {
        if (resource.catalog !== "internal" || sourceIdentities.has(`${resource.catalog}:${resource.kind}:${resource.id}`)) {
          return resource;
        }
        const { catalog: _catalog, ...localResource } = resource;
        return localResource;
      });
      report.messages = result.messages;
      return result.updateAvailable || unavailable.length ? 2 : 0;
    }
    for (const message of result.messages) {
      console.log(message);
    }
    if (result.updateAvailable) {
      console.log("Updates or installation issues require attention.");
    }
    return result.updateAvailable || unavailable.length ? 1 : 0;
  }
  if (options.command === "dashboard") {
    const buildInfo = readBuildInfo(catalogRoot);
    const result = collectInstalledScopes(
      { project: options.target, user: os.homedir() },
      resources,
      catalogRoot,
      buildInfo,
      sourceResources,
    );
    result.errors.push(...catalogWarnings.map((warning) => ({ ...warning, scope: "catalog" })));
    const rows = formatDashboardRows(result.resources, allResources);
    if (!options.nonInteractive && process.stdin.isTTY && process.stdout.isTTY &&
        typeof process.stdin.setRawMode === "function") {
      const userCatalogState = () => loadUserSourceConfiguration().map(({
        name, repository, mode, entries,
      }) => ({ name, repository, mode, entries }));
      const catalogResources = allResources.filter((resource) =>
        LOCAL_KINDS.has(resource.kind));
      const completed = await browseInstalledResources(rows, process.stdin, process.stdout, result.errors, {
        catalogResources,
        addCatalog: async (request) => {
          const catalog = addCatalog(request.name, request.repository, {
            mode: request.mode,
            entries: request.entries,
          });
          const refreshed = loadCommandCatalogs({ command: "list" }, catalogRoot, () => {});
          return {
            catalog: request.name,
            count: catalog.resources.length,
            catalogs: userCatalogState(),
            resources: catalogEntries(resources, refreshed.sourceResources)
              .filter((resource) => LOCAL_KINDS.has(resource.kind)),
          };
        },
        updateCatalog: async (originalName, request) => {
          const catalog = updateCatalog(originalName, request.name, request.repository, {
            mode: request.mode,
            entries: request.entries,
          });
          const refreshed = loadCommandCatalogs({ command: "list" }, catalogRoot, () => {});
          return {
            catalog: request.name,
            count: catalog.resources.length,
            catalogs: userCatalogState(),
            resources: catalogEntries(resources, refreshed.sourceResources)
              .filter((resource) => LOCAL_KINDS.has(resource.kind)),
          };
        },
        userCatalogs: userCatalogState(),
        checkCatalogFreshness,
        removeCatalog: async (name) => {
          removeCatalog(name);
          const refreshed = loadCommandCatalogs({ command: "list" }, catalogRoot, () => {});
          return {
            catalogs: userCatalogState(),
            resources: catalogEntries(resources, refreshed.sourceResources)
              .filter((resource) => LOCAL_KINDS.has(resource.kind)),
          };
        },
        refreshCatalog: async (name) => {
          const result = refreshCatalogs(name ? [name] : undefined);
          const refreshed = loadCommandCatalogs({ command: "list" }, catalogRoot, () => {});
          return {
            ...result,
            catalogs: userCatalogState(),
            resources: catalogEntries(resources, refreshed.sourceResources)
              .filter((resource) => LOCAL_KINDS.has(resource.kind)),
          };
        },
        execute: (operation, resource, installOptions) => executeDashboardAction(
          operation,
          resource,
          { ...options, userTarget: os.homedir() },
          catalogRoot,
          { resources, sourceResources, allResources, warnings: catalogWarnings },
          installOptions,
        ),
      });
      return unavailable.length || result.errors.length || !completed ? 1 : 0;
    } else {
      console.log(renderInstalledResources(rows, process.stdout, result.errors));
    }
    return unavailable.length || result.errors.length ? 1 : 0;
  }

  let selected;
  let sourceToUpdate = [];
  if (options.command === "update") {
    if (!fs.existsSync(options.target) || !fs.statSync(options.target).isDirectory()) {
      throw new CatalogError(`Target must be an existing directory: ${options.target}`);
    }
    const state = readInstallState(fs.realpathSync(options.target));
    const installedSourceResources = [
      ...readInstalledSourceSkills(options.target, sourceResources, { catalog: options.catalog }),
      ...readInstalledSourceResources(options.target, sourceResources, { catalog: options.catalog }),
    ];
    const managedKeys = [...Object.keys(state.resources),
      ...Object.keys(state.bundles || {}).map((id) => `bundle:${id}`),
      ...Object.keys(state.mcps || {}).map((id) => `mcp:${id}`)];
    let keys = options.id
      ? managedKeys.filter((key) => {
        const [kind, id] = key.split(":");
        return id === options.id && (!options.kind || kind === options.kind);
      })
      : managedKeys;
    if (options.scope === "user") keys = keys.filter((key) => key.startsWith("bundle:")
      ? state.bundles[key.slice(7)].scope === "user"
      : key.startsWith("mcp:") ? isUserMcp(state.mcps[key.slice(4)]) : isUserResource(key, state.resources[key]));
    if (options.catalog) keys = [];
    sourceToUpdate = options.id
      ? installedSourceResources.filter(({ resource }) =>
        resource.id === options.id && (!options.kind || options.kind === resource.kind))
      : installedSourceResources;
    if (options.id && keys.length && sourceToUpdate.length) {
      throw new CatalogError(
        `Resource ID '${options.id}' is installed from multiple catalogs; specify --catalog.`,
      );
    }
    if (options.id && sourceToUpdate.length > 1) {
      throw new CatalogError(`Resource ID '${options.id}' is installed from multiple source catalogs; specify --catalog.`);
    }
    if (!keys.length && !sourceToUpdate.length) {
      throw new CatalogError(options.id
        ? `No tracked installation for ${options.kind ? `${options.kind}:` : ""}${options.id}`
        : "No tracked resources to update. Reinstall legacy resources after reviewing them.", "RESOURCE_NOT_FOUND");
    }
    if (options.id && keys.length > 1) {
      const tracked = resources.filter((resource) =>
        keys.includes(`${resource.kind}:${resource.id}`),
      ).map((resource) => ({
        ...resource,
        catalog: "internal",
      }));
      const selectedResource = await resolve(
        tracked, options.id, options.kind,
      );
      if (!selectedResource) {
        return 0;
      }
      keys = [`${selectedResource.kind}:${selectedResource.id}`];
    }
    selected = keys.map((key) => {
      if (!state.resources[key] && !(key.startsWith("bundle:") && state.bundles[key.slice(7)]) &&
          !(key.startsWith("mcp:") && state.mcps[key.slice(4)])) {
        throw new CatalogError(`No tracked installation for ${key}`);
      }
      const resource = resources.find((item) => `${item.kind}:${item.id}` === key);
      if (!resource) {
        throw new CatalogError(`${key} was removed from the catalog. Use uninstall to remove it explicitly.`);
      }
      return resource;
    });
  }
  if (options.command === "show" || options.command === "preview" ||
      (options.command === "install" && !selected)) {
    const resource = await resolve(
      allResources, options.id, options.kind,
    );
    if (!resource) {
      return 0;
    }
    if (options.command === "show") {
      if (resource.source_repository) {
        console.log(formatSourceResource(resource));
      } else {
        console.log(formatResource(resource));
      }
      return 0;
    }
    if (options.command === "preview") {
      if (["bundle", "mcp"].includes(resource.kind)) {
        if (options.file) throw new CatalogError("--file is not supported for bundle/MCP recipes", "INVALID_ARGUMENT");
        output.log(formatResource(resource));
        return 0;
      }
      if (resource.source_repository) {
        if (options.file) {
          throw new CatalogError("--file is only available for locally packaged resources");
        }
        return runSourceCommand(
          { ...options, action: "preview", id: resource.id, resource },
          catalogRoot,
        );
      }
      if (!options.nonInteractive && !options.file && process.stdin.isTTY && process.stdout.isTTY) {
        await browseResourceFiles(resource, catalogRoot);
      } else {
        console.log(previewResource(resource, catalogRoot, options.file));
      }
      return 0;
    }
    if (options.scope === "user" && !USER_INSTALLABLE_KINDS.has(resource.kind)) {
      throw new CatalogError("--scope user only supports skills, agents, MCPs and bundles without instructions", "INVALID_ARGUMENT");
    }
    if (!["bundle", "mcp"].includes(resource.kind) && (options.inputs || options.yes)) {
      throw new CatalogError("--input and --yes require an MCP/bundle installation/update", "INVALID_ARGUMENT");
    }
    if (resource.source_repository) {
      return runSourceCommand({
        ...options,
        action: "install",
        id: resource.id,
        resource,
        target: options.target,
        tool: options.tool,
        dryRun: options.dryRun,
        force: options.force,
      }, catalogRoot);
    }
    selected = [resource];
  }
  for (const entry of selected || []) {
    validateResource(entry, catalogRoot);
    options.onResource?.({ catalog: "internal", kind: entry.kind, id: entry.id, status: "planned" });
    if (entry.status === "deprecated") {
      output.error(`Warning: ${entry.kind}:${entry.id} is deprecated: ${entry.deprecation_reason}`);
    }
    const compatibility: Record<string, { status?: string }> = entry.compatibility || {};
    for (const [runtime, declaration] of Object.entries(compatibility)) {
      if (declaration.status === "unverified" && (!options.tool || options.tool === "both" || options.tool === runtime)) {
        output.error(`Warning: ${entry.kind}:${entry.id} is not declared compatible with ${runtime}. See its catalog entry.`);
      }
    }
  }
  if (!selected?.some((entry) => ["bundle", "mcp"].includes(entry.kind)) && (options.inputs || options.yes)) {
    throw new CatalogError("--input and --yes require an MCP/bundle installation/update", "INVALID_ARGUMENT");
  }
  validateSourceUpdates(sourceToUpdate, options);
  if (options.offline && sourceToUpdate.length && !options.dryRun) {
    throw new CatalogError("Updating source resources requires network access. Use --dry-run while offline.", "INVALID_ARGUMENT");
  }
  if (selected?.length) {
    const buildInfo = readBuildInfo(catalogRoot);
    if (buildInfo.dirty) {
      output.error("Warning: catalog source has uncommitted changes; the commit alone does not identify this content.");
    }
    const configured = selected.filter((entry) => ["bundle", "mcp"].includes(entry.kind));
    const configuredResult = configured.length ? await installConfiguredResources(
      configured, resources, fs.realpathSync(options.target), catalogRoot, buildInfo,
      { ...options, extraResources: selected.filter((entry) => !["bundle", "mcp"].includes(entry.kind)) },
    ) : null;
    const messages = configuredResult ? configuredResult.messages : installResources(
      selected,
      catalogRoot,
      options.target,
      options.tool,
      buildInfo,
      options,
    );
    for (const message of messages) {
      output.log(message);
    }
    if (configuredResult?.cancelled) return 0;
  }
  if (options.command === "update" && sourceToUpdate.length) {
    for (const { resource } of sourceToUpdate) {
      options.onResource?.({ catalog: resource.catalog, kind: resource.kind, id: resource.id, status: "planned", source: true });
    }
    const messages = updateSourceResources(
      sourceToUpdate,
      options.target,
      options,
    );
    for (const message of messages) {
      output.log(message);
    }
  }
  return 0;
}

module.exports = {
  ...api, parseArguments, printHelp, catalogEntries, listCatalogResources,
  executeDashboardAction, executeCommand,
};
