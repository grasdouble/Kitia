"use strict";

import type { CatalogResource } from "../catalog/entries.js";
import type { CliOptions } from "./arguments.js";
const { matchesSearch } = require("../catalog/search.js");
function catalogEntries(sourceResources) {
  return sourceResources.map((resource) => ({
    ...resource,
    catalog: resource.catalog || "source",
  }));
}

function listCatalogResources(sourceResources, options: CliOptions): CatalogResource[] {
  return catalogEntries(sourceResources).filter((resource) => {
    const tags = resource.tags || [];
    return (!options.catalog || resource.catalog === options.catalog) &&
      (!options.kind || resource.kind === options.kind) &&
      (!options.tag || tags.includes(options.tag)) &&
      (!options.status || resource.status === options.status) &&
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