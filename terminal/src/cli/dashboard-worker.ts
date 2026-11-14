import { parentPort, workerData } from "node:worker_threads";

const {
  executeCommand,
  copyTextToClipboard,
} = require("./commands.js");
const {
  addCatalog,
  updateCatalog,
  removeCatalog,
  refreshCatalogs,
  exportCatalogConfigurationData,
  importCatalogConfigurationText,
} = require("../catalog/sources/manage.js");
const { loadUserSourceConfiguration } = require("../catalog/sources/config.js");
const { loadCommandCatalogs } = require("../catalog/loading.js");
const { catalogEntries } = require("./catalog.js");
const { createDashboardActionHandler } = require("./dashboard.js");

function catalogState() {
  return loadUserSourceConfiguration().map(({ name, repository, mode, entries }) => ({
    name, repository, mode, entries,
  }));
}

function refreshDashboardCatalogs() {
  const refreshed = loadCommandCatalogs({ command: "list" }, () => {});
  return { catalogs: catalogState(), resources: catalogEntries(refreshed.sourceResources) };
}

async function execute(data) {
  if (data.task === "resource-action") {
    const handler = createDashboardActionHandler(
      (options, report) => executeCommand(options, report),
      (message) => parentPort?.postMessage({ progress: message }),
    );
    return handler(
      data.action,
      data.resource,
      data.dashboardOptions,
      data.catalogs,
      data.installOptions,
    );
  }
  if (data.task === "catalog-add") {
    const index = addCatalog(data.request.name, data.request.repository, {
      mode: data.request.mode,
      entries: data.request.entries,
    });
    return {
      catalog: data.request.name,
      count: index.resources.length,
      ...refreshDashboardCatalogs(),
    };
  }
  if (data.task === "catalog-update") {
    const index = updateCatalog(data.originalName, data.request.name, data.request.repository, {
      mode: data.request.mode,
      entries: data.request.entries,
    });
    return {
      catalog: data.request.name,
      count: index.resources.length,
      ...refreshDashboardCatalogs(),
    };
  }
  if (data.task === "catalog-remove") {
    removeCatalog(data.name);
    return refreshDashboardCatalogs();
  }
  if (data.task === "catalog-refresh") {
    return { ...refreshCatalogs(data.name ? [data.name] : undefined), ...refreshDashboardCatalogs() };
  }
  if (data.task === "catalog-transfer") {
    const importSummary = data.action === "export"
      ? undefined
      : importCatalogConfigurationText(data.content);
    if (data.action === "export") {
      copyTextToClipboard(JSON.stringify(exportCatalogConfigurationData(), null, 2));
    }
    return { ...refreshDashboardCatalogs(), importSummary };
  }
  throw new Error(`Unsupported dashboard worker task: ${data.task}`);
}

execute(workerData).then(
  (result) => parentPort?.postMessage({ ok: true, result }),
  (error) => parentPort?.postMessage({
    ok: false,
    error: {
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
      ...(error && typeof error === "object" ? {
        code: error.code,
        category: error.category,
        paths: error.paths,
        recoverable: error.recoverable,
        userMessage: error.userMessage,
        agent: error.agent,
      } : {}),
    },
  }),
);
