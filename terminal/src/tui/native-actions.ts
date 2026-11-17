"use strict";

import type { CatalogResource } from "../core/resources/model.js";
import type { InstallationRequest } from "../core/installations/actions.js";
import type { ScanError } from "../core/installations/checks.js";
const { collectInstalledScopes } = require("../core/installations/checks.js");
import type { DashboardActionResult } from "./action-result.js";
const { acquireOperationLock } = require("../core/installations/lock.js");
const { readInstallState } = require("../core/installations/state.js");
const { removeUnmanagedResource } = require("../core/installations/unmanaged.js");
const { localPreviewFiles } = require("../core/inspection/local-preview.js");
const { formatAuditLines } = require("../cli/inspection-format.js");
const { executeInstallationOperation } = require("../core/installations/actions.js");
const { loadCatalogs } = require("../core/catalogs/loading.js");
const { enrichInstalledResources, catalogEntries } = require("../core/resources/queries.js");
const { formatSourceResource } = require("../cli/resource-format.js");
// Native dashboard adapter: translate structured domain facts into the dashboard refresh envelope.
const fs = require("node:fs");
const os = require("node:os");
export interface NativeDashboardOptions {
  target: string;
  userTarget?: string;
}

type NativeInstallOptions = Pick<InstallationRequest, "scope" | "tool" | "force" | "ref" | "ghForce" | "ghForceAgent">;

function createDashboardActionHandler(onProgress: (message: string) => void = () => {}) {
  return async function executeDashboardAction(
    action: InstallationRequest["operation"] | "remove-unmanaged",
    resource: CatalogResource,
    dashboardOptions: NativeDashboardOptions,
    catalogs: { sourceResources: CatalogResource[]; warnings?: ScanError[] },
    installOptions: NativeInstallOptions = {},
  ): Promise<DashboardActionResult> {
    const scope = action === "install" ? installOptions.scope || "project" : resource.scope;
    const target = scope === "user" ? dashboardOptions.userTarget || os.homedir() : dashboardOptions.target;
    const messages: string[] = [];
    let previewFiles: DashboardActionResult["previewFiles"];
    let previewTree: string[] | undefined;
    let previewAuditLines: string[] | undefined;
    let release: (() => void) | undefined;
    let code = 0;
    try {
      if (action !== "preview") release = acquireOperationLock(target);
      const targetRoot = fs.realpathSync(target);
      const state = readInstallState(targetRoot);
      if (action === "remove-unmanaged") {
        if (resource.managed !== false) {
          throw new Error("Only unmanaged dashboard artifacts can be removed this way.");
        }
        messages.push(...removeUnmanagedResource(targetRoot, state, resource));
      } else if (action === "preview" && resource.scope) {
        const local = localPreviewFiles(targetRoot, state, resource);
        previewFiles = local.files;
        previewTree = [
          "local installations/",
          ...local.treeEntries.map((entry, index) =>
            `${index === local.treeEntries.length - 1 ? "└──" : "├──"} ${entry.path}`),
        ];
        previewAuditLines = formatAuditLines(local.audit);
      } else {
        const result = await executeInstallationOperation({
          operation: action,
          resource,
          id: resource.id,
          kind: resource.kind,
          catalog: resource.catalog,
          target,
          scope,
          tool: installOptions.tool || "copilot",
          ref: installOptions.ref,
          force: installOptions.force,
          ghForce: installOptions.ghForce,
          ghForceAgent: installOptions.ghForceAgent,
          audit: action === "install" || action === "preview",
          nonInteractive: true,
          captureOutput: action === "preview",
          projectTarget: dashboardOptions.target,
          userTarget: dashboardOptions.userTarget || os.homedir(),
          onProgress,
          onMessage: ({ text }) => messages.push(text),
          onAudit: (audit) => messages.push(...formatAuditLines(audit)),
        }, catalogs.sourceResources);
        code = result.status;
        if (result.preview !== undefined) messages.push(`${formatSourceResource(result.resource)}\n\n${result.preview}`);
      }
    } finally {
      release?.();
    }
    const currentCatalogs = loadCatalogs({ allowUnavailable: true });
    const result = collectInstalledScopes(
      { project: dashboardOptions.target, user: dashboardOptions.userTarget || os.homedir() },
      currentCatalogs.sourceResources,
    );
    result.errors.push(...(catalogs.warnings || []).map((warning) => ({ ...warning, scope: "catalog" })));
    return {
      code,
      messages,
      ...(previewFiles ? { previewFiles, previewTree, previewAuditLines } : {}),
      resources: enrichInstalledResources(
        result.resources,
        catalogEntries(currentCatalogs.sourceResources),
      ),
      errors: result.errors,
    };
  };
}
module.exports = { createDashboardActionHandler };
