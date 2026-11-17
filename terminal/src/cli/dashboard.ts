"use strict";

import type { CatalogResource } from "../catalog/entries.js";
import type { CliReport } from "./report.js";
import type { CliOptions } from "./arguments.js";
import type { ScanError } from "../catalog/lifecycle.js";
import type { DashboardActionResult } from "../core/action-result.js";

const fs = require("node:fs");
const os = require("node:os");
const { parseArguments } = require("./arguments.js");
const { catalogEntries, formatDashboardRows } = require("./catalog.js");
const { loadCommandCatalogs } = require("../catalog/loading.js");
const { acquireOperationLock } = require("../catalog/operation.js");
const { readInstallState } = require("../catalog/inventory/index.js");
const { collectInstalledScopes } = require("../catalog/lifecycle.js");
const { localPreviewFiles } = require("../core/local-preview.js");
const { removeUnmanagedResource } = require("../core/unmanaged-resources.js");


function createDashboardActionHandler(
  executeCommand: (options: CliOptions, report: CliReport | null) => Promise<number>,
  onProgress: (message: string) => void = () => {},
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
      : action === "preview" && resource.scope
        ? {
          target: scope === "user" ? dashboardOptions.userTarget || os.homedir() : dashboardOptions.target,
          scope,
          sourceResources: catalogs.sourceResources,
          nonInteractive: true,
          captureOutput: true,
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
    let previewFiles: Array<{ path: string; content: string }> | undefined;
    let previewTree: string[] | undefined;
    let previewAuditLines: string[] | undefined;
    let release: (() => void) | undefined;
    let code: number;
    try {
      if (action !== "preview") release = acquireOperationLock(options.target);
      const targetRoot = fs.realpathSync(options.target);
      const state = readInstallState(targetRoot);
      if (removingUnmanaged) {
        messages.push(...removeUnmanagedResource(
          targetRoot,
          state,
          resource,
          { project: dashboardOptions.target, user: dashboardOptions.userTarget || os.homedir() },
          catalogs.sourceResources,
        ));
        code = 0;
      } else if (action === "preview" && resource.scope) {
        const local = localPreviewFiles(targetRoot, state, resource);
        previewFiles = local.files;
        previewTree = local.tree;
        previewAuditLines = local.auditLines;
        code = 0;
      } else {
        options.output = {
          log: (message: string) => {
            if (!message.startsWith("User scope: ")) messages.push(message);
          },
          error: (message: string) => messages.push(message),
        };
        options.onProgress = onProgress;
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
      ...(previewFiles ? { previewFiles, previewTree, previewAuditLines } : {}),
      resources: formatDashboardRows(
        result.resources,
        catalogEntries(currentCatalogs.sourceResources),
      ),
      errors: result.errors,
  };
  };
}

module.exports = { createDashboardActionHandler };
