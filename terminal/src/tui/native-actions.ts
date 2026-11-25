import fs from 'node:fs';
import os from 'node:os';

import { formatAuditLines } from '../cli/inspection-format.js';
import { formatSourceResource } from '../cli/resource-format.js';
import { loadCatalogs, type CatalogLoadWarning } from '../core/catalogs/indexes.js';
import type { AuditResult } from '../core/inspection/audit.js';
import { localPreviewFiles } from '../core/inspection/local-preview.js';
import type { ResourceInspection } from '../core/inspection/model.js';
import {
  executeInstallationOperation,
  type InstallationMessage,
  type InstallationRequest,
} from '../core/installations/lifecycle.js';
import { acquireOperationLock } from '../core/installations/lock.js';
import { removeUnmanagedResource } from '../core/installations/unmanaged.js';
import { collectInstalledScopes } from '../core/inventory/checks.js';
import { readInstallState } from '../core/inventory/inventory.js';
import { CatalogError, type CatalogResource } from '../core/resources/model.js';
import { catalogEntries, enrichInstalledResources } from '../core/resources/queries.js';
import type { DashboardActionResult } from './action-result.js';

// Native dashboard adapter: translate structured domain facts into the dashboard refresh envelope.
export interface NativeDashboardOptions {
  target: string;
  userTarget?: string;
}

export interface NativeDashboardCatalogs {
  sourceResources: CatalogResource[];
  warnings?: CatalogLoadWarning[];
}

export type NativeDashboardAction = InstallationRequest['operation'] | 'remove-unmanaged';
export type NativeInstallOptions = Pick<
  InstallationRequest,
  'scope' | 'destinations' | 'force' | 'ref' | 'ghForce' | 'ghForceAgent'
>;

function createDashboardActionHandler(onProgress: (message: string) => void = () => {}) {
  return async function executeDashboardAction(
    action: NativeDashboardAction,
    resource: CatalogResource,
    dashboardOptions: NativeDashboardOptions,
    catalogs: NativeDashboardCatalogs,
    installOptions: NativeInstallOptions = {},
  ): Promise<DashboardActionResult> {
    // Installed rows receive their scope from the native project/user inventory scan.
    const scope =
      action === 'install' ? installOptions.scope || 'project' : (resource.scope as NativeInstallOptions['scope']);
    const target = scope === 'user' ? dashboardOptions.userTarget || os.homedir() : dashboardOptions.target;
    const messages: string[] = [];
    let auditLines: string[] | undefined;
    let previewFiles: DashboardActionResult['previewFiles'];
    let previewTree: string[] | undefined;
    let previewAuditLines: string[] | undefined;
    let release: (() => void) | undefined;
    let code = 0;
    let failure: DashboardActionResult['failure'];
    try {
      if (action !== 'preview') release = acquireOperationLock(target);
      const targetRoot = fs.realpathSync(target);
      const state = readInstallState(targetRoot);
      if (action === 'remove-unmanaged') {
        if (resource.managed !== false) {
          throw new Error('Only unmanaged dashboard artifacts can be removed this way.');
        }
        messages.push(...removeUnmanagedResource(targetRoot, state, resource));
      } else if (action === 'preview' && resource.scope) {
        const local: ResourceInspection = localPreviewFiles(targetRoot, state, resource);
        previewFiles = local.files;
        previewTree = [
          'local installations/',
          ...local.treeEntries.map(
            (entry, index) => `${index === local.treeEntries.length - 1 ? '└──' : '├──'} ${entry.path}`,
          ),
        ];
        previewAuditLines = formatAuditLines(local.audit);
      } else {
        const result = await executeInstallationOperation(
          {
            operation: action,
            resource,
            id: resource.id,
            kind: resource.kind,
            catalog: resource.catalog,
            target,
            scope,
            destinations: installOptions.destinations,
            ref: installOptions.ref,
            force: installOptions.force,
            ghForce: installOptions.ghForce,
            ghForceAgent: installOptions.ghForceAgent,
            audit: action === 'install' || action === 'preview',
            nonInteractive: true,
            captureOutput: action === 'preview',
            projectTarget: dashboardOptions.target,
            userTarget: dashboardOptions.userTarget || os.homedir(),
            onProgress,
            onMessage: ({ text }: InstallationMessage) => messages.push(text),
            onAudit: (audit: AuditResult) => {
              auditLines = formatAuditLines(audit);
              messages.push(...auditLines);
            },
          },
          catalogs.sourceResources,
        );
        code = result.status;
        if (result.preview !== undefined)
          messages.push(`${formatSourceResource(result.resource!)}\n\n${result.preview}`);
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
        ...(error.code === 'AUDIT_BLOCKED' && auditLines ? { auditLines } : {}),
      };
    } finally {
      release?.();
    }
    const currentCatalogs = loadCatalogs({ allowUnavailable: true });
    const result = collectInstalledScopes(
      { project: dashboardOptions.target, user: dashboardOptions.userTarget || os.homedir() },
      currentCatalogs.sourceResources,
    );
    result.errors.push(...(catalogs.warnings || []).map((warning) => ({ ...warning, scope: 'catalog' })));
    return {
      code,
      messages,
      ...(failure ? { failure } : {}),
      ...(previewFiles ? { previewFiles, previewTree, previewAuditLines } : {}),
      resources: enrichInstalledResources(result.resources, catalogEntries(currentCatalogs.sourceResources)),
      errors: result.errors,
    };
  };
}

export { createDashboardActionHandler };
