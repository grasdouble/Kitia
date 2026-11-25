import {
  catalogLabel,
  filterInventory,
  inventoryCatalogLabels,
  type InventoryCatalogConfiguration,
} from '../core/inventory/view.js';
import { catalogCandidateLabel, filterCatalogResources } from '../core/resources/catalog-view.js';
import { matchesLicense } from '../core/resources/license.js';
import type { CatalogResource } from '../core/resources/model.js';
import { adaptiveColumnWidths } from '../table-layout.js';
import { DASHBOARD_THEME } from './colors.js';

export function mergeRefreshedCatalogResources(
  current: CatalogResource[],
  incoming: CatalogResource[],
  refreshedCatalogs: string[],
): CatalogResource[] {
  const refreshedNames = new Set(refreshedCatalogs.map((name) => name.toLowerCase()));
  if (!refreshedNames.size) return current;
  const replacements = new Map<string, CatalogResource[]>();
  for (const resource of incoming) {
    const name = resource.catalog?.toLowerCase();
    if (!name || !refreshedNames.has(name)) continue;
    const resources = replacements.get(name) || [];
    resources.push(resource);
    replacements.set(name, resources);
  }
  const inserted = new Set<string>();
  const merged: CatalogResource[] = [];
  for (const resource of current) {
    const name = resource.catalog?.toLowerCase();
    if (!name || !refreshedNames.has(name)) {
      merged.push(resource);
    } else if (!inserted.has(name)) {
      merged.push(...(replacements.get(name) || []));
      inserted.add(name);
    }
  }
  for (const name of refreshedNames) {
    if (!inserted.has(name)) merged.push(...(replacements.get(name) || []));
  }
  return merged;
}
type CatalogFilterProperty = 'catalog' | 'kind' | 'license';

function catalogFilterValues(
  resource: CatalogResource,
  property: CatalogFilterProperty,
  labels?: Map<CatalogResource, string>,
): string[] {
  if (property === 'catalog') {
    return [labels ? catalogCandidateLabel(resource, labels) : catalogLabel(resource)];
  }
  if (property === 'kind') return [resource.kind];
  return [resource.license_status, resource.license_spdx].filter((value): value is string => Boolean(value));
}

function matchesCatalogFilter(
  resource: CatalogResource,
  property: CatalogFilterProperty,
  filter: string,
  labels?: Map<CatalogResource, string>,
): boolean {
  if (property === 'license') return matchesLicense(resource, filter);
  return catalogFilterValues(resource, property, labels).includes(filter);
}

function uniqueFilterChoices(
  resources: CatalogResource[],
  property: CatalogFilterProperty,
  labels?: Map<CatalogResource, string>,
) {
  return [
    ...new Set(resources.flatMap((resource) => catalogFilterValues(resource, property, labels)).filter(Boolean)),
  ].sort((left, right) => left.localeCompare(right));
}

export function inventoryFilterOptions(
  resources: CatalogResource[],
  property: CatalogFilterProperty,
  catalogFilter: string,
  kindFilter: string,
  licenseFilter: string,
  catalogs: InventoryCatalogConfiguration[] = [],
): string[] {
  const labels = inventoryCatalogLabels(resources, catalogs);
  const eligible = resources.filter(
    (resource) =>
      (property === 'catalog' ||
        catalogFilter === 'all' ||
        matchesCatalogFilter(resource, 'catalog', catalogFilter, labels)) &&
      (property === 'kind' || kindFilter === 'all' || matchesCatalogFilter(resource, 'kind', kindFilter, labels)) &&
      (property === 'license' ||
        licenseFilter === 'all' ||
        matchesCatalogFilter(resource, 'license', licenseFilter, labels)),
  );
  return ['all', ...uniqueFilterChoices(eligible, property, labels)];
}

export function catalogFilterOptions(
  resources: CatalogResource[],
  property: CatalogFilterProperty,
  filters: { catalog: string; kind: string; license: string },
  catalogs: InventoryCatalogConfiguration[] = [],
): string[] {
  const labels = inventoryCatalogLabels(resources, catalogs);
  const eligible =
    property === 'catalog'
      ? resources.filter(
          (resource) => filters.kind === 'all' || matchesCatalogFilter(resource, 'kind', filters.kind, labels),
        )
      : property === 'kind'
        ? resources.filter(
            (resource) =>
              filters.catalog === 'all' || matchesCatalogFilter(resource, 'catalog', filters.catalog, labels),
          )
        : filterCatalogResources(resources, '', filters.catalog, filters.kind, catalogs);
  const values = uniqueFilterChoices(eligible, property, labels).filter(
    (value) => property !== 'license' || eligible.some((resource) => matchesLicense(resource, value)),
  );
  return ['all', ...values];
}

export function cycleFilter(
  current: string,
  resources: CatalogResource[],
  property: CatalogFilterProperty,
  otherProperty: CatalogFilterProperty,
  otherFilter: string,
  inventoryCatalogs?: InventoryCatalogConfiguration[],
): string {
  const labels = inventoryCatalogs ? inventoryCatalogLabels(resources, inventoryCatalogs) : undefined;
  const values = [
    ...new Set(
      resources
        .filter(
          (resource) => otherFilter === 'all' || matchesCatalogFilter(resource, otherProperty, otherFilter, labels),
        )
        .flatMap((resource) => catalogFilterValues(resource, property, labels))
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const choices = ['all', ...values];
  const index = choices.indexOf(current);
  return choices[index < 0 ? 1 : (index + 1) % choices.length] || 'all';
}

export function cycleCatalogFilter(
  current: string,
  resources: CatalogResource[],
  property: 'catalog' | 'kind' | 'license',
  filters: { catalog: string; kind: string; license: string },
  catalogs: InventoryCatalogConfiguration[] = [],
): string {
  if (property === 'catalog' || property === 'kind') {
    const otherProperty = property === 'catalog' ? 'kind' : 'catalog';
    return cycleFilter(current, resources, property, otherProperty, filters[otherProperty], catalogs);
  }

  const scopedResources = filterCatalogResources(resources, '', filters.catalog, filters.kind, catalogs);
  const values = [
    ...new Set(scopedResources.flatMap((resource) => catalogFilterValues(resource, 'license')).filter(Boolean)),
  ]
    .filter((value) => scopedResources.some((resource) => matchesLicense(resource, value)))
    .sort((left, right) => left.localeCompare(right));
  const choices = ['all', ...values];
  const index = choices.indexOf(current);
  return choices[index < 0 ? 1 : (index + 1) % choices.length] || 'all';
}

export function cycleIndex(length: number, index: number, offset: number): number {
  return length ? (index + offset + length) % length : 0;
}

export function cycleInventoryLicense(
  current: string,
  resources: CatalogResource[],
  catalogFilter: string,
  kindFilter: string,
  catalogs: InventoryCatalogConfiguration[] = [],
): string {
  const labels = inventoryCatalogLabels(resources, catalogs);
  const eligible = filterInventory(resources, '', catalogFilter, kindFilter, catalogs, labels);
  const values = [...new Set(eligible.flatMap((resource) => catalogFilterValues(resource, 'license')).filter(Boolean))]
    .filter((value) => eligible.some((resource) => matchesLicense(resource, value)))
    .sort((left, right) => left.localeCompare(right));
  const choices = ['all', ...values];
  const index = choices.indexOf(current);
  return choices[index < 0 ? 1 : (index + 1) % choices.length] || 'all';
}
export function colorForStatus(status?: string) {
  if (status === 'unmanaged') return DASHBOARD_THEME.semantic.inventoryStatus.unmanaged;
  if (status === 'attention') return DASHBOARD_THEME.semantic.inventoryStatus.attention;
  if (status === 'update') return DASHBOARD_THEME.semantic.inventoryStatus.update;
  return DASHBOARD_THEME.semantic.inventoryStatus.current;
}

export function fitText(value: unknown, width: number): string {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  const characters = Array.from(text);
  if (characters.length <= width) return text;
  return `${characters.slice(0, Math.max(0, width - 3)).join('')}...`;
}

export function fitColumn(value: unknown, width: number): string {
  return fitText(value, width).padEnd(width);
}

export function wrapText(value: unknown, width: number, maxLines = Infinity): string[] {
  const lines = [];
  let line = '';
  for (const originalWord of String(value || '')
    .split(/\s+/)
    .filter(Boolean)) {
    let word = originalWord;
    while (word.length > width) {
      if (line) {
        lines.push(line);
        line = '';
      }
      const slash = word.lastIndexOf('/', width - 1);
      const splitAt = slash > 0 ? slash + 1 : width;
      lines.push(word.slice(0, splitAt));
      word = word.slice(splitAt);
    }
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = '';
    }
    line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  if (!lines.length) return [''];
  if (lines.length <= maxLines) return lines;
  const limited = lines.slice(0, maxLines);
  limited[maxLines - 1] = fitText(`${limited[maxLines - 1].slice(0, -3)}...`, width);
  return limited;
}

export function tableColumns(width: number, idContentWidth = 12, catalogContentWidth = 9) {
  const compact = width < 58;
  const marker = 2;
  const scope = compact ? 5 : 7;
  const kind = compact ? 5 : 8;
  const status = compact ? 7 : 9;
  const idContent = Math.max(8, idContentWidth);
  const catalogContent = Math.max(9, catalogContentWidth);
  const fields = adaptiveColumnWidths(width, [
    { contentWidth: marker, minWidth: marker, maxWidth: marker, shrinkWeight: 0 },
    { contentWidth: status, minWidth: 6, growWeight: 1 },
    { contentWidth: scope, minWidth: 5, growWeight: 1 },
    { contentWidth: kind, minWidth: 5, growWeight: 1 },
    {
      contentWidth: idContent,
      minWidth: 8,
      growWeight: 2,
    },
    ...(!compact
      ? [
          {
            contentWidth: catalogContent,
            minWidth: 9,
            growWeight: 2,
          },
        ]
      : []),
  ]);
  return {
    marker: fields[0],
    status: fields[1],
    scope: fields[2],
    kind: fields[3],
    id: fields[4],
    catalog: compact ? 0 : fields[5],
  };
}
export function detailPanelLayout(width: number, listRatio = 0.68) {
  if (width < 112) {
    return { sideBySide: false, listWidth: undefined, detailsWidth: undefined };
  }
  const available = width - 3;
  const listWidth = Math.floor(available * listRatio);
  return {
    sideBySide: true,
    listWidth,
    detailsWidth: available - listWidth,
  };
}

export function catalogTableColumns(width: number, sourceContentWidth = 12, idContentWidth = 12, kindContentWidth = 4) {
  const compact = width < 58;
  const marker = 2;
  const installed = compact ? 4 : 9;
  const sourceContent = Math.max(8, sourceContentWidth);
  const idContent = Math.max(8, idContentWidth);
  const kind = Math.max(compact ? 5 : 4, kindContentWidth);
  const naturalWidth = marker + installed + kind + 4 + sourceContent + idContent;
  const preserveValues = naturalWidth <= width;
  const fields = adaptiveColumnWidths(width, [
    { contentWidth: marker, minWidth: marker, maxWidth: marker, shrinkWeight: 0 },
    { contentWidth: installed, minWidth: installed, maxWidth: installed + 2, growWeight: 1 },
    {
      contentWidth: sourceContent,
      minWidth: preserveValues ? sourceContent : Math.min(sourceContent, 8),
      growWeight: 2,
      shrinkWeight: 1,
    },
    { contentWidth: kind, minWidth: kind, maxWidth: kind + 2, growWeight: 1 },
    {
      contentWidth: idContent,
      minWidth: preserveValues ? idContent : Math.min(idContent, 8),
      growWeight: 2,
      shrinkWeight: 1,
    },
  ]);
  return {
    marker: fields[0],
    installed: fields[1],
    source: fields[2],
    kind: fields[3],
    id: fields[4],
    compact,
  };
}

export function tableLine(fields: Array<[string, number]>): string {
  return fields
    .filter(([, width]) => width > 0)
    .map(([value, width]) => fitColumn(value, width))
    .join(' ');
}
