"use strict";

import type { SourceOperationRequest, SourceOperationResult, InstallationMessage } from "./source-operation.js";
const { runSourceOperation } = require("./source-operation.js");
import type { CatalogResource } from "../resources/model.js";
const { CatalogError, USER_INSTALLABLE_KINDS } = require("../resources/model.js");
const { resolveCatalogResource } = require("../resources/selection.js");
const { catalogEntries } = require("../resources/queries.js");
const { readInstalledSourceSkills, readInstalledSourceResources } = require("./inventory.js");
const { uninstallSourceResource, validateSourceUpdates, updateSourceResourcesAsync, updateSourceResources } = require("./operations.js");
const { resolveListedSourceRef } = require("./resolution.js");
const fs = require("node:fs");
const os = require("node:os");
export interface InstallationRequest extends Omit<SourceOperationRequest, "action" | "resource"> {
  operation: "install" | "preview" | "update" | "uninstall";
  resource?: CatalogResource;
  id?: string;
  kind?: string;
  catalog?: string;
  ref?: string;
  ghForce?: boolean;
  ghForceAgent?: string;
  projectTarget?: string;
  userTarget?: string;
}

export interface InstallationResult {
  status: number;
  messages: InstallationMessage[];
  preview?: string;
  resource?: CatalogResource;
}

/**
 * Callers hold the target operation lock for mutations, including catalog/inventory
 * preparation before this call and all selection, validation, apply, and recording.
 * Preview is read-only. This operation never acquires a nested lock.
 */
async function executeInstallationOperation(
  options: InstallationRequest,
  sourceResources: CatalogResource[],
  chooseResource: (
    resources: CatalogResource[],
    request: InstallationRequest,
  ) => Promise<CatalogResource | null> = async (resources, request) =>
    request.resource || resolveCatalogResource(resources, request.id, request.kind),
): Promise<InstallationResult> {
  const messages: InstallationResult["messages"] = [];
  const emit = (level: InstallationMessage["level"], text: string) => {
    const message = { level, text };
    messages.push(message);
    options.onMessage?.(message);
  };
  const output = {
    log: (text: string) => emit("log", text),
    error: (text: string) => emit("error", text),
  };
  const finishSource = (result: SourceOperationResult): InstallationResult => ({
    ...result,
    messages: [...messages, ...result.messages],
  });
  const allResources = catalogEntries(sourceResources);
  if (options.operation === "uninstall") {
    const target = fs.realpathSync(options.target);
    const installed = [
      ...readInstalledSourceSkills(target, sourceResources, { catalog: options.catalog }),
      ...readInstalledSourceResources(target, sourceResources, { catalog: options.catalog }),
    ].filter(({ resource }) => resource.id === options.id && (!options.kind || resource.kind === options.kind));
    if (!installed.length) {
      throw new CatalogError(`No tracked source installation for ${options.kind ? `${options.kind}:` : ""}${options.id}`, "RESOURCE_NOT_FOUND");
    }
    const resource = installed.length === 1
      ? installed[0].resource
      : await chooseResource(installed.map(({ resource: entry }) => entry), options);
    if (!resource) return { status: 0, messages };
    options.onResource?.({ catalog: resource.catalog || "source", kind: resource.kind, id: resource.id, status: "planned", source: true });
    for (const message of uninstallSourceResource(resource, target, options)) output.log(message);
    return { status: 0, messages };
  }
  if (options.operation === "update") {
    const target = fs.realpathSync(options.target);
    const installed = [
      ...readInstalledSourceSkills(target, sourceResources, { catalog: options.catalog }),
      ...readInstalledSourceResources(target, sourceResources, { catalog: options.catalog }),
    ];
    let sourceToUpdate = options.id
      ? installed.filter(({ resource }) => resource.id === options.id && (!options.kind || resource.kind === options.kind))
      : installed;
    if (options.id && sourceToUpdate.length > 1) {
      const chosen = await chooseResource(sourceToUpdate.map(({ resource }) => resource), options);
      if (!chosen) return { status: 0, messages };
      sourceToUpdate = sourceToUpdate.filter(({ resource }) => resource.catalog === chosen.catalog && resource.kind === chosen.kind);
    }
    if (!sourceToUpdate.length) {
      throw new CatalogError(options.id
        ? `No tracked source installation for ${options.kind ? `${options.kind}:` : ""}${options.id}`
        : "No tracked source resources to update.", "RESOURCE_NOT_FOUND");
    }
    if (options.ref) {
      if (sourceToUpdate.some(({ resource }) => !resource.source_repository || !resource.source_path)) {
        throw new CatalogError("--ref supports only GitHub source resources.");
      }
      sourceToUpdate = sourceToUpdate.map((entry) => ({
        ...entry,
        resource: {
          ...entry.resource,
          source_ref: resolveListedSourceRef(entry.resource, options.ref),
        },
      }));
    }
    const sourceToUpdateResources = sourceToUpdate.map(({ resource }) => resource);
    validateSourceUpdates(sourceToUpdate, { ...options, target });

    for (const resource of sourceToUpdateResources) {
      options.onResource?.({ catalog: resource.catalog || "source", kind: resource.kind, id: resource.id, status: "planned", source: true });
    }
    const updates = options.onProgress
      ? await updateSourceResourcesAsync(sourceToUpdate, target, options)
      : updateSourceResources(sourceToUpdate, target, options);
    updates.forEach((message) => output.log(message));
    return { status: 0, messages };
  }
  if (["preview", "install"].includes(options.operation)) {
    const resource = await chooseResource(allResources, options);
    if (!resource) return { status: 0, messages };
    if (options.operation === "preview") {
      return finishSource(await runSourceOperation({ ...options, action: "preview", resource }));
    }
    if (options.scope === "user" && !USER_INSTALLABLE_KINDS.has(resource.kind)) {
      throw new CatalogError("--scope user supports source skills and agents; instructions are project-only", "INVALID_ARGUMENT");
    }
    if (options.ref) {
      const target = fs.realpathSync(options.target);
      if (!resource.source_repository || !resource.source_path) {
        throw new CatalogError("--ref supports only GitHub source resources.");
      }
      const selectedResource = {
        ...resource,
        source_ref: resolveListedSourceRef(resource, options.ref),
      };
      const projectTarget = options.scope === "user" ? fs.realpathSync(options.projectTarget || process.cwd()) : target;
      const userTarget = fs.realpathSync(options.userTarget || os.homedir());
      const targetRootsOverlap = projectTarget === userTarget;
      const matchingInstalled = [
        ...readInstalledSourceSkills(target, sourceResources, { catalog: options.catalog }),
        ...readInstalledSourceResources(target, sourceResources, { catalog: options.catalog }),
      ].filter(({ resource: current }) =>
        current.catalog === resource.catalog && current.kind === resource.kind && current.id === resource.id &&
        current.source_repository === resource.source_repository && current.source_path === resource.source_path);
      if (targetRootsOverlap && matchingInstalled.length) {
        throw new CatalogError(
          `Cannot safely replace ${resource.catalog}:${resource.kind}:${resource.id}: project and user scopes resolve to the same target (${target}), and the install record does not distinguish them.`,
          "AMBIGUOUS_RESOURCE",
        );
      }
      if (matchingInstalled.length > 1) {
        throw new CatalogError(
          `Multiple tracked installations found for ${resource.catalog}:${resource.kind}:${resource.id} in ${options.scope || "project"} scope.`,
          "AMBIGUOUS_RESOURCE",
        );
      }
      if (matchingInstalled.length === 1) {
        const replacement = {
          ...matchingInstalled[0],
          resource: { ...matchingInstalled[0].resource, ...selectedResource },
        };
        validateSourceUpdates([replacement], { ...options, target });
        const updates = options.onProgress
          ? await updateSourceResourcesAsync([replacement], target, options)
          : updateSourceResources([replacement], target, options);
        updates.forEach((message) => output.log(message));
        return { status: 0, messages };
      }
      return finishSource(await runSourceOperation({
        ...options, action: "install",
        resource: selectedResource,
      }));
    }
    return finishSource(await runSourceOperation({ ...options, action: "install", resource }));
  }
  throw new CatalogError(`Unsupported installation operation: ${options.operation}`);
}
module.exports = { executeInstallationOperation };
