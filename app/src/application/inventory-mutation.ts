import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { trackedPaths } from '../core/installations/files.js';
import { findUnmanagedArtifacts } from '../core/inventory/discovery.js';
import { readInstallState } from '../core/inventory/inventory.js';
import { CatalogError, type CatalogResource } from '../core/resources/model.js';
import type { InstalledResourceSelector } from './inventory-preview.js';

export type InventoryMutation = 'update' | 'uninstall' | 'remove-unmanaged';
export type InventoryMutationReview = { paths: string[]; ref?: string; catalogPin?: string; stamp: string };
export type ConfirmedInventoryMutation = { selector: InstalledResourceSelector; stamp: string; revision?: string };
export type InventoryMutationRetry = { ticket: string; review: InventoryMutationReview; kind: 'local' | 'github' };

export function reviewInventoryMutation(
  action: InventoryMutation,
  selector: InstalledResourceSelector,
  target: string,
  resources: CatalogResource[],
  revision?: string,
): InventoryMutationReview {
  if (fs.realpathSync(target) !== target)
    throw new CatalogError('The inventory target has moved. Restart Kitia web.', 'STALE_SOURCE');
  const { catalog, id, kind, managed, scope } = selector;
  const state = readInstallState(target);
  const record =
    managed && Object.hasOwn(state.sources, catalog) && Object.hasOwn(state.sources[catalog][`${kind}s`] ?? {}, id)
      ? state.sources[catalog][`${kind}s`][id]
      : undefined;
  let paths: string[];
  let observed: unknown = record;
  if (action === 'remove-unmanaged' && !managed && catalog === '-') {
    const artifact = findUnmanagedArtifacts(target, trackedPaths(state)).find(
      (entry) => entry.kind === kind && entry.id === id,
    );
    paths = artifact?.paths.map((file) => (kind === 'skill' ? path.posix.dirname(file) : file)) ?? [];
    observed = paths.map((file) => {
      const stat = fs.lstatSync(path.join(target, file));
      return [stat.dev, stat.ino, stat.size, stat.mtimeMs];
    });
  } else {
    paths = action !== 'remove-unmanaged' && record ? Object.keys(record.files).sort() : [];
  }
  if (!paths.length)
    throw new CatalogError('This resource is no longer available in the selected scope.', 'RESOURCE_NOT_FOUND');
  const source =
    action === 'update'
      ? resources.find((entry) => entry.catalog === catalog && entry.kind === kind && entry.id === id)
      : undefined;
  if (
    action === 'update' &&
    (!source?.source_ref ||
      !source.source_repository ||
      !source.source_path ||
      record?.source_repository !== source.source_repository ||
      record.source_path !== source.source_path)
  ) {
    throw new CatalogError(
      'The catalog source is unavailable for update. You can still uninstall the resource.',
      'STALE_SOURCE',
    );
  }
  const stamp = createHash('sha256')
    .update(
      JSON.stringify([
        action,
        scope,
        target,
        catalog,
        kind,
        id,
        managed,
        paths,
        observed,
        source?.source_repository,
        source?.source_path,
        source?.source_ref,
        revision,
      ]),
    )
    .digest('hex');
  const catalogPin = source?.source_ref ?? undefined;
  return { paths, ref: revision ?? catalogPin, catalogPin, stamp };
}
