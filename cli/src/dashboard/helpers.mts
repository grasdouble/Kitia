"use strict";

import { createRequire } from "node:module";
import type { CatalogResource } from "../catalog/entries.js";

const require = createRequire(import.meta.url);
const { matchesSearchText } = require("../catalog/search.js");

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
): CatalogResource[] {
  const labels = inventoryCatalogLabels(resources, catalogs);
  return resources.filter((resource) => {
    const catalog = catalogCandidateLabel(resource, labels);
    if (catalogFilter !== "all" && catalog !== catalogFilter) return false;
    if (kindFilter !== "all" && resource.kind !== kindFilter) return false;
    return matchesSearchText(query, [
      catalog, resource.kind, resource.id, resource.description,
      resource.license_status || "",
    ]);
  });
}

type CatalogFilterProperty = "catalog" | "kind";

function catalogFilterValue(
  resource: CatalogResource,
  property: CatalogFilterProperty,
  labels?: Map<CatalogResource, string>,
): string {
  if (property === "catalog") {
    return labels ? catalogCandidateLabel(resource, labels) : catalogLabel(resource);
  }
  return resource.kind;
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
    .filter((resource) => otherFilter === "all" || catalogFilterValue(resource, otherProperty, labels) === otherFilter)
    .map((resource) => catalogFilterValue(resource, property, labels))
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
  if (status === "unmanaged") return "gray";
  if (status === "attention") return "yellow";
  if (status === "update") return "blue";
  return "green";
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
  for (const word of String(value || "").split(/\s+/).filter(Boolean)) {
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

export function tableColumns(width: number) {
  const targetWidth = Math.max(1, width - 6);
  const compact = width < 64;
  const marker = 2;
  const scope = compact ? 5 : 7;
  const kind = compact ? 5 : 8;
  const status = compact ? 7 : 9;
  const separators = compact ? 4 : 5;
  const id = Math.max(compact ? 8 : 12, Math.min(24, Math.floor(targetWidth * 0.18)));
  const catalog = compact ? 0 : Math.max(9, targetWidth - marker - scope - kind - status - id - separators);
  return {
    marker,
    status,
    scope,
    kind,
    id,
    catalog,
  };
}
export function detailPanelLayout(width: number) {
  if (width < 112) {
    return { sideBySide: false, listWidth: undefined, detailsWidth: undefined };
  }
  const available = width - 3;
  const listWidth = Math.floor(available * 0.68);
  return {
    sideBySide: true,
    listWidth,
    detailsWidth: available - listWidth,
  };
}


export function catalogTableColumns(width: number) {
  const targetWidth = Math.max(1, width - 6);
  const compact = width < 64;
  const marker = 2;
  const source = compact ? 11 : 30;
  const kind = compact ? 8 : 12;
  const installed = compact ? 7 : 11;
  const separators = 4;
  const minId = compact ? 8 : 12;
  const fixedWidth = marker + source + kind + installed + separators + minId;
  const flexibleWidth = Math.max(0, targetWidth - fixedWidth);
  const id = compact
    ? minId + Math.min(14, flexibleWidth)
    : Math.max(12, Math.min(30, minId + flexibleWidth));
  return { marker, source, kind, installed, id };
}

export function tableLine(fields: Array<[string, number]>): string {
  return fields.filter(([, width]) => width > 0)
    .map(([value, width]) => fitColumn(value, width)).join(" ");
}
