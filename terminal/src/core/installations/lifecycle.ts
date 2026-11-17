"use strict";

import type { CatalogResource } from "../resources/model.js";
const { CatalogError, USER_INSTALLABLE_KINDS } = require("../resources/model.js");
const { resolveCatalogResource } = require("../resources/selection.js");
const { catalogEntries } = require("../resources/queries.js");
const { readInstalledSourceSkills, readInstalledSourceResources, sourceCatalogName, recordSourceInstallation } = require("../inventory/inventory.js");
const { uninstallSourceResource, validateSourceUpdates, updateSourceResourcesAsync, updateSourceResources, assertSourceResourceCanBeInstalled, installSourceFileResource, catalogLabel } = require("./mutations.js");
const { resolveSourceVersionPrefix, listSourceVersions } = require("../resources/history.js");
import type { AuditResult } from "../inspection/audit.js";
import type { InstallationTool, InstallationScope, PlanAction } from "./model.js";
const { SOURCE_SKILL_DIRECTORIES } = require("./model.js");
const { targetPath } = require("./files.js");
import type { GhSkillResult } from "./gh-skill.js";
const { runGhSkill, buildSourceSkillArgs, runGhSkillAsync, formatGhDiagnostics, describeGhFailure } = require("./gh-skill.js");
const { auditPinnedResource } = require("../inspection/pinned-preview.js");
const { readPinnedSourceFile } = require("../resources/content.js");

const fs = require("node:fs");
const os = require("node:os");
export interface InstallationMessage {
  level: "log" | "error";
  text: string;
}

export interface SourceOperationRequest {
  action: "install" | "preview";
  resource: CatalogResource;
  target: string;
  scope?: InstallationScope;
  tool?: InstallationTool;
  force?: boolean;
  dryRun?: boolean;
  audit?: boolean;
  planOnly?: boolean;
  nonInteractive?: boolean;
  captureOutput?: boolean;
  onAction?: (action: PlanAction) => void;
  onProgress?: (message: string) => void;
  onResource?: (resource: {
    catalog: string;
    kind: CatalogResource["kind"];
    id: string;
    status: "planned";
    source: true;
  }) => void;
  onAudit?: (audit: AuditResult) => void;
  onMessage?: (message: InstallationMessage) => void;
  spawnProcess?: typeof import("node:child_process").spawn;
}

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
      return await runSourceOperation({ ...options, action: "preview", resource });
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
      return await runSourceOperation({
        ...options, action: "install",
        resource: selectedResource,
      });
    }
    return await runSourceOperation({ ...options, action: "install", resource });
  }
  throw new CatalogError(`Unsupported installation operation: ${options.operation}`);
}

// Installation callers hold the target operation lock; this operation never acquires a nested lock.
function runSourceOperation(
  options: SourceOperationRequest,
  invokeGhSkill?: (args: string[], cwd: string) => number | GhSkillResult,
): InstallationResult | Promise<InstallationResult> {
  const injectedInvokeGhSkill = invokeGhSkill;
  invokeGhSkill ||= (args, cwd) => runGhSkill(args, cwd, undefined, {
    nonInteractive: options.nonInteractive,
    captureOutput: options.captureOutput,
  });
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
  const finish = (status: number, preview?: string): InstallationResult => ({
    status,
    messages,
    resource,
    ...(preview === undefined ? {} : { preview }),
  });
  const resource = options.resource;

  options.onResource?.({ catalog: sourceCatalogName(resource), kind: resource.kind, id: resource.id, status: "planned", source: true });

  if (options.action === "install") options.onProgress?.("Validating resource and installation target...");
  let target = process.cwd();
  if (options.action === "install") {
    if (!fs.existsSync(options.target) || !fs.statSync(options.target).isDirectory()) {
      throw new CatalogError(`Target must be an existing directory: ${options.target}`);
    }
    target = fs.realpathSync(options.target);
    assertSourceResourceCanBeInstalled(resource, target);
  }
  if (options.action === "install") {
    if (resource.license_status.toLocaleLowerCase() === "proprietary") {
      output.error(`Warning: ${resource.id} is marked Proprietary; confirm you are authorized before installing.`);
    } else if (resource.license_status === "not-declared") {
      output.error(`Warning: ${resource.id} has no declared license; verify usage rights before installing.`);
    }
  }
  if (options.audit) {
    const audit = auditPinnedResource(resource);
    options.onAudit?.(audit);
    if (options.action === "install" && (!audit.coverage.complete || audit.findings.length)) {
      throw new CatalogError(
        audit.findings.length
          ? `Audit found ${audit.findings.length} finding(s); installation blocked. Inspect the reported files and lines before installing.`
          : "Audit coverage is incomplete; installation blocked because not all resource text was analyzed.",
        "AUDIT_BLOCKED",
      );
    }
  }
  if (resource.kind !== "skill") {
    if (options.action === "preview") {
      const content = readPinnedSourceFile(resource);
      let markdown;
      try {
        markdown = new TextDecoder("utf-8", { fatal: true }).decode(content);
      } catch {
        throw new CatalogError(`Source ${resource.kind} is not valid UTF-8: ${resource.source_path}`);
      }
      return finish(0, markdown);
    }
    if (options.action !== "install") throw new CatalogError(`Unsupported source resource action: ${options.action}`);
    const paths = installSourceFileResource(resource, target, options.tool || "claude", {
      scope: options.scope || "project",
      force: Boolean(options.force),
      dryRun: Boolean(options.dryRun),
      onAction: options.onAction,
      onProgress: options.onProgress,
    });
    output.log(`${options.dryRun ? "Would install" : "Installed"} ${catalogLabel(resource)} ${resource.kind}: ${resource.id}${options.dryRun ? ` at ${resource.source_ref}` : ""} (${paths.join(", ")})`);
    return finish(0);
  }
  const agents = options.tool === "both"
    ? ["github-copilot", "claude-code"]
    : [options.tool === "claude" ? "claude-code" : "github-copilot"];
  if (options.action === "install" && options.scope === "user") {
    for (const agent of agents) targetPath(target, `${SOURCE_SKILL_DIRECTORIES[agent]}/${resource.id}/SKILL.md`);
  }

  if (options.planOnly && options.dryRun) {
    for (const agent of agents) {
      options.onAction?.({
        action: "delegate_install", path: `${SOURCE_SKILL_DIRECTORIES[agent]}/${resource.id}/SKILL.md`,
        resource: { catalog: sourceCatalogName(resource), kind: "skill", id: resource.id },
        command: { program: "gh", args: buildSourceSkillArgs("install", resource, agent, options) },
      });
    }
    output.error("Source skill installation is delegated to gh; auxiliary files and conflicts are resolved by gh at execution time.");
    return finish(0);
  }
  if (options.action === "preview" || options.dryRun) {
    if (options.dryRun) output.error(`Dry run: previewing the ${catalogLabel(resource)} skill; no files will be installed.`);
    const result = invokeGhSkill(buildSourceSkillArgs("preview", resource), target);
    if (typeof result !== "number" && options.captureOutput) {
      if (result.stdout) output.log(String(result.stdout));
      if (result.stderr) output.error(String(result.stderr));
    }
    return finish(typeof result === "number" ? result : result.status);
  }

  if (options.onProgress) {
    return (async () => {
      const completed = [];
      for (const agent of agents) {
        const args = buildSourceSkillArgs("install", resource, agent, options);
        const result = injectedInvokeGhSkill
          ? await injectedInvokeGhSkill(args, target)
          : await runGhSkillAsync(
            args,
            target,
            { nonInteractive: options.nonInteractive, onProgress: options.onProgress, spawnProcess: options.spawnProcess },
          );
        const status = typeof result === "number" ? result : result.status;
        if (status !== 0) {
          const diagnostic = typeof result === "number" ? "" : formatGhDiagnostics(result);
          const cause = describeGhFailure(diagnostic);
          const userMessage = `Could not install ${catalogLabel(resource)} skill ${resource.id} for ${agent}: gh exited with status ${status}. ${cause}`;
          throw new CatalogError(
            `${userMessage}${diagnostic ? ` gh diagnostic: ${diagnostic}` : ""}`,
            "GH_INSTALL_FAILED",
            { category: "github-cli", userMessage, technicalDetail: diagnostic || undefined },
          );
        }
        recordSourceInstallation(resource, target, agent);
        completed.push(agent);
      }
      options.onProgress?.(`Installed ${catalogLabel(resource)} skill ${resource.id} for ${completed.join(", ")}.`);
      return finish(0);
    })();
  }
  const completed = [];
  for (const agent of agents) {
    const result = invokeGhSkill(buildSourceSkillArgs("install", resource, agent, options), target);
    const status = typeof result === "number" ? result : result.status;
    if (status !== 0) {
      if (completed.length) output.error(`The skill was already installed for ${completed.join(", ")}, but installation for ${agent} failed.`);
      return finish(status);
    }
    recordSourceInstallation(resource, target, agent);
    completed.push(agent);
  }
  return finish(0);
}

function resolveListedSourceRef(resource, ref) {
  if (!resource.source_repository || !resource.source_path) {
    throw new CatalogError("--ref supports only GitHub source resources.");
  }
  if (ref.length === 40) return ref;
  try {
    return resolveSourceVersionPrefix(
      listSourceVersions(resource),
      ref,
    );
  } catch (error) {
    if (error.code === "RESOURCE_NOT_FOUND" || error.code === "AMBIGUOUS_RESOURCE") {
      throw new CatalogError(
        `${error.message.replace(/ in source history\.$/, ` for ${resource.catalog}:${resource.kind}:${resource.id}.`)}`,
        error.code,
      );
    }
    throw error;
  }
}

module.exports = { executeInstallationOperation, runSourceOperation };
