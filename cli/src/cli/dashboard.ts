"use strict";

import type { CatalogResource } from "../catalog/entries.js";
import type { CliReport } from "./report.js";
import type { CliOptions } from "./arguments.js";
import type { ScanError } from "../catalog/lifecycle.js";
import type { InstallState } from "../catalog/inventory/files.js";
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
  previewFiles?: Array<{ path: string; content: string }>;
  previewTree?: string[];
  previewAuditLines?: string[];
}

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parseArguments } = require("./arguments.js");
const { catalogEntries, formatDashboardRows } = require("./catalog.js");
const { loadCommandCatalogs } = require("../catalog/loading.js");
const { acquireOperationLock } = require("../catalog/operation.js");
const { readInstallState, targetPath, trackedPaths } = require("../catalog/inventory/index.js");
const { collectInstalledScopes } = require("../catalog/lifecycle.js");
const { auditTextResources } = require("../catalog/audit.js");
function localPreviewFiles(targetRoot: string, state: InstallState, resource: CatalogResource) {
  const record = resource.managed === false
    ? undefined
    : state.sources?.[resource.catalog || "source"]?.[`${resource.kind}s`]?.[resource.id];
  if (resource.managed !== false && (
    !record || record.source_repository !== resource.source_repository ||
    record.source_path !== resource.source_path
  )) {
    throw new Error(`No matching installed source record exists for ${resource.kind}:${resource.id}.`);
  }
  const tracked = record ? Object.keys(record.files || {}) : [];
  const suppliedPaths = resource.managed === false ? resource.paths : tracked;
  if (!Array.isArray(suppliedPaths) || !suppliedPaths.length) {
    throw new Error(`No local installation paths are available for ${resource.kind}:${resource.id}.`);
  }
  const regularFilePath = (relativePath: string) => {
    const absolutePath = targetPath(targetRoot, relativePath);
    const segments = relativePath.split("/");
    let current = targetRoot;
    for (const [index, segment] of segments.entries()) {
      current = path.join(current, segment);
      let stat;
      try {
        stat = fs.lstatSync(current);
      } catch (error) {
        if (error.code === "ENOENT") throw new Error(`Local preview file is missing: ${relativePath}.`);
        throw error;
      }
      if (stat.isSymbolicLink()) throw new Error(`Refusing symbolic link in local preview path: ${relativePath}.`);
      if (index < segments.length - 1 && !stat.isDirectory()) {
        throw new Error(`Local preview path is blocked by a non-directory: ${relativePath}.`);
      }
      if (index === segments.length - 1 && !stat.isFile()) {
        throw new Error(`Local preview path is not a regular file: ${relativePath}.`);
      }
    }
    return absolutePath;
  };
  const readLocalFile = (relativePath: string) => {
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(regularFilePath(relativePath));
    } catch (error) {
      if (["EACCES", "EPERM", "EIO"].includes(error.code)) {
        return {
          path: relativePath,
          content: `[Unreadable file: ${error.code}.]`,
          auditSkipReason: `could not be read (${error.code})`,
        };
      }
      throw error;
    }
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return {
        path: relativePath,
        content: "[Non-text/unsupported file: binary or unsupported bytes are not displayed.]",
        auditBytes: bytes,
      };
    }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(content)) {
      return {
        path: relativePath,
        content: "[Unsupported text: terminal control characters are not displayed.]",
        auditSkipReason: "contains terminal control characters",
      };
    }
    return { path: relativePath, content, auditBytes: bytes };
  };
  const ensureDirectory = (relativePath: string) => {
    targetPath(targetRoot, relativePath);
    let current = targetRoot;
    for (const segment of relativePath.split("/")) {
      current = path.join(current, segment);
      let stat;
      try {
        stat = fs.lstatSync(current);
      } catch (error) {
        if (error.code === "ENOENT") throw new Error(`Local preview directory is missing: ${relativePath}.`);
        throw error;
      }
      if (stat.isSymbolicLink()) throw new Error(`Refusing symbolic link in local preview path: ${relativePath}.`);
      if (!stat.isDirectory()) throw new Error(`Local preview path is not a directory: ${relativePath}.`);
    }
    return current;
  };
  const walkSkill = (relativeDirectory: string, files: string[]) => {
    const absoluteDirectory = ensureDirectory(relativeDirectory);
    for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
      const childPath = path.posix.join(relativeDirectory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Refusing symbolic link in local skill preview: ${childPath}.`);
      if (entry.isDirectory()) walkSkill(childPath, files);
      else if (entry.isFile()) files.push(childPath);
      else throw new Error(`Local skill preview path is not a regular file: ${childPath}.`);
    }
  };
  let paths: string[];
  if (resource.kind === "skill") {
    const entrypoints = resource.managed === false
      ? suppliedPaths.filter((relativePath: string) => /\/SKILL\.md$/i.test(relativePath))
      : tracked.filter((relativePath: string) => /\/SKILL\.md$/i.test(relativePath));
    if (!entrypoints.length) {
      throw new Error(`No installed SKILL.md entrypoint is recorded for ${resource.kind}:${resource.id}.`);
    }
    for (const relativePath of tracked) regularFilePath(relativePath);
    const files: string[] = [];
    for (const entrypoint of entrypoints) walkSkill(path.posix.dirname(entrypoint), files);
    paths = [...new Set(files)].sort();
  } else {
    paths = [...new Set(suppliedPaths)].sort();
  }
  if (!paths.length) throw new Error(`No readable local files were found for ${resource.kind}:${resource.id}.`);
  const files = paths.map(readLocalFile);
  const auditFiles: Array<{ path: string; kind: CatalogResource["kind"]; content: Buffer }> = [];
  const additionalSkipped: Array<{ path: string; reason: string }> = [];
  for (const [index, file] of files.entries()) {
    if (index >= 500) {
      additionalSkipped.push({ path: file.path, reason: "exceeds the 500 file audit limit" });
    } else if (file.auditSkipReason) {
      additionalSkipped.push({ path: file.path, reason: file.auditSkipReason });
    } else if (file.auditBytes) {
      auditFiles.push({ path: file.path, kind: resource.kind, content: file.auditBytes });
    }
  }
  const auditResult = auditTextResources(auditFiles);
  const skipped = [...auditResult.coverage.skipped, ...additionalSkipped];
  const auditLines = [
    `Audit coverage: ${auditResult.coverage.analyzed}/${files.length} files analyzed; ` +
      (skipped.length ? "coverage incomplete." : "no files skipped."),
    ...skipped.map((item) => `  Skipped ${item.path}: ${item.reason}.`),
    ...auditResult.findings.map((finding) =>
      `  ${finding.severity.toUpperCase()} ${finding.path}:${finding.line} [${finding.code}] ${finding.message}`),
    ...(auditResult.coverage.analyzed > 0 && !auditResult.findings.length
      ? ["  No configured audit rules matched. This is not a safety guarantee."]
      : []),
    ...(!auditResult.coverage.analyzed
      ? ["  No text files were analyzed; coverage is incomplete."]
      : []),
  ];
  const tree = [
    "local installations/",
    ...files.map(({ path: relativePath }, index) =>
      `${index === files.length - 1 ? "└──" : "├──"} ${relativePath}`),
  ];
  return {
    files: files.map(({ path: relativePath, content }) => ({ path: relativePath, content })),
    tree,
    auditLines,
  };
}


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
