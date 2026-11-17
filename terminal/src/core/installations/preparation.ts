"use strict";

const { readInstallState } = require("./state.js");
const { inventorySourceNames, sourceResourceRecords } = require("./inventory.js");
const fs = require("node:fs");
function sourceResourcesFromInventory(state) {
  return [...sourceResourceRecords(state)].map(([key, record]) => {
    const [catalog, kind, id] = key.split(":");
    return {
      id,
      kind,
      catalog,
      source_repository: record.source_repository,
      source_path: record.source_path,
      source_ref: record.source_ref || null,
      description: `Tracked source ${kind} installation.`,
      license_status: record.license_status || "not-declared",
      ...(record.apply_to ? { apply_to: record.apply_to, applyTo: record.apply_to } : {}),
    };
  });
}




export interface TrackedResourceRequest {
  catalog?: string;
  kind?: string;
  id?: string;
  registeredCatalogs: string[];
  includeRemovedCatalogs?: boolean;
}
function prepareTrackedResources(
  target: string,
  { catalog, kind, id, registeredCatalogs, includeRemovedCatalogs = false }: TrackedResourceRequest,
) {
  const state = readInstallState(fs.realpathSync(target));
  const records = sourceResourceRecords(state);
  const installedCatalogs = inventorySourceNames(state);
  const names = catalog ? [catalog] : installedCatalogs.filter((name) =>
    (includeRemovedCatalogs || registeredCatalogs.includes(name)) && [...records.keys()].some((key) =>
      key.startsWith(`${name}:`) && (!id || key.split(":")[2] === id) && (!kind || key.split(":")[1] === kind)));
  return {
    names,
    installedCatalogs,
    resources: sourceResourcesFromInventory(state).filter((resource) =>
      names.includes(resource.catalog) && (!id || resource.id === id) && (!kind || resource.kind === kind)),
  };
}

module.exports = { sourceResourcesFromInventory, prepareTrackedResources };
