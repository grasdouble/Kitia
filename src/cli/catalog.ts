"use strict";

import type { CatalogResource, CliOptions } from "../types.js";
const { CatalogError } = require("../catalog/resources/index.js");
const { matchesSearch } = require("../catalog/search.js");

function catalogEntries(
  resources: CatalogResource[],
  sourceResources: CatalogResource[],
): CatalogResource[] {
  const seen = new Set();
  for (const resource of resources) {
    const key = `${resource.kind}:${resource.id}`;
    if (seen.has(key)) {
      throw new CatalogError(`Duplicate catalog resource: ${key}`);
    }
    seen.add(key);
  }
  const internalEntries = resources.map((resource) => ({
    ...resource,
    catalog: "internal" as const,
  }));
  const sourceEntries = sourceResources.map((resource) => ({
    ...resource,
    catalog: resource.catalog || "source",
  }));
  return [...internalEntries, ...sourceEntries];
}

function listCatalogResources(
  resources: CatalogResource[],
  sourceResources: CatalogResource[],
  options: CliOptions,
): CatalogResource[] {
  return catalogEntries(resources, sourceResources).filter((resource) => {
    const tags = resource.tags || [];
    return (!options.catalog || resource.catalog === options.catalog) &&
      (!options.kind || resource.kind === options.kind) &&
      (!options.tag || tags.includes(options.tag)) &&
      (!options.status || resource.status === options.status) &&
      (!options.group || resource.group === options.group) &&
      matchesSearch(resource, options.query);
  });
}
function formatDashboardRows(installed: CatalogResource[], allResources: CatalogResource[]): CatalogResource[] {
  const descriptions = new Map(allResources.map((resource) => [
    `${resource.catalog}:${resource.kind}:${resource.id}`, resource.description,
  ]));
  return installed.map((resource) => ({
    ...resource,
    description: resource.managed === false
      ? resource.description
      : descriptions.get(`${resource.catalog}:${resource.kind}:${resource.id}`) ||
        resource.description || (resource.status === "attention" ? "Review this installation." : ""),
  })).sort((left, right) =>
    left.scope.localeCompare(right.scope) ||
    left.catalog.localeCompare(right.catalog) ||
    left.kind.localeCompare(right.kind) ||
    left.id.localeCompare(right.id));
}

module.exports = { catalogEntries, listCatalogResources, formatDashboardRows };
