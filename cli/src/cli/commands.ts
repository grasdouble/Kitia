"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
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
const { userCatalogDirectory } = require("../catalog/sources/config.js");
const {
  manageCatalogCommand, addCatalog, updateCatalog, refreshCatalogs, checkCatalogFreshness, removeCatalog,
  exportCatalogConfigurationData, importCatalogConfigurationText,
} = require("../catalog/sources/manage.js");
const { loadUserSourceConfiguration } = require("../catalog/sources/config.js");
const { collectionData, importCollectionText, signCollectionManifest } = require("../catalog/collections.js");
const {
  MAX_BUNDLE_BYTES, bundleData, signResourceBundle, importResourceBundleText,
  readCachedResourceFiles,
} = require("../catalog/bundles.js");
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


function copyTextToClipboard(text) {
  if (process.platform === "darwin") {
    execFileSync("pbcopy", [], { input: text });
    return;
  }
  if (process.platform === "win32") {
    execFileSync("clip", [], { input: text });
    return;
  }
  for (const [program, args] of [
    ["wl-copy", []],
    ["xclip", ["-selection", "clipboard"]],
  ]) {
    try {
      execFileSync(program, args, { input: text });
      return;
    } catch {}
  }
  throw new Error("Clipboard access requires wl-copy or xclip on Linux.");
}

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


function shouldShowOnboarding() {
  return process.stdin.isTTY && process.stdout.isTTY &&
    !fs.existsSync(require("node:path").join(userCatalogDirectory(), "onboarding-complete"));
}

function markOnboardingComplete() {
  const directory = userCatalogDirectory();
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(require("node:path").join(directory, "onboarding-complete"), "1\n");
}


async function executeCommand(options, report) {
  const output = options.output || console;
  if (options.command === "onboarding") {
    options.command = "dashboard";
    options.showOnboarding = true;
  } else if (options.command === "dashboard") {
    options.showOnboarding = shouldShowOnboarding();
  }
  if (options.showOnboarding && process.stdin.isTTY && process.stdout.isTTY &&
      typeof process.stdin.setRawMode === "function") markOnboardingComplete();
  if (options.scope === "user") output.log(`User scope: ${options.target}`);
  if (options.command === "help") {
    printHelp();
    return 0;
  }
  if (options.command === "bundle") {
    if (options.action === "export") {
      const privateKey = fs.readFileSync(path.resolve(options.signingKey));
      const { sourceResources } = loadCommandCatalogs({ command: "list" });
      const bundle = bundleData(
        sourceResources,
        loadUserSourceConfiguration(),
        options.resourceSelectors,
        sourceSkillsApi.readPinnedSourceFiles,
      );
      const signed = signResourceBundle(bundle, privateKey);
      fs.writeFileSync(path.resolve(options.file), `${JSON.stringify(signed, null, 2)}\n`, { flag: "w" });
      output.log(`Exported signed resource bundle to ${options.file}.`);
      output.log(`Signature key fingerprint: ${signed.signature.key_id}`);
      return 0;
    }
    const bundlePath = path.resolve(options.file);
    const bundleStat = fs.lstatSync(bundlePath);
    if (!bundleStat.isFile() || bundleStat.isSymbolicLink() || bundleStat.size > MAX_BUNDLE_BYTES) {
      throw new CatalogError(`Resource bundle must be a regular JSON file no larger than ${MAX_BUNDLE_BYTES} bytes`);
    }
    const contents = fs.readFileSync(bundlePath, "utf8");
    const trustedKey = fs.readFileSync(path.resolve(options.trustedKey));
    const result = importResourceBundleText(contents, undefined, {
      trustedKey, replace: Boolean(options.replace),
    });
    output.log(`Imported signed resource bundle ${result.bundle_id}: ${result.catalogs.length} catalog${result.catalogs.length === 1 ? "" : "s"} cached locally.`);
    for (const name of result.added) output.log(`Added pinned offline catalog: ${name}`);
    for (const name of result.replaced) output.log(`Replaced pinned offline catalog: ${name}`);
    return 0;
  }
  if (options.command === "collection") {
    if (options.action === "export") {
      const { sourceResources } = loadCommandCatalogs({ command: "list" });
      let manifest = collectionData(sourceResources, loadUserSourceConfiguration(), options.resourceSelectors);
      if (options.signingKey) {
        const privateKey = fs.readFileSync(path.resolve(options.signingKey));
        manifest = signCollectionManifest(manifest, privateKey);
      }
      fs.writeFileSync(path.resolve(options.file), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "w" });
      output.log(`Exported resource collection to ${options.file}.`);
      if (manifest.signature) output.log(`Signature key fingerprint: ${manifest.signature.key_id}`);
      return 0;
    }
    const contents = fs.readFileSync(path.resolve(options.file), "utf8");
    const trustedKey = options.trustedKey ? fs.readFileSync(path.resolve(options.trustedKey)) : undefined;
    const names = importCollectionText(contents, undefined, { trustedKey });
    output.log(`Imported resource collection: ${names.length} catalog${names.length === 1 ? "" : "s"} registered.`);
    for (const name of names) output.log(`Added pinned catalog: ${name}`);
    output.log("Resource contents are not included; installation requires retrieving the pinned upstream commit.");
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
        showOnboarding: options.showOnboarding,
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
        checkCatalogFreshness: (names) => checkCatalogFreshness(undefined, names),
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
        transferCatalogs: async (action, content) => {
          const importSummary = action === "export"
            ? undefined
            : importCatalogConfigurationText(content);
          if (action === "export") {
            const configuration = JSON.stringify(exportCatalogConfigurationData(), null, 2);
            copyTextToClipboard(configuration);
          }
          const catalogs = userCatalogState();
          const refreshed = loadCommandCatalogs({ command: "list" }, () => {});
          return { catalogs, resources: catalogEntries(refreshed.sourceResources), importSummary };
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
    validateSourceUpdates(sourceToUpdate, { ...options, target });
    if (options.offline && !options.dryRun) {
      const stale = sourceToUpdate.filter(({ resource, installations }) => installations.some((installation) =>
        installation.missing || installation.modified ||
        installation.ref?.toLowerCase() !== String(resource.source_ref || "").toLowerCase()));
      const uncached = stale.filter(({ resource }) => !resource.bundle_id);
      if (uncached.length) {
        throw new CatalogError("Offline updates require an imported signed bundle for each stale source resource.", "INVALID_ARGUMENT");
      }
      for (const { resource } of stale) readCachedResourceFiles(resource);
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
  executeCommand,
  copyTextToClipboard,
};