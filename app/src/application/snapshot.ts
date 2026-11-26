import { loadUserSourceConfiguration } from '../core/catalogs/config.js';
import { loadCatalogs, type CatalogLoadWarning } from '../core/catalogs/indexes.js';
import type { UserCatalog } from '../core/catalogs/model.js';
import { collectInstalledScopes, type ScanError } from '../core/inventory/checks.js';
import { listSourceVersionsAsync, uniqueSourceVersionPrefixes } from '../core/resources/history.js';
import type { CatalogResource } from '../core/resources/model.js';
import { catalogEntries, enrichInstalledResources } from '../core/resources/queries.js';

export type InstallationTargets = { project: string; user: string };
export type CatalogSnapshot = {
  catalogs: UserCatalog[];
  resources: CatalogResource[];
  warnings: CatalogLoadWarning[];
  unavailable: string[];
};

export type InventorySnapshot = { resources: CatalogResource[]; errors: ScanError[] };
export type InventoryWorkspace = { inventory: InventorySnapshot; catalogs: UserCatalog[] };
export type ResourceRevision = { sha: string; prefix: string; date: string; subject: string };

export function readCatalogSnapshot(sourceResources?: CatalogResource[]): CatalogSnapshot {
  const sources = loadUserSourceConfiguration();
  const warnings: CatalogLoadWarning[] = [];
  const loaded = loadCatalogs({ sources, sourceResources, allowUnavailable: true }, (warning) =>
    warnings.push(warning),
  );
  return {
    catalogs: sources.map(({ name, repository, mode, entries }) => ({ name, repository, mode, entries })),
    resources: catalogEntries(loaded.sourceResources),
    warnings,
    unavailable: loaded.unavailable,
  };
}

export function readInventory(targets: InstallationTargets, catalog: CatalogSnapshot): InventorySnapshot {
  const { resources, errors } = collectInstalledScopes(targets, catalog.resources);
  errors.push(...catalog.warnings.map((warning) => ({ ...warning, scope: 'catalog' })));
  return { resources: enrichInstalledResources(resources, catalog.resources), errors };
}

export async function listResourceRevisions(resource: CatalogResource): Promise<ResourceRevision[]> {
  const versions = await listSourceVersionsAsync(resource);
  const prefixes = uniqueSourceVersionPrefixes(versions);
  return versions.map((version, index) => ({ ...version, prefix: prefixes[index] }));
}
