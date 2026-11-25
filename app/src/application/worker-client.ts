import path from 'node:path';
import { Worker } from 'node:worker_threads';

import type {
  CatalogConfigurationDocument,
  CatalogImportResult,
  CatalogRefreshResult,
} from '../core/catalogs/manage.js';
import type { ResourceInspection } from '../core/inspection/model.js';
import type { ResourceActionResult } from './resource-actions.js';
import type { CatalogSnapshot, InventoryWorkspace } from './snapshot.js';
import type { OperationTask } from './worker.js';

type CatalogMutation = CatalogSnapshot & { catalog: string; count: number };
type OperationResults = {
  'inventory-read': InventoryWorkspace;
  'inventory-preview': ResourceInspection | null;
  'resource-action': ResourceActionResult;
  'catalog-add': CatalogMutation;
  'catalog-update': CatalogMutation;
  'catalog-remove': CatalogSnapshot;
  'catalog-refresh': CatalogSnapshot & CatalogRefreshResult;
  'catalog-import': CatalogSnapshot & { importSummary: CatalogImportResult };
  'catalog-export': CatalogConfigurationDocument;
};

type WorkerMessage<Result> =
  | { progress: string; ok?: never }
  | { progress?: never; ok: true; result: Result }
  | {
      progress?: never;
      ok: false;
      error: {
        name: string;
        message: string;
        code?: string;
        category?: string;
        paths?: string[];
        recoverable?: boolean;
        userMessage?: string;
        agent?: string;
      };
    };

export function runOperation<T extends OperationTask>(
  data: T,
  onProgress?: (message: string) => void,
  { execArgv }: { execArgv?: string[] } = {},
): Promise<OperationResults[T['task']]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'worker.js'), { workerData: data, execArgv });
    let settled = false;
    worker.on('message', (message: WorkerMessage<OperationResults[T['task']]>) => {
      if (settled) return;
      if (typeof message.progress !== 'string') settled = true;
      if (typeof message.progress === 'string') onProgress?.(message.progress);
      else if (message.ok) resolve(message.result);
      else if ('error' in message) reject(Object.assign(new Error(message.error.message), message.error));
    });
    worker.once('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    worker.once('exit', (code) => {
      if (!settled) reject(new Error(`Operation worker exited before returning a result (exit ${code}).`));
    });
  });
}
