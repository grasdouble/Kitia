import fs from 'node:fs';

import type { AuditResult } from '../core/inspection/audit.js';
import { localPreviewFiles } from '../core/inspection/local-preview.js';
import type { PreviewFile, PreviewTreeEntry } from '../core/inspection/model.js';
import { decodeSourcePreview } from '../core/inspection/source-preview.js';
import { executeInstallationOperation, type InstallationRequest } from '../core/installations/lifecycle.js';
import { acquireOperationLock } from '../core/installations/lock.js';
import { removeUnmanagedResource } from '../core/installations/unmanaged.js';
import { readInstallState } from '../core/inventory/inventory.js';
import { CatalogError, type CatalogResource } from '../core/resources/model.js';
import { readCatalogSnapshot, readInventory, type InstallationTargets, type InventorySnapshot } from './snapshot.js';

export type ResourceAction = InstallationRequest['operation'] | 'remove-unmanaged';
export type ResourceActionOptions = Pick<
  InstallationRequest,
  'scope' | 'destinations' | 'force' | 'ref' | 'ghForce' | 'ghForceAgent'
>;

type ActionFailure = {
  code: string;
  category?: string;
  paths?: string[];
  recoverable?: boolean;
  userMessage: string;
  agent?: string;
  audit?: AuditResult;
};

export type ResourceActionResult = InventorySnapshot & {
  code: number;
  messages: Array<string | AuditResult>;
  failure?: ActionFailure;
  inspection?: {
    origin: 'local' | 'source';
    root: string;
    files: PreviewFile[];
    treeEntries: PreviewTreeEntry[];
    audit?: AuditResult;
  };
};

export async function runResourceAction(
  action: ResourceAction,
  resource: CatalogResource,
  targets: InstallationTargets,
  options: ResourceActionOptions = {},
  onProgress?: (message: string) => void,
): Promise<ResourceActionResult> {
  const scope = action === 'install' ? options.scope || 'project' : (resource.scope as ResourceActionOptions['scope']);
  const target = scope === 'user' ? targets.user : targets.project;
  const messages: ResourceActionResult['messages'] = [];
  let audit: AuditResult | undefined;
  let inspection: ResourceActionResult['inspection'];
  let release: (() => void) | undefined;
  let code = 0;
  let failure: ActionFailure | undefined;
  const catalog = readCatalogSnapshot();
  try {
    if (action !== 'preview') release = acquireOperationLock(target);
    const targetRoot = fs.realpathSync(target);
    if (action === 'remove-unmanaged') {
      const state = readInstallState(targetRoot);
      if (resource.managed !== false) throw new Error('Only unmanaged dashboard artifacts can be removed this way.');
      messages.push(...removeUnmanagedResource(targetRoot, state, resource));
    } else if (action === 'preview' && resource.scope) {
      const local = localPreviewFiles(targetRoot, readInstallState(targetRoot), resource);
      inspection = { ...local, origin: 'local', root: 'local installations' };
    } else {
      // Keep the inventory format check before invoking any lifecycle operation.
      readInstallState(targetRoot);
      const result = await executeInstallationOperation(
        {
          ...options,
          operation: action,
          resource,
          id: resource.id,
          kind: resource.kind,
          catalog: resource.catalog,
          target,
          scope,
          audit: action === 'install' || action === 'preview',
          nonInteractive: true,
          captureOutput: action === 'preview',
          projectTarget: targets.project,
          userTarget: targets.user,
          onProgress,
          onMessage: ({ text }) => messages.push(text),
          onAudit: (report) => {
            audit = report;
            if (action !== 'preview') messages.push(report);
          },
        },
        catalog.resources,
      );
      code = result.status;
      if (action === 'preview' && code === 0) {
        const content = result.preview ?? result.messages.find(({ level }) => level === 'log')?.text ?? '';
        messages.length = 0;
        inspection = { ...decodeSourcePreview(resource, content), origin: 'source', audit };
      }
    }
  } catch (error) {
    if (!(error instanceof CatalogError)) throw error;
    code = 1;
    failure = {
      code: error.code,
      category: error.category,
      paths: error.paths,
      recoverable: error.recoverable,
      userMessage: error.userMessage || error.message,
      agent: error.agent,
      ...(error.code === 'AUDIT_BLOCKED' && audit ? { audit } : {}),
    };
  } finally {
    release?.();
  }
  return { code, messages, failure, inspection, ...readInventory(targets, catalog) };
}
