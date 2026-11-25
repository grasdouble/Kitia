import { catalogLabel, inventoryCatalogLabels, type InventoryCatalogConfiguration } from '../inventory/view.js';
import { matchesLicense } from './license.js';
import type { CatalogResource } from './model.js';
import { matchesSearchText, searchRelevance } from './search.js';

export function catalogCandidateLabel(resource: CatalogResource, labels: Map<CatalogResource, string>): string {
  return resource.managed === false || !resource.source_repository
    ? resource.catalog || '-'
    : labels.get(resource) || catalogLabel(resource);
}

export function filterCatalogResources(
  resources: CatalogResource[],
  query: string,
  catalogFilter: string,
  kindFilter: string,
  catalogs: InventoryCatalogConfiguration[] = [],
  filters: { license?: string; labels?: Map<CatalogResource, string> } = {},
): CatalogResource[] {
  const labels = filters.labels ?? inventoryCatalogLabels(resources, catalogs);
  const visible = resources.filter((resource) => {
    const catalog = catalogCandidateLabel(resource, labels);
    if (catalogFilter !== 'all' && catalog !== catalogFilter) return false;
    if (kindFilter !== 'all' && resource.kind !== kindFilter) return false;
    if (filters.license && !matchesLicense(resource, filters.license)) return false;
    return matchesSearchText(query, [
      catalog,
      resource.kind,
      resource.id,
      resource.description,
      resource.license_status || '',
      resource.license_spdx || '',
      resource.category || '',
      resource.owner || '',
      ...(resource.tags || []),
      resource.status || '',
      resource.use_when || '',
      resource.example || '',
      resource.expected_output || '',
      resource.source_repository || '',
      resource.source_path || '',
    ]);
  });
  if (query.trim()) {
    visible.sort((left, right) => searchRelevance(right, query) - searchRelevance(left, query));
  }
  return visible;
}
