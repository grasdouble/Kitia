import { parentPort, workerData } from 'node:worker_threads';

import {
  addCatalog,
  exportCatalogConfigurationData,
  importCatalogConfigurationText,
  refreshCatalogs,
  removeCatalog,
  updateCatalog,
} from '../core/catalogs/manage.js';
import type { AddCatalogRequest } from '../core/catalogs/model.js';
import type { CatalogResource } from '../core/resources/model.js';
import { runResourceAction, type ResourceAction, type ResourceActionOptions } from './resource-actions.js';
import { readCatalogSnapshot, type InstallationTargets } from './snapshot.js';

export type OperationTask =
  | {
      task: 'resource-action';
      action: ResourceAction;
      resource: CatalogResource;
      targets: InstallationTargets;
      options?: ResourceActionOptions;
    }
  | { task: 'catalog-add'; request: AddCatalogRequest }
  | { task: 'catalog-update'; originalName: string; request: AddCatalogRequest }
  | { task: 'catalog-remove'; name: string }
  | { task: 'catalog-refresh'; name?: string }
  | { task: 'catalog-import'; content: string }
  | { task: 'catalog-export' };

async function execute(data: OperationTask) {
  switch (data.task) {
    case 'resource-action':
      return runResourceAction(data.action, data.resource, data.targets, data.options, (progress) =>
        parentPort?.postMessage({ progress }),
      );
    case 'catalog-add':
    case 'catalog-update': {
      const { name, repository, mode, entries } = data.request;
      const index =
        data.task === 'catalog-add'
          ? addCatalog(name, repository, { mode, entries })
          : updateCatalog(data.originalName, name, repository, { mode, entries });
      return { catalog: name, count: index.resources.length, ...readCatalogSnapshot() };
    }
    case 'catalog-remove':
      removeCatalog(data.name);
      return readCatalogSnapshot();
    case 'catalog-refresh': {
      const result = refreshCatalogs(data.name ? [data.name] : undefined);
      return { ...result, ...readCatalogSnapshot() };
    }
    case 'catalog-import': {
      const importSummary = importCatalogConfigurationText(data.content);
      return { importSummary, ...readCatalogSnapshot() };
    }
    case 'catalog-export':
      return exportCatalogConfigurationData();
  }
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
