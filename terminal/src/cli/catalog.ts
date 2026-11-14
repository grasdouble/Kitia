"use strict";

import type { CatalogResource } from "../catalog/entries.js";
import type { CliOptions } from "./arguments.js";
const { matchesSearch, searchRelevance } = require("../catalog/search.js");
const { matchesLicense } = require("../catalog/license.js");
function catalogEntries(sourceResources) {
  return sourceResources.map((resource) => ({
    ...resource,
    catalog: resource.catalog || "source",
  }));
}

function listCatalogResources(sourceResources, options: CliOptions): CatalogResource[] {
  const resources = catalogEntries(sourceResources).filter((resource) => {
    const tags = resource.tags || [];
    return (!options.catalog || resource.catalog === options.catalog) &&
      (!options.kind || resource.kind === options.kind) &&
      (!options.tag || tags.includes(options.tag)) &&
      (!options.status || resource.status === options.status) &&
      (!options.license || matchesLicense(resource, options.license)) &&
      matchesSearch(resource, options.query);
  });
  if (options.query?.trim()) {
    resources.sort((left, right) =>
      searchRelevance(right, options.query) - searchRelevance(left, options.query));
  }
  return resources;
}

function formatDashboardRows(installed: CatalogResource[], allResources: CatalogResource[]): CatalogResource[] {
  const catalogResources = new Map(allResources.map((resource) => [
    `${resource.catalog}:${resource.kind}:${resource.id}`, resource,
  ]));
  return installed.map((resource) => {
    const catalogResource = catalogResources.get(`${resource.catalog}:${resource.kind}:${resource.id}`);
    return {
      ...resource,
      description: resource.managed === false
        ? resource.description
        : catalogResource?.description || resource.description ||
          (resource.status === "attention" ? "Review this installation." : ""),
      license_status: resource.license_status || catalogResource?.license_status,
      license_spdx: resource.license_spdx || catalogResource?.license_spdx,
    };
  }).sort((left, right) =>
    left.scope.localeCompare(right.scope) ||
    left.catalog.localeCompare(right.catalog) ||
    left.kind.localeCompare(right.kind) ||
    left.id.localeCompare(right.id));
}

module.exports = { catalogEntries, listCatalogResources, formatDashboardRows };