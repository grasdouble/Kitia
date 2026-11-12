"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { execFileSync } = require("node:child_process");
const os = require("node:os");
const { CatalogError, USER_INSTALLABLE_KINDS } = require("../catalog/resources/index.js");
const inventoryApi = require("../catalog/inventory/index.js");
const terminalApi = require("../dashboard/terminal.js");
const sourceResourcesApi = require("../catalog/sources/resources.js");
const sourceCommandApi = require("./source-command.js");
const sourceHistoryApi = require("../catalog/sources/history.js");
const sourceInventoryApi = require("../catalog/sources/installed.js");
const lifecycleApi = require("../catalog/lifecycle.js");
const { acquireOperationLock } = require("../catalog/operation.js");
const { loadCommandCatalogs } = require("../catalog/loading.js");
const { diagnose } = require("../catalog/doctor.js");
const { userCatalogDirectory } = require("../catalog/sources/config.js");
const {
  manageCatalogCommand, checkCatalogFreshness,
} = require("../catalog/sources/manage.js");
const { loadUserSourceConfiguration } = require("../catalog/sources/config.js");
const { collectionData, importCollectionText, signCollectionManifest } = require("../catalog/collections.js");
const { catalogEntries, listCatalogResources, formatDashboardRows } = require("./catalog.js");
const { parseArguments, printHelp } = require("./arguments.js");
const { readInstalledSourceSkills, readInstalledSourceResources } = sourceInventoryApi;
const { runSourceCommand, formatSourceResource } = sourceCommandApi;
const { validateSourceUpdates, updateSourceResources, updateSourceResourcesAsync, uninstallSourceResource } = sourceResourcesApi;
const { checkInstalledResources, collectInstalledScopes } = lifecycleApi;
const {
  formatCatalogTable, resolveCatalogResource, selectCatalogResource,
  renderInstalledResources, browseInstalledResources, colorize,
} = terminalApi;

function runDashboardWorker(data, onProgress: (message: string) => void = () => {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "dashboard-worker.js"), { workerData: data });
    let settled = false;
    worker.on("message", (message) => {
      if (typeof message?.progress === "string") {
        onProgress(message.progress);
        return;
      }
      if (settled) return;
      settled = true;
      if (message.ok) {
        resolve(message.result);
        return;
      }
      const error = Object.assign(new Error(message.error.message), message.error);
      error.name = message.error.name;
      reject(error);
    });
    worker.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    worker.once("exit", (code) => {
      if (settled) return;
      settled = true;
      reject(new Error(`Dashboard worker exited before returning a result (exit ${code}).`));
    });
  });
}


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

function resolveListedSourceRef(resource, ref) {
  if (!resource.source_repository || !resource.source_path) {
    throw new CatalogError("--ref supports only GitHub source resources.");
  }
  if (ref.length === 40) return ref;
  try {
    return sourceHistoryApi.resolveSourceVersionPrefix(
      sourceHistoryApi.listSourceVersions(resource),
      ref,
    );
  } catch (error) {
    if (error.code === "RESOURCE_NOT_FOUND" || error.code === "AMBIGUOUS_RESOURCE") {
      throw new CatalogError(
        `${error.message.replace(/ in source history\.$/, ` for ${resource.catalog}:${resource.kind}:${resource.id}.`)}`,
        error.code,
      );
    }
    throw error;
  }
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
  if (options.command === "versions") {
    const { sourceResources } = loadCommandCatalogs({ ...options, command: "list" });
    const candidates = sourceResources.filter((entry) =>
      entry.kind === options.kind && entry.id === options.id &&
      entry.source_repository && entry.source_path &&
      (!options.catalog || entry.catalog === options.catalog));
    if (!candidates.length) {
      throw new CatalogError(`GitHub source ${options.kind} not found: ${options.id}`, "RESOURCE_NOT_FOUND");
    }
    if (candidates.length > 1) {
      throw new CatalogError(
        `${options.kind} '${options.id}' is ambiguous: ${candidates.map((entry) => entry.catalog).join(", ")}. Specify --catalog.`,
        "AMBIGUOUS_RESOURCE",
      );
    }
    const [resource] = candidates;
    const versions = sourceHistoryApi.listSourceVersions(resource);
    output.log(`Commit history for ${resource.catalog}:${resource.kind}:${resource.id} (up to 500 newest commits; date is commit committer date):`);
    for (const row of sourceHistoryApi.formatSourceVersionTable(
      versions, process.stdout.isTTY ? process.stdout.columns : undefined,
    )) output.log(row);
    if (!versions.length) output.log("No commits found for this resource path.");
    return 0;
  }
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
      console.log(formatCatalogTable(matches, process.stdout));
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
        addCatalog: (request) => runDashboardWorker({ task: "catalog-add", request }),
        updateCatalog: (originalName, request) =>
          runDashboardWorker({ task: "catalog-update", originalName, request }),
        userCatalogs: userCatalogState(),
        checkCatalogFreshness: (names) => checkCatalogFreshness(undefined, names),
        removeCatalog: (name) => runDashboardWorker({ task: "catalog-remove", name }),
        refreshCatalog: (name) => runDashboardWorker({ task: "catalog-refresh", name }),
        transferCatalogs: (action, content) =>
          runDashboardWorker({ task: "catalog-transfer", action, content }),
        execute: (operation, resource, installOptions) => {
          const { onProgress, ...workerOptions } = installOptions;
          return runDashboardWorker({
            task: "resource-action",
            action: operation,
            resource,
            dashboardOptions: {
              target: options.target,
              userTarget: os.homedir(),
            },
            catalogs: { sourceResources, warnings: catalogWarnings },
            installOptions: workerOptions,
          }, onProgress);
        },
        listSourceVersions: async (resource) => {
          const versions = await sourceHistoryApi.listSourceVersionsAsync(resource);
          const prefixes = sourceHistoryApi.uniqueSourceVersionPrefixes(versions);
          return versions.map((version, index) => ({ ...version, prefix: prefixes[index] }));
        },
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
    if (options.ref) {
      if (sourceToUpdate.some(({ resource }) => !resource.source_repository || !resource.source_path)) {
        throw new CatalogError("--ref supports only GitHub source resources.");
      }
      sourceToUpdate = sourceToUpdate.map((entry) => ({
        ...entry,
        resource: {
          ...entry.resource,
          source_ref: resolveListedSourceRef(entry.resource, options.ref),
        },
      }));
    }
    const sourceToUpdateResources = sourceToUpdate.map(({ resource }) => resource);
    validateSourceUpdates(sourceToUpdate, { ...options, target });

    for (const resource of sourceToUpdateResources) {
      options.onResource?.({ catalog: resource.catalog || "source", kind: resource.kind, id: resource.id, status: "planned", source: true });
    }
    const messages = options.onProgress
      ? await updateSourceResourcesAsync(sourceToUpdate, target, options)
      : updateSourceResources(sourceToUpdate, target, options);
    for (const message of messages) output.log(message);
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
    if (options.ref) {
      const target = fs.realpathSync(options.target);
      if (!resource.source_repository || !resource.source_path) {
        throw new CatalogError("--ref supports only GitHub source resources.");
      }
      const selectedResource = {
        ...resource,
        source_ref: resolveListedSourceRef(resource, options.ref),
      };
      const projectTarget = options.scope === "user" ? fs.realpathSync(process.cwd()) : target;
      const userTarget = fs.realpathSync(os.homedir());
      const targetRootsOverlap = projectTarget === userTarget;
      const matchingInstalled = [
        ...readInstalledSourceSkills(target, sourceResources, { catalog: options.catalog }),
        ...readInstalledSourceResources(target, sourceResources, { catalog: options.catalog }),
      ].filter(({ resource: current }) =>
        current.catalog === resource.catalog && current.kind === resource.kind && current.id === resource.id &&
        current.source_repository === resource.source_repository && current.source_path === resource.source_path);
      if (targetRootsOverlap && matchingInstalled.length) {
        throw new CatalogError(
          `Cannot safely replace ${resource.catalog}:${resource.kind}:${resource.id}: project and user scopes resolve to the same target (${target}), and the install record does not distinguish them.`,
          "AMBIGUOUS_RESOURCE",
        );
      }
      if (matchingInstalled.length > 1) {
        throw new CatalogError(
          `Multiple tracked installations found for ${resource.catalog}:${resource.kind}:${resource.id} in ${options.scope || "project"} scope.`,
          "AMBIGUOUS_RESOURCE",
        );
      }
      if (matchingInstalled.length === 1) {
        const replacement = {
          ...matchingInstalled[0],
          resource: { ...matchingInstalled[0].resource, ...selectedResource },
        };
        validateSourceUpdates([replacement], { ...options, target });
        const messages = options.onProgress
          ? await updateSourceResourcesAsync([replacement], target, options)
          : updateSourceResources([replacement], target, options);
        for (const message of messages) output.log(message);
        return 0;
      }
      return runSourceCommand({
        ...options, action: "install", id: resource.id,
        resource: selectedResource,
      });
    }
    return runSourceCommand({ ...options, action: "install", id: resource.id, resource });
  }
  throw new CatalogError(`Unsupported command: ${options.command || "unknown"}`);
}

module.exports = {
  ...inventoryApi,
  ...terminalApi,
  ...lifecycleApi,
  parseArguments,
  printHelp,
  catalogEntries,
  listCatalogResources,
  executeCommand,
  runDashboardWorker,
  copyTextToClipboard,
};