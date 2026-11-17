import type { AuditResult } from "../inspection/audit.js";
"use strict";

import type { CatalogResource } from "../resources/model.js";
const { CatalogError } = require("../resources/model.js");
import type { InstallationTool, InventoryScope, PlanAction } from "./model.js";
const { targetPath } = require("./files.js");
import type { GhSkillResult } from "./gh-skill.js";
const { runGhSkill, buildSourceSkillArgs, runGhSkillAsync, formatGhDiagnostics, describeGhFailure } = require("./gh-skill.js");
const { sourceCatalogName, recordSourceInstallation } = require("./inventory.js");
const { assertSourceResourceCanBeInstalled, installSourceFileResource, catalogLabel } = require("./operations.js");
const { auditPinnedResource } = require("../inspection/pinned-preview.js");
const { readPinnedSourceFile } = require("../resources/content.js");
const { SOURCE_SKILL_DIRECTORIES } = require("./model.js");
const fs = require("node:fs");
export interface InstallationMessage {
  level: "log" | "error";
  text: string;
}

export interface SourceOperationRequest {
  action: "install" | "preview";
  resource: CatalogResource;
  target: string;
  scope?: InventoryScope;
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

export interface SourceOperationResult {
  status: number;
  messages: InstallationMessage[];
  preview?: string;
  resource?: CatalogResource;
}

// Installation callers hold the target operation lock; this operation never acquires a nested lock.
function runSourceOperation(
  options: SourceOperationRequest,
  invokeGhSkill?: (args: string[], cwd: string) => number | GhSkillResult,
): SourceOperationResult | Promise<SourceOperationResult> {
  const injectedInvokeGhSkill = invokeGhSkill;
  invokeGhSkill ||= (args, cwd) => runGhSkill(args, cwd, undefined, {
    nonInteractive: options.nonInteractive,
    captureOutput: options.captureOutput,
  });
  const messages: SourceOperationResult["messages"] = [];
  const emit = (level: InstallationMessage["level"], text: string) => {
    const message = { level, text };
    messages.push(message);
    options.onMessage?.(message);
  };
  const output = {
    log: (text: string) => emit("log", text),
    error: (text: string) => emit("error", text),
  };
  const finish = (status: number, preview?: string): SourceOperationResult => ({
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

module.exports = { runSourceOperation };
