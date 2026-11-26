import fs from 'node:fs';

import type { AuditResult } from '../core/inspection/audit.js';
import type { ResourceInspection } from '../core/inspection/model.js';
import { installationPath, resolveInstallationDestinations } from '../core/installations/destinations.js';
import { executeInstallationOperation, type InstallationRequest } from '../core/installations/lifecycle.js';
import { acquireOperationLock } from '../core/installations/lock.js';
import { ReviewedUpdateConflict } from '../core/installations/mutations.js';
import { removeUnmanagedResource } from '../core/installations/unmanaged.js';
import { readInstallState, sourceCatalogName } from '../core/inventory/inventory.js';
import type { FileFingerprint } from '../core/inventory/model.js';
import { listSourceVersionsAsync } from '../core/resources/history.js';
import { CatalogError, type CatalogResource } from '../core/resources/model.js';
import {
  inspectPinnedSource,
  resolvePinnedCatalogResource,
  type CatalogResourceSelector,
  type SourceInspection,
} from './catalog-preview.js';
import {
  reviewInventoryMutation,
  type ConfirmedInventoryMutation,
  type InventoryMutation,
} from './inventory-mutation.js';
import { inspectInstalledFiles } from './inventory-preview.js';
import { readCatalogSnapshot, readInventory, type InstallationTargets, type InventorySnapshot } from './snapshot.js';

export type ResourceAction = InstallationRequest['operation'] | 'remove-unmanaged';
export type ResourceActionOptions = Pick<
  InstallationRequest,
  'scope' | 'destinations' | 'force' | 'ref' | 'ghForce' | 'ghForceAgent' | 'reviewedConflicts'
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
  localConflicts?: ReadonlyMap<string, FileFingerprint>;
  inspection?: SourceInspection | (ResourceInspection & { origin: 'local'; root: string });
};

export async function runResourceAction(
  action: ResourceAction,
  selection: CatalogResource | (CatalogResourceSelector & { revision?: string }) | ConfirmedInventoryMutation,
  targets: InstallationTargets,
  options: ResourceActionOptions = {},
  onProgress?: (message: string) => void,
): Promise<ResourceActionResult> {
  const catalog = readCatalogSnapshot();
  const pinnedInstall = 'ref' in selection;
  const reviewed = 'stamp' in selection;
  const candidate = pinnedInstall
    ? resolvePinnedCatalogResource(selection, catalog.resources)
    : reviewed
      ? selection.selector
      : selection;
  const scope = action === 'install' ? options.scope || 'project' : (candidate.scope as ResourceActionOptions['scope']);
  const target = scope === 'user' ? targets.user : targets.project;
  const messages: ResourceActionResult['messages'] = [];
  let audit: AuditResult | undefined;
  let inspection: ResourceActionResult['inspection'];
  let localConflicts: ResourceActionResult['localConflicts'];
  let release: (() => void) | undefined;
  let code = 0;
  let failure: ActionFailure | undefined;
  const revision = pinnedInstall || reviewed ? selection.revision : undefined;
  try {
    if (reviewed && fs.realpathSync(target) !== target) {
      throw new CatalogError('The inventory target has moved. Restart Kitia web.', 'STALE_SOURCE');
    }
    if (action !== 'preview') release = acquireOperationLock(target);
    const targetRoot = fs.realpathSync(target);
    if (reviewed) {
      if (revision && targets.project === targets.user) {
        throw new CatalogError(
          'Project and user scopes share the same directory. Launch Kitia web from a separate project to replace a revision.',
          'STALE_SOURCE',
        );
      }
      const current = reviewInventoryMutation(
        action as InventoryMutation,
        selection.selector,
        target,
        catalog.resources,
        revision,
      );
      if (current.stamp !== selection.stamp) {
        throw new CatalogError(
          'The installation or catalog has changed. Close this dialog and review the action again.',
          'STALE_SOURCE',
        );
      }
    }
    if (revision) {
      const source = pinnedInstall
        ? candidate
        : catalog.resources.find(
            ({ catalog, kind, id }) => catalog === candidate.catalog && kind === candidate.kind && id === candidate.id,
          );
      if (!source || !(await listSourceVersionsAsync(source)).some(({ sha }) => sha === revision)) {
        throw new CatalogError('The selected commit is not in this resource’s source history.', 'REVISION_NOT_LISTED');
      }
    }
    const resource: CatalogResource = pinnedInstall && revision ? { ...candidate, source_ref: revision } : candidate;
    if (action === 'remove-unmanaged') {
      const state = readInstallState(targetRoot);
      if (resource.managed !== false) throw new Error('Only unmanaged dashboard artifacts can be removed this way.');
      onProgress?.('Removing unmanaged files...');
      messages.push(...removeUnmanagedResource(targetRoot, state, resource));
    } else if (action === 'preview' && resource.scope) {
      const local = inspectInstalledFiles(targetRoot, resource);
      inspection = { ...local, origin: 'local', root: 'local installations' };
    } else if (action === 'preview') {
      readInstallState(targetRoot);
      const preview = await inspectPinnedSource(resource, target);
      code = preview.code;
      messages.push(...preview.messages);
      inspection = preview.inspection;
    } else {
      // Keep the inventory format check before invoking any lifecycle operation.
      const state = readInstallState(targetRoot);
      if (pinnedInstall) {
        const layouts = resolveInstallationDestinations(resource.kind, scope ?? 'project', options.destinations);
        const record = state.sources[sourceCatalogName(resource)]?.[`${resource.kind}s`]?.[resource.id];
        if (record) {
          if (
            record.source_repository !== resource.source_repository ||
            record.source_path !== resource.source_path ||
            record.source_ref?.toLowerCase() !== resource.source_ref?.toLowerCase()
          ) {
            throw new CatalogError(
              'A different source is already installed in this scope. Update it before adding destinations.',
              'SHARED_SOURCE_PIN',
            );
          }
          const tracked = layouts
            .map((layout) => installationPath(layout, resource.id))
            .filter((file) => Object.hasOwn(record.files, file));
          if (tracked.length) {
            throw new CatalogError(
              `Already installed: ${tracked.join(', ')}. Choose only new destinations.`,
              'ALREADY_INSTALLED',
            );
          }
        }
      }
      const result = await executeInstallationOperation(
        {
          ...options,
          ...(reviewed && revision ? { ref: revision } : {}),
          operation: action,
          resource,
          id: resource.id,
          kind: resource.kind,
          catalog: resource.catalog,
          target,
          scope,
          audit: action === 'install',
          nonInteractive: true,
          projectTarget: targets.project,
          userTarget: targets.user,
          onProgress,
          onMessage: ({ text }) => messages.push(text),
          onAudit: (report) => {
            audit = report;
            messages.push(report);
          },
        },
        catalog.resources,
      );
      code = result.status;
    }
  } catch (error) {
    if (!(error instanceof CatalogError)) throw error;
    if (reviewed && (error.code === 'STALE_SOURCE' || error.code === 'RESOURCE_NOT_FOUND')) throw error;
    if (error instanceof ReviewedUpdateConflict) localConflicts = error.conflicts;
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
  return { code, messages, failure, inspection, localConflicts, ...readInventory(targets, catalog) };
}
