import { availableInstallationDestinations } from '../installations/destinations.js';
import type { InstallationScope } from '../installations/model.js';
import { matchesLicense } from '../resources/license.js';
import type { CatalogResource } from '../resources/model.js';
import { matchesSearchText } from '../resources/search.js';

export interface InventoryCatalogConfiguration {
  name: string;
  mode?: 'basic' | 'custom';
  entries?: Array<{ kind: string; id?: string; path: string }>;
}

type MatchedCatalogMapping = { folderPath: string };

function normalizedMappingPath(mapping: { kind: string; path: string }): string {
  const configuredPath = mapping.path.replace(/\/+$/, '');
  return mapping.kind === 'skill' && configuredPath.endsWith('/SKILL.md')
    ? configuredPath.slice(0, -9)
    : configuredPath;
}

function matchCatalogMapping(
  resource: CatalogResource,
  mapping: { kind: string; id?: string; path: string },
): MatchedCatalogMapping | undefined {
  if (resource.kind !== mapping.kind || !resource.source_path || (mapping.id && mapping.id !== resource.id))
    return undefined;
  const configuredPath = normalizedMappingPath(mapping);
  const exact = resource.source_path === configuredPath;
  const descendant = resource.source_path.startsWith(`${configuredPath}/`);
  if (!exact && !descendant) return undefined;

  let folderPath = configuredPath;
  if (mapping.kind === 'skill') {
    if (mapping.path.replace(/\/+$/, '').endsWith('/SKILL.md') && exact) {
      const skillDirectoryParent = configuredPath.slice(0, configuredPath.lastIndexOf('/'));
      folderPath = skillDirectoryParent.includes('/') ? skillDirectoryParent : configuredPath;
    } else if (descendant) {
      const childPath = resource.source_path.slice(configuredPath.length + 1);
      const childParts = childPath.split('/');
      if (childParts.length > 1) folderPath = `${configuredPath}/${childParts[0]}`;
    }
  } else if (exact) {
    folderPath = configuredPath.slice(0, configuredPath.lastIndexOf('/')) || '.';
  }
  return { folderPath };
}

function folderLabel(folderPath: string, folderPaths: Set<string>): string {
  const segments = folderPath.split('/');
  const basename = segments.at(-1) || '.';
  const colliding = [...folderPaths].filter(
    (candidate) => candidate !== folderPath && (candidate.split('/').at(-1) || '.') === basename,
  );
  if (!colliding.length) return basename;
  for (let length = 2; length <= segments.length; length += 1) {
    const suffix = segments.slice(-length).join('/');
    if (colliding.every((candidate) => candidate !== suffix && !candidate.endsWith(`/${suffix}`))) {
      return suffix;
    }
  }
  return `./${folderPath}`;
}

export function dashboardStatus(resource: CatalogResource): string | undefined {
  return resource.status === 'attention' &&
    resource.issues?.length &&
    resource.issues.every((issue) => issue.code === 'UPDATE_AVAILABLE')
    ? 'update'
    : resource.status;
}

export function issueLine(issue: { code: string; paths?: string[] }): string {
  const label = issue.code === 'UPDATE_AVAILABLE' ? 'Update available' : issue.code;
  return `${label}${issue.paths?.length ? `: ${issue.paths.join(', ')}` : ''}`;
}

export function catalogLabel(resource: CatalogResource): string {
  return resource.managed === false || !resource.source_repository ? '-' : resource.catalog || '-';
}

export function inventoryCatalogLabels(
  resources: CatalogResource[],
  catalogs: InventoryCatalogConfiguration[] = [],
): Map<CatalogResource, string> {
  const labels = new Map(resources.map((resource) => [resource, catalogLabel(resource)]));
  for (const configuration of catalogs) {
    if (configuration.mode !== 'custom') continue;
    const catalogResources = resources.filter(
      (resource) =>
        resource.catalog === configuration.name &&
        resource.managed !== false &&
        resource.source_repository &&
        resource.source_path,
    );
    const mappings = configuration.entries || [];
    const matches = catalogResources.map((resource) => ({
      resource,
      mappings: mappings
        .map((mapping) => ({
          mapping,
          match: matchCatalogMapping(resource, mapping),
        }))
        .filter((candidate) => candidate.match !== undefined),
    }));
    const folderPathsByKind = new Map<string, Set<string>>();
    for (const { resource, mappings: resourceMappings } of matches) {
      let folderPaths = folderPathsByKind.get(resource.kind);
      if (!folderPaths) {
        folderPaths = new Set();
        folderPathsByKind.set(resource.kind, folderPaths);
      }
      for (const { match } of resourceMappings) folderPaths.add(match!.folderPath);
    }
    for (const { resource, mappings: resourceMappings } of matches) {
      resourceMappings.sort(
        (left, right) => normalizedMappingPath(right.mapping).length - normalizedMappingPath(left.mapping).length,
      );
      const selected = resourceMappings[0]?.match;
      if (selected) {
        const folderPaths = folderPathsByKind.get(resource.kind)!;
        labels.set(resource, `${resource.catalog}[${folderLabel(selected.folderPath, folderPaths)}]`);
      }
    }
  }
  return labels;
}

export function inventoryCatalogLabel(
  resource: CatalogResource,
  catalogs: InventoryCatalogConfiguration[] = [],
  resources: CatalogResource[] = [resource],
): string {
  return inventoryCatalogLabels(resources, catalogs).get(resource) || catalogLabel(resource);
}

export function filterInventory(
  resources: CatalogResource[],
  query: string,
  catalogFilter: string,
  kindFilter: string,
  catalogs: InventoryCatalogConfiguration[] = [],
  precomputedLabels?: Map<CatalogResource, string>,
  licenseFilter = 'all',
): CatalogResource[] {
  const labels = precomputedLabels || inventoryCatalogLabels(resources, catalogs);
  return resources.filter((resource) => {
    const resourceCatalog = labels.get(resource) || catalogLabel(resource);
    if (catalogFilter !== 'all' && resourceCatalog !== catalogFilter) return false;
    if (kindFilter !== 'all' && resource.kind !== kindFilter) return false;
    if (licenseFilter !== 'all' && !matchesLicense(resource, licenseFilter)) return false;
    return matchesSearchText(query, [
      resource.scope,
      resourceCatalog,
      resource.kind,
      resource.id,
      resource.status,
      resource.description,
      ...(resource.issues || []).flatMap((issue) => [issue.code, ...(issue.paths || [])]),
    ]);
  });
}

export function installedDestinationLabels(resource: CatalogResource): string {
  if (!resource.paths?.length) return '';
  const paths = resource.paths.map((path) => (path.startsWith('./') ? path.slice(2) : path));
  const labels = new Set<string>();
  for (const { directory, label } of availableInstallationDestinations(resource.kind)) {
    const prefix = `${directory}/`;
    if (paths.some((path) => path.startsWith(prefix))) labels.add(label);
  }
  return [...labels].join(' · ');
}

export function canPreviewInstalledResource(
  resource: CatalogResource | undefined,
): resource is CatalogResource & { scope: InstallationScope } {
  return (
    (resource?.scope === 'project' || resource?.scope === 'user') &&
    (resource.managed === false
      ? Boolean(resource.paths?.length)
      : Boolean(resource.source_repository && resource.source_path))
  );
}

export function summarizeInventory(resources: CatalogResource[]) {
  const summary = {
    project: { total: 0, managed: 0 },
    user: { total: 0, managed: 0 },
    current: 0,
    updates: 0,
    warnings: 0,
  };
  for (const resource of resources) {
    const scope = resource.scope === 'project' || resource.scope === 'user' ? summary[resource.scope] : undefined;
    if (scope) scope.total += 1;
    if (resource.managed === false) continue;
    if (scope) scope.managed += 1;
    switch (dashboardStatus(resource)) {
      case 'current':
        summary.current += 1;
        break;
      case 'update':
        summary.updates += 1;
        break;
      case 'attention':
        summary.warnings += 1;
        break;
    }
  }
  return summary;
}
