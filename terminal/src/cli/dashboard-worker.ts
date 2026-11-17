'use strict';

const { loadUserSourceConfiguration } = require('../core/catalogs/config.js');
const { loadCommandCatalogs } = require('./loading.js');
const { catalogEntries } = require('../core/resources/queries.js');
const { createDashboardActionHandler } = require('../tui/native-actions.js');
const {
  addCatalog,
  updateCatalog,
  removeCatalog,
  refreshCatalogs,
  importCatalogConfigurationText,
  exportCatalogConfigurationData,
} = require('../core/catalogs/manage.js');
const { copyTextToClipboard } = require('./commands.js');
import { parentPort, workerData } from 'node:worker_threads';

function catalogState() {
  return loadUserSourceConfiguration().map(({ name, repository, mode, entries }) => ({
    name,
    repository,
    mode,
    entries,
  }));
}

function refreshDashboardCatalogs() {
  const refreshed = loadCommandCatalogs({ command: 'list' }, () => {});
  return { catalogs: catalogState(), resources: catalogEntries(refreshed.sourceResources) };
}

async function execute(data) {
  if (data.task === 'resource-action') {
    const handler = createDashboardActionHandler((message) => parentPort?.postMessage({ progress: message }));
    return handler(data.action, data.resource, data.dashboardOptions, data.catalogs, data.installOptions);
  }
  if (data.task === 'catalog-add') {
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
  if (data.task === 'catalog-update') {
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
  if (data.task === 'catalog-remove') {
    removeCatalog(data.name);
    return refreshDashboardCatalogs();
  }
  if (data.task === 'catalog-refresh') {
    return {
      ...refreshCatalogs(data.name ? [data.name] : undefined),
      ...refreshDashboardCatalogs(),
    };
  }
  if (data.task === 'catalog-transfer') {
    const importSummary = data.action === 'export' ? undefined : importCatalogConfigurationText(data.content);
    if (data.action === 'export') {
      copyTextToClipboard(JSON.stringify(exportCatalogConfigurationData(), null, 2));
    }
    return { ...refreshDashboardCatalogs(), importSummary };
  }
  throw new Error(`Unsupported dashboard worker task: ${data.task}`);
}

execute(workerData).then(
  (result) => parentPort?.postMessage({ ok: true, result }),
  (error) =>
    parentPort?.postMessage({
      ok: false,
      error: {
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
        ...(error && typeof error === 'object'
          ? {
              code: error.code,
              category: error.category,
              paths: error.paths,
              recoverable: error.recoverable,
              userMessage: error.userMessage,
              agent: error.agent,
            }
          : {}),
      },
    }),
);
