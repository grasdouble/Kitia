"use strict";

import { createRequire } from "node:module";
import type { CatalogResource } from "../catalog/entries.js";

const require = createRequire(import.meta.url);
const { matchesSearchText } = require("../catalog/search.js");

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

export function filterCatalogResources(
  resources: CatalogResource[],
  query: string,
  catalogFilter: string,
  kindFilter: string,
): CatalogResource[] {
  return resources.filter((resource) => {
    const catalog = catalogLabel(resource);
    if (catalogFilter !== "all" && catalog !== catalogFilter) return false;
    if (kindFilter !== "all" && resource.kind !== kindFilter) return false;
    return matchesSearchText(query, [
      catalog, resource.kind, resource.id, resource.description,
      resource.license_status || "",
    ]);
  });
}

type CatalogFilterProperty = "catalog" | "kind";

function catalogFilterValue(resource: CatalogResource, property: CatalogFilterProperty): string {
  if (property === "catalog") return catalogLabel(resource);
  return resource.kind;
}

export function cycleFilter(
  current: string,
  resources: CatalogResource[],
  property: CatalogFilterProperty,
  otherProperty: CatalogFilterProperty,
  otherFilter: string,
): string {
  const values = [...new Set(resources
    .filter((resource) => otherFilter === "all" || catalogFilterValue(resource, otherProperty) === otherFilter)
    .map((resource) => catalogFilterValue(resource, property))
    .filter(Boolean))].sort((left, right) => left.localeCompare(right));
  const choices = ["all", ...values];
  return choices[(choices.indexOf(current) + 1) % choices.length];
}

export function cycleIndex(length: number, index: number, offset: number): number {
  return length ? (index + offset + length) % length : 0;
}

export function filterInventory(
  resources: CatalogResource[],
  query: string,
  catalogFilter: string,
  kindFilter: string,
): CatalogResource[] {
  return resources.filter((resource) => {
    const resourceCatalog = catalogLabel(resource);
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
  const catalog = compact ? 0 : 9;
  const status = compact ? 7 : 9;
  const separators = catalog ? 6 : 4;
  const minId = compact ? 8 : 12;
  const minDescription = compact && width < 48 ? 0 : compact ? 8 : 8;
  const fixedWidth = marker + scope + kind + catalog + status + separators + minId + minDescription;
  const flexibleWidth = Math.max(0, targetWidth - fixedWidth);
  const id = compact
    ? minId + Math.min(12, flexibleWidth)
    : Math.max(12, Math.min(25, Math.floor((flexibleWidth + minId + minDescription) * 0.67)));
  const description = Math.max(0, targetWidth - marker - scope - kind - catalog - status -
    id - separators);
  return {
    marker,
    scope,
    kind,
    id,
    catalog,
    status,
    description,
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
  const source = compact ? 6 : 9;
  const kind = compact ? 5 : 8;
  const installed = compact ? 7 : 11;
  const separators = 5;
  const minId = compact ? 8 : 12;
  const minDescription = compact && width < 48 ? 0 : 8;
  const fixedWidth = marker + source + kind + installed + separators + minId + minDescription;
  const flexibleWidth = Math.max(0, targetWidth - fixedWidth);
  const id = compact
    ? minId + Math.min(14, flexibleWidth)
    : Math.max(12, Math.min(30, Math.floor((flexibleWidth + minId + minDescription) * 0.55)));
  const description = Math.max(0, targetWidth - marker - source - kind - installed -
    id - separators);
  return {
    marker,
    source,
    kind,
    id,
    installed,
    description,
  };
}

export function tableLine(fields: Array<[string, number]>): string {
  return fields.filter(([, width]) => width > 0)
    .map(([value, width]) => fitColumn(value, width)).join(" ");
}
