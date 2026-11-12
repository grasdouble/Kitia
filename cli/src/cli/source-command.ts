"use strict";

const fs = require("node:fs");
const { CatalogError, SOURCE_SKILL_DIRECTORIES } = require("../catalog/resources/index.js");
const { targetPath } = require("../catalog/inventory/index.js");
const { loadSourceCatalogsFromDirectory } = require("../catalog/sources/loader.js");
const { loadUserSourceConfiguration, userCatalogIndexDirectory } = require("../catalog/sources/config.js");
const { sourceCatalogName, recordSourceInstallation } = require("../catalog/sources/installed.js");
const {
  assertSourceResourceCanBeInstalled, readPinnedSourceFile, installSourceFileResource,
  catalogLabel,
} = require("../catalog/sources/resources.js");
const { buildSourceSkillArgs, runGhSkill, runGhSkillAsync, formatGhDiagnostics, describeGhFailure } = require("../catalog/sources/gh-skill.js");
import type { CatalogResource } from "../catalog/entries.js";
import type { CliOptions } from "./arguments.js";
import type { GhSkillResult } from "../catalog/sources/gh-skill.js";
const { auditTextResources } = require("../catalog/audit.js");
function formatSourceResource(resource: CatalogResource): string {
  return [
    `id: ${resource.id}`,
    `description: ${resource.description}`,
    `catalog: ${sourceCatalogName(resource)}`,
    `source: ${resource.source_repository}/${resource.source_path}@${resource.source_ref}`,
    `license: ${resource.license_status}`,
    `upstream: https://github.com/${resource.source_repository}/tree/${resource.source_ref}/${resource.source_path}`,
  ].join("\n");
}
function auditPinnedResource(
  resource: CatalogResource,
  output: { log(message: string): void },
): {
  findings: Array<{ code: string; path: string; line: number; message: string }>;
  coverage: { discovered: number; analyzed: number; skipped: Array<{ path: string; reason: string }>; complete: boolean };
} {
  if (!resource.source_repository || !resource.source_ref) {
    throw new CatalogError("--audit only supports pinned source-catalog resources", "INVALID_ARGUMENT");
  }
  if (!resource.source_path) throw new CatalogError("Source resource has no pinned path to audit", "INVALID_ARGUMENT");
  const filePath = resource.kind === "skill"
    ? `${resource.source_path.replace(/\/$/, "")}/SKILL.md`
    : resource.source_path;
  const files = [{
    path: filePath,
    kind: resource.kind,
    content: readPinnedSourceFile({ ...resource, source_path: filePath }),
  }];
  const result = auditTextResources(files);
  output.log(`Audit coverage: ${result.coverage.analyzed}/${result.coverage.discovered} files analyzed; ` +
    (result.coverage.complete ? "no files skipped." : "coverage incomplete."));
  for (const skipped of result.coverage.skipped) output.log(`  Skipped ${skipped.path}: ${skipped.reason}.`);
  for (const finding of result.findings) {
    output.log(`  ${finding.severity.toUpperCase()} ${finding.path}:${finding.line} [${finding.code}] ${finding.message}`);
  }
  if (!result.findings.length) output.log("  No configured audit rules matched. This is not a safety guarantee.");
  return result;
}


function runSourceCommand(
  options: CliOptions,
  invokeGhSkill?: (args: string[], cwd: string) => number | GhSkillResult,
): number | Promise<number> {
  const injectedInvokeGhSkill = invokeGhSkill;
  invokeGhSkill ||= (args, cwd) => runGhSkill(args, cwd, undefined, {
    nonInteractive: options.nonInteractive,
    captureOutput: options.captureOutput,
  });
  const output = options.output || console;
  const catalog = options.catalog || "source";
  let sourceResources: CatalogResource[] = options.sourceResources || [];
  if (!options.resource && !sourceResources.length) {
    const sources = loadUserSourceConfiguration();
    sourceResources = sources.length
      ? loadSourceCatalogsFromDirectory(userCatalogIndexDirectory(), sources)
      : [];
  }
  const resource = options.resource
    ? { ...options.resource, catalog: options.resource.catalog || catalog }
    : sourceResources.find((entry) => entry.catalog === catalog && entry.id === options.id &&
      (!options.kind || entry.kind === options.kind));
  if (!resource) {
    throw new CatalogError(`${catalog} resource not found: ${options.id}`);
  }

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
    const audit = auditPinnedResource(resource, output);
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
      output.log(`${formatSourceResource(resource)}\n\n${markdown}`);
      return 0;
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
    return 0;
  }
  const agents = options.tool === "both"
    ? ["github-copilot", "claude-code"]
    : [options.tool === "claude" ? "claude-code" : "github-copilot"];
  if (options.action === "install" && options.scope === "user") {
    for (const agent of agents) targetPath(target, `${SOURCE_SKILL_DIRECTORIES[agent]}/${resource.id}/SKILL.md`);
  }

  if (options.json && options.dryRun) {
    for (const agent of agents) {
      options.onAction?.({
        action: "delegate_install", path: `${SOURCE_SKILL_DIRECTORIES[agent]}/${resource.id}/SKILL.md`,
        resource: { catalog: sourceCatalogName(resource), kind: "skill", id: resource.id },
        command: { program: "gh", args: buildSourceSkillArgs("install", resource, agent, options) },
      });
    }
    output.error("Source skill installation is delegated to gh; auxiliary files and conflicts are resolved by gh at execution time.");
    return 0;
  }
  if (options.action === "preview" || options.dryRun) {
    if (options.dryRun) output.error(`Dry run: previewing the ${catalogLabel(resource)} skill; no files will be installed.`);
    const result = invokeGhSkill(buildSourceSkillArgs("preview", resource), target);
    if (typeof result !== "number" && options.captureOutput) {
      if (result.stdout) output.log(String(result.stdout));
      if (result.stderr) output.error(String(result.stderr));
    }
    return typeof result === "number" ? result : result.status;
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
      return 0;
    })();
  }
  const completed = [];
  for (const agent of agents) {
    const result = invokeGhSkill(buildSourceSkillArgs("install", resource, agent, options), target);
    const status = typeof result === "number" ? result : result.status;
    if (status !== 0) {
      if (completed.length) output.error(`The skill was already installed for ${completed.join(", ")}, but installation for ${agent} failed.`);
      return status;
    }
    recordSourceInstallation(resource, target, agent);
    completed.push(agent);
  }
  return 0;
}

module.exports = { formatSourceResource, runSourceCommand };
