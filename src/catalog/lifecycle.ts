"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  CatalogError, INSTALLABLE_KINDS, USER_INSTALLABLE_KINDS, LOCK_PATH,
  assertInstallableResource, addPlanEntry,
} = require("./resources/index.js");
const { resourceDigest } = require("./resources/files.js");
const { buildInstallPlan } = require("./resources/install-plan.js");
const {
  readInstallState, findInstalledProvenance, findUnmanagedArtifacts, trackedPaths, inspectInstalledFiles,
  installedFingerprint, fileFingerprint, sameFingerprint, writeInstallPlan, isUserResource,
  addInventoryStateToPlan,
} = require("./inventory/index.js");
const {
  readInstalledSourceSkills, readInstalledSourceResources,
} = require("./sources/skills.js");
const { checkBundles, checkMcps } = require("./bundles/check.js");
const { isUserMcp } = require("./bundles/utils.js");
import type { CatalogName, CatalogResource, ResourceKind } from "./entries.js";
import type { BuildInfo } from "./resources/files.js";
import type { InstallPlanEntry } from "./plan.js";
import type { BundleInventoryRecord, InstallState, InstallationTool, McpInventoryRecord } from "./inventory/files.js";
import type { CliOptions } from "../cli/arguments.js";

export interface ScanError {
  scope: string;
  code: string;
  message: string;
}

function checkInstalledResources(
  target: string,
  resources: CatalogResource[],
  catalogRoot: string,
  buildInfo: BuildInfo,
  sourceResources: CatalogResource[] = [],
  { catalog, scope, includeUnmanaged = false }: {
    catalog?: string; scope?: string; includeUnmanaged?: boolean;
  } = {},
) {
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new CatalogError(`Target must be an existing directory: ${target}`);
  }
  const targetRoot = fs.realpathSync(target);
  const state: InstallState = readInstallState(targetRoot);
  if (catalog) state.resources = {};
  const registeredPaths = trackedPaths(state);
  if (scope === "user") {
    state.resources = Object.fromEntries(Object.entries(state.resources)
      .filter(([key, record]) => isUserResource(key, record)));
    if (state.bundles) state.bundles = Object.fromEntries(Object.entries(state.bundles)
      .filter(([, bundle]) => bundle.scope === "user"));
  }
  const legacy = catalog ? new Map()
    : findInstalledProvenance(targetRoot, registeredPaths, undefined, { scope });
  const installedSourceResources = [
    ...readInstalledSourceSkills(targetRoot, sourceResources, { catalog }),
    ...readInstalledSourceResources(targetRoot, sourceResources, { catalog }),
  ];
  const currentResources = new Map<string, CatalogResource>(
    resources.filter((resource) => INSTALLABLE_KINDS.has(resource.kind))
      .map((resource) => [`${resource.kind}:${resource.id}`, resource]),
  );
  const messages = [];
  const results = new Map<string, CatalogResource>();
  const resultFor = (catalog: CatalogName, kind: ResourceKind, id: string): CatalogResource => {
    const key = `${catalog}:${kind}:${id}`;
    if (!results.has(key)) results.set(key, { catalog, kind, id, status: "current", issues: [] });
    return results.get(key);
  };
  const issue = (result: CatalogResource, code: string, paths: string[] = []) => {
    result.status = "attention";
    result.issues.push({ code, paths });
  };
  let updateAvailable = false;
  if (buildInfo.dirty && resources.length) {
    messages.push("Warning: current catalog source has uncommitted changes.");
  }
  if (!Object.keys(state.resources).length && (catalog ||
      !Object.keys(state.bundles || {}).length && !mcpsPresent(state, scope)) &&
      !legacy.size && !installedSourceResources.length) {
    messages.push("No catalog-managed resources found in target.");
  }

  for (const [key, entries] of legacy) {
    const record = state.resources[key];
    const untracked = entries.filter((entry) => !record || !Object.hasOwn(record.files, entry.path));
    if (untracked.length) {
      const [kind, id] = key.split(":");
      issue(resultFor("internal", kind as ResourceKind, id), "LEGACY_INSTALLATION", untracked.map((entry) => entry.path));
      messages.push(`Legacy installation: ${key} (${untracked.map((entry) => entry.path).join(", ")}). Review and reinstall with --force to migrate; integrity is not tracked.`);
      updateAvailable = true;
    }
  }
  for (const [key, record] of Object.entries(state.resources).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const [kind, id] = key.split(":");
    const result = resultFor("internal", kind as ResourceKind, id);
    result.version = record.commit.slice(0, 7);
    const { missing, modified } = inspectInstalledFiles(targetRoot, record);
    if (missing.length) {
      issue(result, "MISSING_FILES", missing);
      messages.push(`Missing installed files: ${key} (${missing.join(", ")})`);
      updateAvailable = true;
    }
    if (modified.length) {
      issue(result, "LOCAL_MODIFICATIONS", modified);
      messages.push(`Locally modified: ${key} (${modified.join(", ")})`);
      updateAvailable = true;
    }
    const resource = currentResources.get(key);
    if (!resource) {
      issue(result, "REMOVED_FROM_CATALOG");
      messages.push(`Removed from catalog: ${key}`);
      updateAvailable = true;
      continue;
    }

    const currentDigest = resourceDigest(resource, catalogRoot);
    if (resource.status === "deprecated") {
      issue(result, "DEPRECATED");
      messages.push(`Deprecated: ${key}: ${resource.deprecation_reason}${resource.replacement ? `; replacement: ${resource.replacement}` : ""}`);
      updateAvailable = true;
    }
    const unsupported = (record.tool === "both" ? ["claude", "copilot"] : [record.tool])
      .filter((runtime) => resource.compatibility[runtime].status === "unsupported");
    if (unsupported.length) {
      issue(result, "UNSUPPORTED_RUNTIME");
      result.unsupported_runtimes = unsupported;
      messages.push(`Installed runtime no longer supported: ${key} (${unsupported.join(", ")}). Select a supported --tool or uninstall.`);
      updateAvailable = true;
    }
    if (currentDigest !== record.digest) {
      issue(result, "UPDATE_AVAILABLE");
      messages.push(`Update available: ${key}`);
      updateAvailable = true;
      continue;
    }
    if (missing.length || modified.length || unsupported.length || resource.status === "deprecated") {
      continue;
    }
  }
  for (const { resource, installations, removed, tracked = true } of installedSourceResources) {
    if (!tracked) continue;
    const sourceName = resource.catalog || "source";
    const result = resultFor(sourceName, resource.kind, resource.id);
    result.version = [...new Set(installations.map(({ ref }) => ref?.slice(0, 7)).filter(Boolean))]
      .join(", ") || resource.source_ref?.slice(0, 7) || "-";
    for (const [flag, label] of [["missing", "Missing installed files"], ["modified", "Locally modified"]]) {
      const affected = installations.filter((installation) => installation[flag]);
      if (affected.length) {
        issue(result, flag === "missing" ? "MISSING_FILES" : "LOCAL_MODIFICATIONS", affected.map((entry) => entry.path));
        messages.push(`${label}: ${sourceName} ${resource.kind} ${resource.id} (${affected.map((entry) => entry.path).join(", ")})`);
        updateAvailable = true;
      }
    }
    if (removed) {
      issue(result, "REMOVED_FROM_CATALOG");
      messages.push(`Removed from catalog: ${sourceName} ${resource.kind} ${resource.id}. Use uninstall to remove it explicitly.`);
      updateAvailable = true;
      continue;
    }
    const stale = installations.filter((installation) =>
      !installation.missing && installation.ref?.toLowerCase() !== resource.source_ref.toLowerCase(),
    );
    if (stale.length) {
      issue(result, "UPDATE_AVAILABLE", stale.map((entry) => entry.path));
      const installedRefs = [...new Set(stale.map(({ ref }) => ref?.slice(0, 7) || "unknown"))];
      messages.push(
        `Update available: ${sourceName} ${resource.kind} ${resource.id} (installed at ${installedRefs.join(", ")}, catalog ${resource.source_ref.slice(0, 7)})`,
      );
      updateAvailable = true;
    }
  }
  if (!catalog) {
    const mcps = checkMcps(targetRoot, state, resources, { scope });
    for (const mcp of mcps) {
      results.set(`internal:mcp:${mcp.id}`, mcp);
      for (const finding of mcp.issues) {
        messages.push(`MCP ${mcp.id}: ${finding.code}${finding.paths.length ? ` (${finding.paths.join(", ")})` : ""}`);
        updateAvailable = true;
      }
    }
    const bundles = checkBundles(targetRoot, state, resources, [...results.values()]);
    for (const bundle of bundles) {
      results.set(`internal:bundle:${bundle.id}`, bundle);
      for (const finding of bundle.issues) {
        messages.push(`Bundle ${bundle.id}: ${finding.code}${finding.paths.length ? ` (${finding.paths.join(", ")})` : ""}`);
        updateAvailable = true;
      }
    }
  }
  if (!updateAvailable) {
    const hasLocalResources = !catalog && (Object.keys(state.resources).length > 0 ||
      Object.keys(state.bundles || {}).length > 0 || mcpsPresent(state, scope));
    if (installedSourceResources.length && hasLocalResources) {
      messages.push("All managed resources match their pinned commits.");
    } else if (installedSourceResources.length) {
      messages.push("All installed source catalog resources match their pinned commits.");
    } else if (hasLocalResources) {
      messages.push("All locally managed resources are up to date.");
    }
  }
  if (includeUnmanaged && !catalog) {
    const sourceTrackedPaths = Object.values(state.sources || {}).flatMap((collections) =>
      Object.values(collections).flatMap((records) =>
        Object.values(records).flatMap((record) => Object.keys(record.files || {})),
      ),
    );
    const legacyPaths = [...legacy.values()].flatMap((entries) => entries.map(({ path }) => path));
    const unmanaged = findUnmanagedArtifacts(
      targetRoot, new Set([...registeredPaths, ...sourceTrackedPaths, ...legacyPaths]),
    );
    for (const artifact of unmanaged) {
      results.set(`unmanaged:${artifact.kind}:${artifact.id}`, {
        catalog: "-",
        kind: artifact.kind,
        id: artifact.id,
        description: artifact.description,
        paths: artifact.paths,
        status: "unmanaged",
        managed: false,
      });
    }
  }
  return { messages, updateAvailable, resources: [...results.values()] };
}

function mcpsPresent(state: InstallState, scope?: string): boolean {
  const mcps: Record<string, McpInventoryRecord> = state.mcps || {};
  return Object.values(mcps).some((record) =>
    scope !== "user" || isUserMcp(record));
}

function collectInstalledScopes(
  targets: Record<string, string>,
  resources: CatalogResource[],
  catalogRoot: string,
  buildInfo: BuildInfo,
  sourceResources: CatalogResource[] = [],
): { resources: Array<CatalogResource & { scope: string }>; errors: ScanError[] } {
  const result: { resources: Array<CatalogResource & { scope: string }>; errors: ScanError[] } = {
    resources: [],
    errors: [],
  };
  for (const [scope, target] of Object.entries(targets)) {
    try {
      const checked = checkInstalledResources(
        target, resources, catalogRoot, buildInfo, sourceResources, { scope, includeUnmanaged: true },
      );
      result.resources.push(...checked.resources.map((resource) => ({ ...resource, scope })));
    } catch (error) {
      if (!(error instanceof CatalogError)) {
        throw error;
      }
      result.errors.push({
        scope,
        code: error.code || "CATALOG_ERROR",
        message: error.message,
      });
    }
  }
  return result;
}

function prepareResourceInstall(
  resources: CatalogResource[],
  catalogRoot: string,
  target: string,
  tool: InstallationTool | null,
  buildInfo: BuildInfo,
  options: CliOptions = {},
  state?: InstallState,
) {
  for (const resource of resources) {
    assertInstallableResource(resource);
    if (options.scope === "user" && !USER_INSTALLABLE_KINDS.has(resource.kind)) {
      throw new CatalogError("--scope user only supports skills and agents", "INVALID_ARGUMENT");
    }
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new CatalogError(`Target must be an existing directory: ${target}`);
  }
  const targetRoot = fs.realpathSync(target);
  state ||= readInstallState(targetRoot);
  const selectedTools = new Map(resources.map((resource) => {
    const key = `${resource.kind}:${resource.id}`;
    const selected = tool || state.resources[key]?.tool;
    const requestedRuntimes = selected === "both" ? ["claude", "copilot"] : [selected];
    const bundles: Record<string, BundleInventoryRecord> = state.bundles || {};
    const required = Object.entries(bundles).filter(([, bundle]) =>
      bundle.resources.some((member) => member.kind === resource.kind && member.id === resource.id) &&
      (bundle.tool === "both" ? ["claude", "copilot"] : [bundle.tool]).some((runtime) => !requestedRuntimes.includes(runtime)));
    if (required.length) {
      throw new CatalogError(`${key} has runtimes required by bundles ${required.map(([id]) => id).join(", ")}. Keep those runtimes (--tool both) or uninstall the bundles first.`, "LOCAL_CONFLICT");
    }
    return [key, selected];
  }));
  const runtimes = [...new Set([...selectedTools.values()].flatMap((selectedTool) =>
    selectedTool === "both"
      ? ["claude", "copilot"]
      : selectedTool === "claude" || selectedTool === "copilot"
        ? [selectedTool]
        : [],
  ))];
  const legacy = findInstalledProvenance(targetRoot, trackedPaths(state), runtimes,
    options);
  const plan = new Map<string, InstallPlanEntry>();
  const remove = new Set();
  const conflicts = [];
  for (const resource of resources) {
    const key = `${resource.kind}:${resource.id}`;
    const previous = state.resources[key];
    if (options.scope === "user" && previous && !isUserResource(key, previous)) {
      throw new CatalogError(`A project-style installation for ${key} already exists in this home inventory. Review and uninstall it with --target before installing a personal copy.`, "LOCAL_CONFLICT");
    }
    const selectedTool = selectedTools.get(key);
    const digest = resourceDigest(resource, catalogRoot);
    const resourceBuildInfo = previous?.digest === digest && selectedTool === previous.tool
      ? { ...buildInfo, commit: previous.commit, package_version: previous.version }
      : buildInfo;
    const resourcePlan = buildInstallPlan([resource], catalogRoot, selectedTool, resourceBuildInfo, options);
    if (options.scope === "user" && resource.kind === "agent" && selectedTool !== "claude") {
      const alternate = `.copilot/agents/${resource.id}.md`;
      if (!previous?.files[alternate] && installedFingerprint(targetRoot, alternate)) {
        throw new CatalogError(`Conflicting agent copy at ${alternate}. Back up and remove it explicitly before installing the .agent.md copy.`, "LOCAL_CONFLICT");
      }
    }
    if (resource.kind === "skill") {
      const duplicateDirectories = [
        ...(selectedTool === "claude" ? [] : [".agents/skills"]),
        ...(selectedTool === "copilot" ? [] : [".claude/skills"]),
        ...(selectedTool === "claude" || options.scope === "user" ? [] : [".github/skills"]),
        ...(options.scope === "user" && selectedTool !== "claude" ? [".copilot/skills"] : []),
      ];
      for (const directory of duplicateDirectories) {
        const other = `${directory}/${resource.id}/SKILL.md`;
        if (!resourcePlan.has(other) && !previous?.files[other] &&
            installedFingerprint(targetRoot, other)) {
          throw new CatalogError(`Conflicting skill copy at ${other}. Back up and remove that directory explicitly before reinstalling; its auxiliary files cannot be safely attributed.`);
        }
      }
    }
    for (const [relativePath, file] of resourcePlan) {
      const actual = installedFingerprint(targetRoot, relativePath);
      const desired = fileFingerprint(file.content, file.executable);
      const expected = previous?.files[relativePath];
      if (actual && !sameFingerprint(actual, desired) &&
          !sameFingerprint(actual, expected) && !options.force) {
        conflicts.push(relativePath);
      }
      addPlanEntry(plan, relativePath, file.content, file.executable);
    }
    for (const [relativePath, expected] of Object.entries(previous?.files || {})) {
      if (resourcePlan.has(relativePath)) {
        continue;
      }
      const actual = installedFingerprint(targetRoot, relativePath);
      if (actual && !sameFingerprint(actual, expected) && !options.force) {
        conflicts.push(relativePath);
      }
      if (actual) {
        remove.add(relativePath);
      }
    }
    // Old installs have no per-file baseline. Never infer ownership of sibling files.
    for (const entry of legacy.get(key) || []) {
      if (!resourcePlan.has(entry.path) && !previous?.files[entry.path]) {
        if (resource.kind === "skill") {
          throw new CatalogError(`Legacy skill copy at ${entry.path}. Back up and remove the redundant skill directory explicitly, then reinstall; its auxiliary files cannot be safely attributed.`);
        }
        if (!options.force) {
          conflicts.push(entry.path);
        } else {
          remove.add(entry.path);
        }
      }
    }
    state.resources[key] = {
      tool: selectedTool,
      digest,
      commit: resourceBuildInfo.commit,
      version: resourceBuildInfo.package_version,
      files: Object.fromEntries([...resourcePlan].map(([relativePath, file]) => [
        relativePath, fileFingerprint(file.content, file.executable),
      ])),
      standalone: options.bundle ? previous?.standalone ?? Boolean(previous)
        : options.command === "update" ? previous?.standalone ?? true : true,
    };
  }
  if (conflicts.length) {
    throw new CatalogError(`Refusing to overwrite or remove local changes / unmanaged files:\n${[...new Set(conflicts)].map((file) => `  ${file}`).join("\n")}\nReview the diff and pass --force to replace them.`, "LOCAL_CONFLICT");
  }
  return { state, plan, remove };
}

function installResources(
  resources: CatalogResource[],
  catalogRoot: string,
  target: string,
  tool: InstallationTool | null,
  buildInfo: BuildInfo,
  options: CliOptions = {},
) {
  const prepared = prepareResourceInstall(resources, catalogRoot, target, tool, buildInfo, options);
  addInventoryStateToPlan(prepared.plan, prepared.state);
  return writeInstallPlan(prepared.plan, target, { ...options, force: true, remove: [...prepared.remove] });
}

function uninstallResource(kind: string, id: string, target: string, options: CliOptions = {}) {
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new CatalogError(`Target must be an existing directory: ${target}`);
  }
  const root = fs.realpathSync(target);
  const state = readInstallState(root);
  const key = `${kind}:${id}`;
  const record = state.resources[key];
  const bundles: Record<string, BundleInventoryRecord> = state.bundles || {};
  const dependents = Object.entries(bundles).filter(([, bundle]) =>
    bundle.resources.some((member) => member.kind === kind && member.id === id)).map(([id]) => id);
  if (dependents.length) {
    throw new CatalogError(`${key} is required by bundles: ${dependents.join(", ")}. Uninstall those bundles first.`, "LOCAL_CONFLICT");
  }
  if (!record || (options.scope === "user" && !isUserResource(key, record))) {
    throw new CatalogError(`No tracked installation for ${key}. Legacy resources must be reviewed and migrated before uninstalling.`);
  }
  const { modified } = inspectInstalledFiles(root, record);
  if (modified.length && !options.force) {
    throw new CatalogError(`Refusing to remove locally modified files: ${modified.join(", ")}. Back them up or pass --force.`, "LOCAL_CONFLICT");
  }
  delete state.resources[key];
  const plan = new Map<string, InstallPlanEntry>();
  addInventoryStateToPlan(plan, state);
  const messages = writeInstallPlan(plan, target, {
    ...options, force: true, remove: Object.keys(record.files),
  });
  if (kind === "skill" && !options.dryRun) {
    const directories = [`.agents/skills/${id}`, `.claude/skills/${id}`]
      .filter((directory) => Object.keys(record.files).some((relativePath) =>
        relativePath.startsWith(`${directory}/`)));
    for (const directory of directories) {
      const absolutePath = path.resolve(root, ...directory.split("/"));
      let stat;
      try {
        stat = fs.lstatSync(absolutePath);
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new CatalogError(`Refusing to remove non-directory skill path: ${directory}`);
      }
      fs.rmSync(absolutePath, { recursive: true });
      messages.push(`Removed skill directory: ${directory}`);
    }
  }
  return messages;
}

module.exports = {
  checkInstalledResources, collectInstalledScopes, installResources, prepareResourceInstall, uninstallResource,
};
