import { parentPort, workerData } from 'node:worker_threads';

import {
  addCatalog,
  checkCatalogFreshness,
  exportCatalogConfigurationData,
  importCatalogConfigurationText,
  refreshCatalogs,
  removeCatalog,
  updateCatalog,
} from '../core/catalogs/manage.js';
import type { AddCatalogRequest } from '../core/catalogs/model.js';
import { CatalogError, type CatalogResource } from '../core/resources/model.js';
import { inspectPinnedSource, resolvePinnedCatalogResource, type CatalogResourceSelector } from './catalog-preview.js';
import {
  reviewInventoryMutation,
  type InventoryMutation,
  type ConfirmedInventoryMutation,
} from './inventory-mutation.js';
import { readInstalledPreview, type InstalledResourceSelector } from './inventory-preview.js';
import { runResourceAction, type ResourceAction, type ResourceActionOptions } from './resource-actions.js';
import { listResourceRevisions, readCatalogSnapshot, readInventory, type InstallationTargets } from './snapshot.js';

export type OperationTask =
  | {
      task: 'resource-action';
      action: ResourceAction;
      resource: CatalogResource;
      targets: InstallationTargets;
      options?: ResourceActionOptions;
    }
  | { task: 'inventory-read'; targets: InstallationTargets }
  | { task: 'inventory-preview'; targets: InstallationTargets; selector: InstalledResourceSelector }
  | {
      task: 'inventory-review';
      targets: InstallationTargets;
      action: InventoryMutation;
      selector: InstalledResourceSelector;
      revision?: string;
    }
  | {
      task: 'inventory-mutate';
      targets: InstallationTargets;
      action: InventoryMutation;
      selection: ConfirmedInventoryMutation;
      options?: ResourceActionOptions;
    }
  | { task: 'catalog-read' }
  | { task: 'catalog-freshness' }
  | { task: 'catalog-preview'; selector: CatalogResourceSelector; project: string }
  | { task: 'catalog-revisions'; selector: CatalogResourceSelector }
  | {
      task: 'catalog-install';
      selector: CatalogResourceSelector;
      revision?: string;
      targets: InstallationTargets;
      options: Pick<ResourceActionOptions, 'scope' | 'destinations'>;
    }
  | { task: 'catalog-add'; request: AddCatalogRequest }
  | { task: 'catalog-update'; originalName: string; request: AddCatalogRequest }
  | { task: 'catalog-remove'; name: string }
  | { task: 'catalog-refresh'; name?: string }
  | { task: 'catalog-import'; content: string }
  | { task: 'catalog-export' };

async function execute(data: OperationTask) {
  const onProgress = (progress: string) => parentPort?.postMessage({ progress });
  switch (data.task) {
    case 'inventory-read': {
      const catalog = readCatalogSnapshot();
      return { inventory: readInventory(data.targets, catalog), catalogs: catalog.catalogs };
    }
    case 'inventory-preview':
      return readInstalledPreview(data.targets, data.selector);
    case 'inventory-review':
      return reviewInventoryMutation(
        data.action,
        data.selector,
        data.targets[data.selector.scope],
        readCatalogSnapshot().resources,
        data.revision,
      );
    case 'inventory-mutate':
      return runResourceAction(data.action, data.selection, data.targets, data.options, onProgress);
    case 'catalog-read':
      return readCatalogSnapshot();
    case 'catalog-freshness':
      return checkCatalogFreshness();
    case 'catalog-preview': {
      const resource = resolvePinnedCatalogResource(data.selector);
      const preview = await inspectPinnedSource(resource, data.project);
      if (!preview.inspection)
        throw new CatalogError(preview.messages.join('\n') || 'The source preview failed.', 'PREVIEW_FAILED');
      return preview.inspection;
    }
    case 'catalog-revisions':
      return listResourceRevisions(resolvePinnedCatalogResource(data.selector));
    case 'catalog-install':
      return runResourceAction(
        'install',
        { ...data.selector, revision: data.revision },
        data.targets,
        data.options,
        onProgress,
      );
    case 'resource-action':
      return runResourceAction(data.action, data.resource, data.targets, data.options, onProgress);
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
