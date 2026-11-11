"use strict";

import type { CatalogResource } from "../catalog/entries.js";
import type { CliReport } from "./report.js";
import type { CliOptions } from "./arguments.js";
import type { ScanError } from "../catalog/lifecycle.js";
export interface DashboardActionFailure {
  code: string;
  category?: string;
  paths?: string[];
  recoverable?: boolean;
  userMessage: string;
  agent?: string;
}
export interface DashboardActionResult {
  code: number;
  messages: string[];
  resources: CatalogResource[];
  errors: ScanError[];
  failure?: DashboardActionFailure;
}

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parseArguments } = require("./arguments.js");
const { catalogEntries, formatDashboardRows } = require("./catalog.js");
const { loadCommandCatalogs } = require("../catalog/loading.js");
const { acquireOperationLock } = require("../catalog/operation.js");
const { readInstallState, trackedPaths } = require("../catalog/inventory/index.js");
const { collectInstalledScopes } = require("../catalog/lifecycle.js");

function createDashboardActionHandler(
  executeCommand: (options: CliOptions, report: CliReport | null) => Promise<number>,
) {
  return async function executeDashboardAction(
    action: string,
    resource: CatalogResource,
    dashboardOptions: CliOptions,
    catalogs: {
      sourceResources: CatalogResource[];
      warnings?: ScanError[];
    },
    installOptions: CliOptions & { force?: boolean } = {},
  ): Promise<DashboardActionResult> {
    const removingUnmanaged = action === "remove-unmanaged";
    if (removingUnmanaged && resource.managed !== false) {
      throw new Error("Only unmanaged dashboard artifacts can be removed this way.");
    }
    const shouldAudit = action === "preview" || action === "install";
    const command = action;
    const scope = command === "install" ? installOptions.scope || "project" : resource.scope;
    const options: CliOptions = removingUnmanaged
      ? {
        target: scope === "user" ? dashboardOptions.userTarget || os.homedir() : dashboardOptions.target,
        scope,
        sourceResources: catalogs.sourceResources,
      }
      : (() => {
        const args = [command, resource.kind, resource.id, "--catalog", resource.catalog];
        if (scope === "user") args.push("--scope", "user");
        else if (command !== "preview") args.push("--target", dashboardOptions.target);
        if (command === "install") args.push("--tool", installOptions.tool || "copilot");
        if (["install", "update"].includes(command) && installOptions.ref) args.push("--ref", installOptions.ref);
        if (shouldAudit) args.push("--audit");
        const parsed = parseArguments(args);
        if (command === "update" && installOptions.ghForce) {
          parsed.ghForce = true;
          parsed.ghForceAgent = installOptions.ghForceAgent;
        }
        parsed.nonInteractive = true;
        parsed.captureOutput = command === "preview";
        parsed.sourceResources = catalogs.sourceResources;
        if (command === "preview") parsed.target = dashboardOptions.target;
        if (scope === "user" && dashboardOptions.userTarget) parsed.target = dashboardOptions.userTarget;
        return parsed;
      })();
    const messages: string[] = [];
    let release: (() => void) | undefined;
    let code: number;
    try {
      if (action !== "preview") release = acquireOperationLock(options.target);
      const targetRoot = fs.realpathSync(options.target);
      const state = readInstallState(targetRoot);
      if (removingUnmanaged) {
        if (scope !== "project" && scope !== "user") {
          throw new Error(`Cannot remove an unmanaged artifact from scope '${scope}'.`);
        }
        const current = collectInstalledScopes(
          { project: dashboardOptions.target, user: dashboardOptions.userTarget || os.homedir() },
          catalogs.sourceResources,
        ).resources.find((entry) =>
          entry.managed === false && entry.scope === scope &&
          entry.kind === resource.kind && entry.id === resource.id);
        if (!current?.paths?.length) {
          throw new Error(`${resource.kind}:${resource.id} is no longer detected as unmanaged; nothing was removed.`);
        }
        const protectedPaths = trackedPaths(state);
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
        code = await executeCommand(options, null);
      }
    } finally {
      release?.();
    }

    const currentCatalogs = loadCommandCatalogs({ command: "list" }, () => {});
    const result = collectInstalledScopes(
      { project: dashboardOptions.target, user: dashboardOptions.userTarget || os.homedir() },
      currentCatalogs.sourceResources,
    );
    result.errors.push(...(catalogs.warnings || []).map((warning) => ({ ...warning, scope: "catalog" })));
    return {
      code,
      messages,
      resources: formatDashboardRows(
        result.resources,
        catalogEntries(currentCatalogs.sourceResources),
      ),
      errors: result.errors,
    };
  };
}

module.exports = { createDashboardActionHandler };
