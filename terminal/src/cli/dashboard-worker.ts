import { parentPort, workerData } from 'node:worker_threads';

import { loadUserSourceConfiguration } from '../core/catalogs/config.js';
import {
  addCatalog,
  updateCatalog,
  removeCatalog,
  refreshCatalogs,
  importCatalogConfigurationText,
  exportCatalogConfigurationData,
} from '../core/catalogs/manage.js';
import type { AddCatalogRequest, SourceConfiguration, UserCatalog } from '../core/catalogs/model.js';
import type { CatalogResource } from '../core/resources/model.js';
import { catalogEntries } from '../core/resources/queries.js';
import {
  createDashboardActionHandler,
  type NativeDashboardAction,
  type NativeDashboardCatalogs,
  type NativeDashboardOptions,
  type NativeInstallOptions,
} from '../tui/native-actions.js';
import { copyTextToClipboard } from './commands.js';
import { loadCommandCatalogs } from './loading.js';

type DashboardWorkerTask =
  | {
      task: 'resource-action';
      action: NativeDashboardAction;
      resource: CatalogResource;
      dashboardOptions: NativeDashboardOptions;
      catalogs: NativeDashboardCatalogs;
      installOptions: NativeInstallOptions;
    }
  | { task: 'catalog-add'; request: AddCatalogRequest }
  | { task: 'catalog-update'; originalName: string; request: AddCatalogRequest }
  | { task: 'catalog-remove'; name: string }
  | { task: 'catalog-refresh'; name?: string }
  | { task: 'catalog-transfer'; action: 'import' | 'export'; content: string };

function catalogState(): UserCatalog[] {
  const catalogs: SourceConfiguration[] = loadUserSourceConfiguration();
  return catalogs.map(({ name, repository, mode, entries }) => ({
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

async function execute(data: DashboardWorkerTask) {
  const taskName = data.task;
  if (data.task === 'resource-action') {
    const handler = createDashboardActionHandler((message: string) => parentPort?.postMessage({ progress: message }));
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
  throw new Error(`Unsupported dashboard worker task: ${taskName}`);
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
