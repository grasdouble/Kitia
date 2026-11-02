"use strict";

import type { CatalogResource, CliOptions, JsonRecord, ScanError } from "../types.js";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parseArguments } = require("./arguments.js");
const { catalogEntries, formatDashboardRows } = require("./catalog.js");
const { loadCommandCatalogs } = require("../catalog/loading.js");
const { acquireOperationLock } = require("../catalog/operation.js");
const {
  findInstalledProvenance, readInstallState, trackedPaths,
} = require("../catalog/inventory/index.js");
const { collectInstalledScopes } = require("../catalog/lifecycle.js");
const { readBuildInfo } = require("../catalog/resources/files.js");

function requiredMcpEnvironment(resource: CatalogResource, resources: CatalogResource[]): string[] {
  const mcpIds = resource.kind === "mcp"
    ? [resource.id]
    : resource.kind === "bundle"
      ? (resource.resources || [])
        .filter((member) => member.kind === "mcp")
        .map((member) => member.id)
      : [];
  return [...new Set(mcpIds.flatMap((id) => {
    const mcp = resources.find((entry) => entry.kind === "mcp" && entry.id === id);
    return Object.values(mcp?.inputs || {})
      .filter((input) => input.secret && input.required)
      .map((input) => input.target_env);
  }))];
}

function createDashboardActionHandler(
  executeCommand: (options: CliOptions, catalogRoot: string, report: JsonRecord | null) => Promise<number>,
) {
  return async function executeDashboardAction(
    action: string,
    resource: CatalogResource,
    dashboardOptions: CliOptions,
    catalogRoot: string,
    catalogs: {
      resources: CatalogResource[];
      sourceResources: CatalogResource[];
      allResources: CatalogResource[];
      warnings?: ScanError[];
    },
    installOptions: CliOptions = {},
  ): Promise<JsonRecord> {
    const removingUnmanaged = action === "remove-unmanaged";
    if (removingUnmanaged && resource.managed !== false) {
      throw new Error("Only unmanaged dashboard artifacts can be removed this way.");
    }
    const scope = action === "install" ? installOptions.scope || "project" : resource.scope;
    const options: CliOptions = removingUnmanaged
      ? {
        target: scope === "user" ? dashboardOptions.userTarget || os.homedir() : dashboardOptions.target,
        scope,
        offline: dashboardOptions.offline,
        sourceResources: catalogs.sourceResources,
      }
      : (() => {
        const args = [action, resource.kind, resource.id, "--catalog", resource.catalog];
        if (scope === "user") args.push("--scope", "user");
        else args.push("--target", dashboardOptions.target);
        if (action === "install") args.push("--tool", installOptions.tool || "copilot");
        const parsed = parseArguments(args);
        if (["bundle", "mcp"].includes(resource.kind)) parsed.yes = true;
        parsed.nonInteractive = true;
        parsed.offline = dashboardOptions.offline;
        parsed.sourceResources = catalogs.sourceResources;
        if (scope === "user" && dashboardOptions.userTarget) parsed.target = dashboardOptions.userTarget;
        return parsed;
      })();
    const messages: string[] = [];
    let release: (() => void) | undefined;
    let code: number;
    try {
      release = acquireOperationLock(options.target);
      const targetRoot = fs.realpathSync(options.target);
      const state = readInstallState(targetRoot);
      if (removingUnmanaged) {
        if (scope !== "project" && scope !== "user") {
          throw new Error(`Cannot remove an unmanaged artifact from scope '${scope}'.`);
        }
        const current = collectInstalledScopes(
          { project: dashboardOptions.target, user: dashboardOptions.userTarget || os.homedir() },
          catalogs.resources,
          catalogRoot,
          readBuildInfo(catalogRoot),
          catalogs.sourceResources,
        ).resources.find((entry) =>
          entry.managed === false && entry.scope === scope &&
          entry.kind === resource.kind && entry.id === resource.id);
        if (!current?.paths?.length) {
          throw new Error(`${resource.kind}:${resource.id} is no longer detected as unmanaged; nothing was removed.`);
        }
        const sourceCollections = Object.values(state.sources || {}) as Array<
          Record<string, Record<string, { files?: Record<string, unknown> }>>
        >;
        const sourceTrackedPaths = sourceCollections.flatMap((collections) =>
          Object.values(collections).flatMap((records) =>
            Object.values(records).flatMap((record) => Object.keys(record.files || {}))));
        const protectedPaths = new Set([...trackedPaths(state), ...sourceTrackedPaths]);
        const legacy = findInstalledProvenance(targetRoot, protectedPaths, undefined, { scope });
        for (const entries of legacy.values()) {
          for (const { path: relativePath } of entries) protectedPaths.add(relativePath);
        }
        const assertSafePath = (absolutePath, directory) => {
          let ancestor = absolutePath;
          while (ancestor !== targetRoot) {
            const stat = fs.lstatSync(ancestor);
            if (stat.isSymbolicLink()) throw new Error(`Refusing to remove a path through a symbolic link: ${ancestor}`);
            ancestor = path.dirname(ancestor);
          }
          const stat = fs.lstatSync(absolutePath);
          if (directory ? !stat.isDirectory() : !stat.isFile()) {
            throw new Error(`Refusing to remove an unexpected artifact path: ${absolutePath}`);
          }
        };
        const targets: Array<{ absolutePath: string; relativePath: string }> =
          current.paths.map((relativePath) => {
          if (relativePath.startsWith("/") || relativePath.includes("\\") ||
              relativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
            throw new Error(`Refusing to remove an unsafe artifact path: ${relativePath}`);
          }
          const entryPath = path.resolve(targetRoot, ...relativePath.split("/"));
          const relative = path.relative(targetRoot, entryPath);
          if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
            throw new Error(`Refusing to remove an unsafe artifact path: ${relativePath}`);
          }
          if (resource.kind !== "skill") {
            assertSafePath(entryPath, false);
            return { absolutePath: entryPath, relativePath };
          }
          if (!/\/SKILL\.md$/i.test(relativePath)) {
            throw new Error(`Refusing to remove an unexpected skill entry file: ${relativePath}`);
          }
          const skillDirectory = path.posix.dirname(relativePath);
          if (![".agents/skills/", ".claude/skills/"]
            .some((prefix) => skillDirectory.startsWith(prefix))) {
            throw new Error(`Refusing to remove a skill outside a supported skills directory: ${relativePath}`);
          }
          if ([...protectedPaths].some((trackedPath) =>
            trackedPath === skillDirectory || trackedPath.startsWith(`${skillDirectory}/`))) {
            throw new Error(`Refusing to remove ${skillDirectory}; it contains files managed by Kitia.`);
          }
          const directoryPath = path.resolve(targetRoot, ...skillDirectory.split("/"));
          assertSafePath(entryPath, false);
          assertSafePath(directoryPath, true);
          return { absolutePath: directoryPath, relativePath: skillDirectory };
        });
        const uniqueTargets = [...new Map(targets.map((target) =>
          [target.absolutePath, target])).values()];
        for (const { absolutePath, relativePath } of uniqueTargets) {
          if (resource.kind === "skill") fs.rmSync(absolutePath, { recursive: true });
          else fs.unlinkSync(absolutePath);
          messages.push(`Removed unmanaged ${resource.kind}:${resource.id} (${relativePath}).`);
        }
        code = 0;
      } else {
        options.output = {
          log: (message: string) => {
            if (!message.startsWith("User scope: ")) messages.push(message);
          },
          error: (message: string) => messages.push(message),
        };
        code = await executeCommand(options, catalogRoot, null);
      }
    } finally {
      release?.();
    }

    const currentCatalogs = loadCommandCatalogs({ command: "list" }, catalogRoot, () => {});
    const result = collectInstalledScopes(
      { project: dashboardOptions.target, user: dashboardOptions.userTarget || os.homedir() },
      currentCatalogs.resources,
      catalogRoot,
      readBuildInfo(catalogRoot),
      currentCatalogs.sourceResources,
    );
    result.errors.push(...(catalogs.warnings || []).map((warning) => ({ ...warning, scope: "catalog" })));
    const postInstallEnvironment = ["install", "update"].includes(action) && code === 0
      ? requiredMcpEnvironment(resource, currentCatalogs.resources)
      : [];
    return {
      code,
      messages,
      resources: formatDashboardRows(
        result.resources,
        catalogEntries(currentCatalogs.resources, currentCatalogs.sourceResources),
      ),
      errors: result.errors,
      postInstallEnvironment,
    };
  };
}

module.exports = { createDashboardActionHandler };
