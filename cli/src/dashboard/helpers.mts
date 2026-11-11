"use strict";

import { DASHBOARD_THEME } from "./colors.js";
import { createRequire } from "node:module";
import { adaptiveColumnWidths } from "../table-layout.js";
import type { CatalogResource } from "../catalog/entries.js";

const require = createRequire(import.meta.url);
const { matchesSearchText, searchRelevance } = require("../catalog/search.js");
const { matchesLicense } = require("../catalog/license.js");

export interface InventoryCatalogConfiguration {
  name: string;
  mode?: "basic" | "custom";
  entries?: Array<{ kind: string; id?: string; path: string }>;
}

type MatchedCatalogMapping = { folderPath: string };

function normalizedMappingPath(mapping: { kind: string; path: string }): string {
  const configuredPath = mapping.path.replace(/\/+$/, "");
  return mapping.kind === "skill" && configuredPath.endsWith("/SKILL.md")
    ? configuredPath.slice(0, -9)
    : configuredPath;
}

function matchCatalogMapping(
  resource: CatalogResource,
  mapping: { kind: string; id?: string; path: string },
): MatchedCatalogMapping | undefined {
  if (resource.kind !== mapping.kind || !resource.source_path ||
      mapping.id && mapping.id !== resource.id) return undefined;
  const configuredPath = normalizedMappingPath(mapping);
  const exact = resource.source_path === configuredPath;
  const descendant = resource.source_path.startsWith(`${configuredPath}/`);
  if (!exact && !descendant) return undefined;

  let folderPath = configuredPath;
  if (mapping.kind === "skill") {
    if (mapping.path.replace(/\/+$/, "").endsWith("/SKILL.md") && exact) {
      const skillDirectoryParent = configuredPath.slice(0, configuredPath.lastIndexOf("/"));
      folderPath = skillDirectoryParent.includes("/")
        ? skillDirectoryParent
        : configuredPath;
    } else if (descendant) {
      const childPath = resource.source_path.slice(configuredPath.length + 1);
      const childParts = childPath.split("/");
      if (childParts.length > 1) folderPath = `${configuredPath}/${childParts[0]}`;
    }
  } else if (exact) {
    folderPath = configuredPath.slice(0, configuredPath.lastIndexOf("/")) || ".";
  }
  return { folderPath };
}

function folderLabel(folderPath: string, folderPaths: Set<string>): string {
  const segments = folderPath.split("/");
  const basename = segments.at(-1) || ".";
  const colliding = [...folderPaths].filter((candidate) =>
    candidate !== folderPath && (candidate.split("/").at(-1) || ".") === basename);
  if (!colliding.length) return basename;
  for (let length = 2; length <= segments.length; length += 1) {
    const suffix = segments.slice(-length).join("/");
    if (colliding.every((candidate) => candidate !== suffix && !candidate.endsWith(`/${suffix}`))) {
      return suffix;
    }
  }
  return `./${folderPath}`;
}

export function dashboardStatus(resource: CatalogResource): string | undefined {
  return resource.status === "attention" && resource.issues?.length &&
    resource.issues.every((issue) => issue.code === "UPDATE_AVAILABLE")
    ? "update"
    : resource.status;
}

export function issueLine(issue: { code: string; paths?: string[] }): string {
  const label = issue.code === "UPDATE_AVAILABLE" ? "Update available" : issue.code;
  return `${label}${issue.paths?.length ? `: ${issue.paths.join(", ")}` : ""}`;
}

export function catalogLabel(resource: CatalogResource): string {
  return resource.managed === false || !resource.source_repository ? "-" : resource.catalog || "-";
}

function catalogCandidateLabel(
  resource: CatalogResource,
  labels: Map<CatalogResource, string>,
): string {
  return resource.managed === false || !resource.source_repository
    ? resource.catalog || "-"
    : labels.get(resource) || catalogLabel(resource);
}

export function filterCatalogResources(
  resources: CatalogResource[],
  query: string,
  catalogFilter: string,
  kindFilter: string,
  catalogs: InventoryCatalogConfiguration[] = [],
  filters: { tag?: string; status?: string; license?: string } = {},
): CatalogResource[] {
  const labels = inventoryCatalogLabels(resources, catalogs);
  const visible = resources.filter((resource) => {
    const catalog = catalogCandidateLabel(resource, labels);
    if (catalogFilter !== "all" && catalog !== catalogFilter) return false;
    if (kindFilter !== "all" && resource.kind !== kindFilter) return false;
    if (filters.tag && !(resource.tags || []).includes(filters.tag)) return false;
    if (filters.status && resource.status !== filters.status) return false;
    if (filters.license && !matchesLicense(resource, filters.license)) return false;
    return matchesSearchText(query, [
      catalog, resource.kind, resource.id, resource.description,
      resource.license_status || "", resource.license_spdx || "",
      resource.category || "", resource.owner || "",
      ...(resource.tags || []), resource.status || "",
      resource.use_when || "", resource.example || "",
      resource.expected_output || "", resource.source_repository || "",
      resource.source_path || "",
    ]);
  });
  if (query.trim()) {
    visible.sort((left, right) =>
      searchRelevance(right, query) - searchRelevance(left, query));
  }
  return visible;
}

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
type CatalogFilterProperty = "catalog" | "kind" | "tag" | "status" | "license";

function catalogFilterValues(
  resource: CatalogResource,
  property: CatalogFilterProperty,
  labels?: Map<CatalogResource, string>,
): string[] {
  if (property === "catalog") {
    return [labels ? catalogCandidateLabel(resource, labels) : catalogLabel(resource)];
  }
  if (property === "kind") return [resource.kind];
  if (property === "tag") return resource.tags || [];
  if (property === "status") return resource.status ? [resource.status] : [];
  return [resource.license_status, resource.license_spdx].filter((value): value is string => Boolean(value));
}

function matchesCatalogFilter(
  resource: CatalogResource,
  property: CatalogFilterProperty,
  filter: string,
  labels?: Map<CatalogResource, string>,
): boolean {
  if (property === "license") return matchesLicense(resource, filter);
  return catalogFilterValues(resource, property, labels).includes(filter);
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
  const values = [...new Set(resources
    .filter((resource) => otherFilter === "all" ||
      matchesCatalogFilter(resource, otherProperty, otherFilter, labels))
    .flatMap((resource) => catalogFilterValues(resource, property, labels))
    .filter(Boolean))].sort((left, right) => left.localeCompare(right));
  const choices = ["all", ...values];
  return choices[(choices.indexOf(current) + 1) % choices.length];
}


export function cycleIndex(length: number, index: number, offset: number): number {
  return length ? (index + offset + length) % length : 0;
}

export function inventoryCatalogLabels(
  resources: CatalogResource[],
  catalogs: InventoryCatalogConfiguration[] = [],
): Map<CatalogResource, string> {
  const labels = new Map(resources.map((resource) => [resource, catalogLabel(resource)]));
  for (const configuration of catalogs) {
    if (configuration.mode !== "custom") continue;
    const catalogResources = resources.filter((resource) =>
      resource.catalog === configuration.name && resource.managed !== false &&
      resource.source_repository && resource.source_path);
    const mappings = configuration.entries || [];
    const matches = catalogResources.map((resource) => ({
      resource,
      mappings: mappings.map((mapping) => ({
        mapping,
        match: matchCatalogMapping(resource, mapping),
      })).filter((candidate) => candidate.match !== undefined),
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
      resourceMappings.sort((left, right) =>
        normalizedMappingPath(right.mapping).length - normalizedMappingPath(left.mapping).length);
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
): CatalogResource[] {
  const labels = precomputedLabels || inventoryCatalogLabels(resources, catalogs);
  return resources.filter((resource) => {
    const resourceCatalog = labels.get(resource) || catalogLabel(resource);
    if (catalogFilter !== "all" && resourceCatalog !== catalogFilter) return false;
    if (kindFilter !== "all" && resource.kind !== kindFilter) return false;
    return matchesSearchText(query, [
      resource.scope, resourceCatalog, resource.kind, resource.id,
      resource.status, resource.description,
      ...(resource.issues || []).flatMap((issue) => [issue.code, ...(issue.paths || [])]),
    ]);
  });
}
export function colorForStatus(status?: string) {
  if (status === "unmanaged") return DASHBOARD_THEME.semantic.inventoryStatus.unmanaged;
  if (status === "attention") return DASHBOARD_THEME.semantic.inventoryStatus.attention;
  if (status === "update") return DASHBOARD_THEME.semantic.inventoryStatus.update;
  return DASHBOARD_THEME.semantic.inventoryStatus.current;
}

export function fitText(value: unknown, width: number): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  const characters = Array.from(text);
  if (characters.length <= width) return text;
  return `${characters.slice(0, Math.max(0, width - 3)).join("")}...`;
}

export function fitColumn(value: unknown, width: number): string {
  return fitText(value, width).padEnd(width);
}

export function wrapText(value: unknown, width: number, maxLines = Infinity): string[] {
  const lines = [];
  let line = "";
  for (const originalWord of String(value || "").split(/\s+/).filter(Boolean)) {
    let word = originalWord;
    while (word.length > width) {
      if (line) {
        lines.push(line);
        line = "";
      }
      const slash = word.lastIndexOf("/", width - 1);
      const splitAt = slash > 0 ? slash + 1 : width;
      lines.push(word.slice(0, splitAt));
      word = word.slice(splitAt);
    }
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = "";
    }
    line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  if (!lines.length) return [""];
  if (lines.length <= maxLines) return lines;
  const limited = lines.slice(0, maxLines);
  limited[maxLines - 1] = fitText(`${limited[maxLines - 1].slice(0, -3)}...`, width);
  return limited;
}

export function tableColumns(
  width: number,
  idContentWidth = 12,
  catalogContentWidth = 9,
) {
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
    ...(!compact ? [{
      contentWidth: catalogContent,
      minWidth: 9,
      growWeight: 2,
    }] : []),
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

export function catalogTableColumns(
  width: number,
  sourceContentWidth = 12,
  idContentWidth = 12,
  kindContentWidth = 4,
) {
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
  return fields.filter(([, width]) => width > 0)
    .map(([value, width]) => fitColumn(value, width)).join(" ");
}
