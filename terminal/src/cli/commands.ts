"use strict";

const { resolveCatalogResource } = require("../core/resources/selection.js");
const { CatalogError } = require("../core/resources/model.js");
const { selectCatalogResource, formatCatalogTable, browseInstalledResources, renderInstalledResources } = require("../tui/terminal.js");
const { userCatalogDirectory, loadUserSourceConfiguration } = require("../core/catalogs/config.js");
const { printHelp, parseArguments } = require("./arguments.js");
const { loadCommandCatalogs } = require("./loading.js");
const { collectionData } = require("../core/collections/manifest.js");
const { signCollectionManifest } = require("../core/collections/signatures.js");
const { importCollectionText } = require("../core/collections/import.js");
const { manageCatalogCommand } = require("./catalog-command.js");
const { formatSourceVersionTable } = require("./history.js");
const { diagnose } = require("../core/diagnostics/doctor.js");
const { catalogEntries, listCatalogResources, enrichInstalledResources } = require("../core/resources/queries.js");
const { checkInstalledResources, collectInstalledScopes } = require("../core/inventory/checks.js");
const { checkCatalogFreshness } = require("../core/catalogs/manage.js");
const { formatSourceResource } = require("./resource-format.js");
const { executeInstallationOperation } = require("../core/installations/lifecycle.js");
const { formatAuditLines } = require("./inspection-format.js");

const fs = require("node:fs");
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { execFileSync } = require("node:child_process");
const os = require("node:os");
const sourceHistoryApi = require("../core/resources/history.js");





function runDashboardWorker(
  data,
  onProgress: (message: string) => void = () => {},
  { execArgv }: { execArgv?: string[] } = {},
) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "dashboard-worker.js"), { workerData: data, execArgv });
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
    for (const row of formatSourceVersionTable(
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
    const rows = enrichInstalledResources(result.resources, allResources);
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
  if (options.command === "show") {
    const resource = await selectedSourceResource(allResources, options);
    if (resource) output.log(formatSourceResource(resource));
    return 0;
  }
  if (["install", "preview", "update", "uninstall"].includes(options.command)) {
    const result = await executeInstallationOperation({
      ...options,
      planOnly: options.json,
      operation: options.command,
      onMessage: ({ level, text }) => output[level](text),
      onAudit: (audit) => {
        for (const line of formatAuditLines(audit)) output.log(line);
      },
    }, sourceResources, selectedSourceResource);
    if (result.preview !== undefined) output.log(`${formatSourceResource(result.resource)}\n\n${result.preview}`);
    return result.status;
  }
  throw new CatalogError(`Unsupported command: ${options.command || "unknown"}`);
}

module.exports = {
  parseArguments,
  printHelp,
  catalogEntries,
  listCatalogResources,
  executeCommand,
  runDashboardWorker,
  copyTextToClipboard,
};