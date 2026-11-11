"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const {
  CatalogError, LOCK_PATH, addPlanEntry,
} = require("../resources/index.js");
const {
  targetPath, readInstallState, installedFingerprint, sameFingerprint, fileFingerprint, writeInstallPlan,
  addInventoryStateToPlan,
} = require("../inventory/index.js");
const {
  sourceCatalogName, sourceSkillKey, sourceSkillRecords, sourceSkillRecord,
  removeSourceSkillRecord, readInstalledSourceSkills, recordSourceInstallation,
  removeSourceResourceRecord, readInstalledSourceResources,
  recordSourceResourceInstallation,
} = require("./installed.js");
const {
  buildSourceSkillArgs, runGhSkill, formatGhDiagnostics, describeGhFailure,
} = require("./gh-skill.js");
import type { GhSkillResult } from "./gh-skill.js";
import type { CatalogResource } from "../entries.js";
import type { FileFingerprint, InstallPlanEntry } from "../plan.js";
import type { InstalledSourceResource } from "./installed.js";
import type { InstallState, PlanAction } from "../inventory/files.js";

function catalogLabel(resource: CatalogResource): string {
  return `${resource.catalog || "source"} catalog`;
}
function sourceFileDestinations(resource, tool, scope = "project") {
  if (!["claude", "copilot", "both"].includes(tool)) throw new CatalogError("Tool must be claude, copilot or both");
  if (!["project", "user"].includes(scope)) throw new CatalogError("Scope must be project or user");
  if (resource.kind === "instruction" && scope === "user") {
    throw new CatalogError("--scope user does not support source instructions", "INVALID_ARGUMENT");
  }
  const paths = [];
  for (const runtime of tool === "both" ? ["claude", "copilot"] : [tool]) {
    if (resource.kind === "agent") {
      paths.push(runtime === "claude"
        ? `.claude/agents/${resource.id}.md`
        : `${scope === "user" ? ".copilot" : ".github"}/agents/${resource.id}.agent.md`);
    } else if (resource.kind === "instruction") {
      paths.push(runtime === "claude"
        ? `.claude/rules/${resource.id}.md`
        : `.github/instructions/${resource.id}.instructions.md`);
    }
  }
  return paths;
}

function readPinnedSourceFile(resource) {
  if (!/^[a-f0-9]{40}$/i.test(resource.source_ref)) throw new CatalogError("Source resource has no pinned commit SHA");
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-source-file-"));
  try {
    const checkout = path.join(temporaryRoot, "repository");
    execFileSync("git", ["clone", "--quiet", "--no-checkout", `https://github.com/${resource.source_repository}.git`, checkout], {
      encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    execFileSync("git", ["-C", checkout, "checkout", "--quiet", "--detach", resource.source_ref], {
      encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    const actualRef = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    if (actualRef.toLowerCase() !== resource.source_ref.toLowerCase()) {
      throw new CatalogError("Retrieved source commit does not match the catalog pin");
    }
    const relative = resource.source_path;
    if (typeof relative !== "string" || !relative || relative.startsWith("/") ||
        relative.includes("\\") || relative.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new CatalogError(`Unsafe source resource path: ${relative}`);
    }
    let current = checkout;
    for (const part of relative.split("/")) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) throw new CatalogError(`Refusing symbolic link in pinned source path: ${relative}`);
    }
    if (!fs.statSync(current).isFile()) throw new CatalogError(`Pinned source resource is not a regular file: ${relative}`);
    return fs.readFileSync(current);
  } catch (error) {
    if (error instanceof CatalogError) throw error;
    throw new CatalogError(`Cannot retrieve pinned source file ${resource.source_repository}/${resource.source_path}@${resource.source_ref}: ${error.message}`);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}


function installSourceFileResource(
  resource: CatalogResource,
  target: string,
  tool: string,
  {
    scope = "project", force = false, dryRun = false, onAction = () => {},
    destinations: requestedDestinations,
  }: {
    scope?: string;
    force?: boolean;
    dryRun?: boolean;
    onAction?: (action: PlanAction) => void;
    destinations?: string[];
  } = {},
): string[] {
  if (!["agent", "instruction"].includes(resource.kind)) throw new CatalogError(`Unsupported source resource kind: ${resource.kind}`);
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) throw new CatalogError(`Target must be an existing directory: ${target}`);
  const targetRoot = fs.realpathSync(target);
  const destinations = requestedDestinations || sourceFileDestinations(resource, tool, scope);
  const content = dryRun ? null : readPinnedSourceFile(resource);
  const plan = new Map<string, InstallPlanEntry>();
  const previous = readInstallState(targetRoot).sources?.[sourceCatalogName(resource)]?.[`${resource.kind}s`]?.[resource.id];
  const matchingPrevious = previous?.source_repository === resource.source_repository &&
    previous?.source_path === resource.source_path ? previous : null;
  for (const relativePath of destinations) {
    targetPath(targetRoot, relativePath);
    if (!dryRun) {
      const output = materializeSourceFile(resource, content, relativePath);
      const expected = matchingPrevious?.files?.[relativePath];
      if (expected) {
        const actual = installedFingerprint(targetRoot, relativePath);
        if (actual && !sameFingerprint(actual, expected) && !force) {
          throw new CatalogError(`Refusing to overwrite locally modified source file ${relativePath}; pass --force.`, "LOCAL_CONFLICT", {
            category: "tracked-modification", paths: [relativePath], recoverable: true,
          });
        }
        plan.set(relativePath, { content: output, executable: false, expected: actual });
      } else {
        addPlanEntry(plan, relativePath, output);
      }
    }
    onAction({
      action: "install", path: relativePath,
      resource: { catalog: sourceCatalogName(resource), kind: resource.kind, id: resource.id },
    });
  }
  if (dryRun) return destinations;
  writeInstallPlan(plan, targetRoot, { force });
  recordSourceResourceInstallation(resource, targetRoot, destinations);
  return destinations;
}
function materializeSourceFile(resource, content, relativePath) {
  if (resource.kind !== "instruction") return content;
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    throw new CatalogError(`Source instruction is not valid UTF-8: ${resource.source_path}`);
  }
  const frontmatter = text.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) throw new CatalogError(`Source instruction must have YAML frontmatter: ${resource.source_path}`);
  const runtimeField = relativePath.startsWith(".claude/")
    ? `paths: ${JSON.stringify(resource.apply_to)}`
    : `applyTo: ${JSON.stringify(resource.apply_to.join(", "))}`;
  return Buffer.from(`---\n${runtimeField}\n---\n\n${text.slice(frontmatter[0].length)}`, "utf8");
}

function assertSourceFileCanBeInstalled(resource, target) {
  const state = readInstallState(target);
  for (const [catalog, collections] of Object.entries(state.sources || {})) {
    if (catalog !== sourceCatalogName(resource) && collections[`${resource.kind}s`]?.[resource.id]) {
      throw new CatalogError(`${resource.kind}:${resource.id} is already tracked from another source catalog.`, "LOCAL_CONFLICT", {
        category: "provenance-conflict", paths: [], recoverable: false,
      });
    }
  }
}

function assertSourceSkillCanBeInstalled(resource: CatalogResource, target: string): void {
  const state = readInstallState(target);
  const key = sourceSkillKey(resource);
  const anotherSource = [...sourceSkillRecords(state).keys()].some((installedKey) =>
    installedKey !== key && installedKey.endsWith(`:${resource.id}`));
  if (anotherSource) {
    throw new CatalogError(
      `Skill ID '${resource.id}' is already tracked from another catalog in this target; remove it before installing from ${catalogLabel(resource)}.`,
      "LOCAL_CONFLICT",
      { category: "provenance-conflict", paths: [], recoverable: false },
    );
}
  }

function assertSourceResourceCanBeInstalled(resource: CatalogResource, target: string): void {
  if (resource.kind === "skill") assertSourceSkillCanBeInstalled(resource, target);
  else assertSourceFileCanBeInstalled(resource, target);
}


function validateSourceUpdates(
  installed: InstalledSourceResource[],
  { force = false, target, scope = "project" }: { force?: boolean; target?: string; scope?: string } = {},
): void {
  const targetRoot = target ? fs.realpathSync(target) : undefined;
  const state = targetRoot ? readInstallState(targetRoot) : undefined;
  for (const { resource, installations, removed } of installed) {
    if (removed) {
      throw new CatalogError(`${catalogLabel(resource)} ${resource.kind} ${resource.id} was removed from the catalog. Use uninstall to remove it explicitly.`);
    }
    const modified = installations.filter((installation) => installation.modified);
    if (modified.length && !force) {
      throw new CatalogError(
        `Refusing to overwrite locally modified ${catalogLabel(resource)} ${resource.kind} files: ${modified.map((entry) => entry.path).join(", ")}. Review them and pass --force.`,
        "LOCAL_CONFLICT",
        { category: "tracked-modification", paths: modified.map((entry) => entry.path), recoverable: true },
      );
    }
    if (force || !targetRoot || !state) continue;
    if (resource.kind !== "skill") {
      const destinations = sourceFileDestinations(resource, "both", scope);
      const managedPaths = new Set(Object.keys(
        state.sources?.[sourceCatalogName(resource)]?.[`${resource.kind}s`]?.[resource.id]?.files || {},
      ));
      const conflicts = destinations.filter((relativePath) =>
        !managedPaths.has(relativePath) && installedFingerprint(targetRoot, relativePath));
      if (conflicts.length) {
        throw new CatalogError(
          `Refusing to overwrite existing local ${resource.kind} files: ${conflicts.join(", ")}. Review them and pass --force.`,
          "LOCAL_CONFLICT",
          { category: "untracked-destination", paths: conflicts, recoverable: true },
        );
      }
      continue;
    }
    const record = sourceSkillRecord(state, sourceCatalogName(resource), resource.id);
    const managedPaths = new Set(Object.keys(record?.files || {}));

    for (const installation of installations) {
      const directory = path.posix.dirname(installation.path);
      const absolute = targetPath(targetRoot, directory);
      const untrackedPaths = fs.existsSync(absolute)
        ? untrackedSkillPaths(targetRoot, directory, managedPaths)
        : [];
      if (untrackedPaths.length) {
        throw new CatalogError(
          `Refusing to overwrite ${catalogLabel(resource)} skill ${resource.id} with untracked local files in ${directory}; review them and pass --force.`,
          "LOCAL_CONFLICT",
          { category: "untracked-skill-content", paths: untrackedPaths, recoverable: true },
        );
      }
    }
  }
}

function updateSourceFileResources(
  installed: InstalledSourceResource[],
  target: string,
  {
    dryRun = false,
    force = false,
    onAction = () => {},
    scope = "project",
  }: {
    dryRun?: boolean;
    force?: boolean;
    onAction?: (action: PlanAction) => void;
    scope?: string;
  } = {},
): string[] {
  const targetRoot = fs.realpathSync(target);
  const messages = [];
  for (const { resource, installations, removed } of installed) {
    if (removed) throw new CatalogError(`${catalogLabel(resource)} ${resource.kind} ${resource.id} was removed; uninstall it explicitly.`);
    const stale = installations.filter((item) => item.missing || item.modified ||
      item.ref?.toLowerCase() !== resource.source_ref.toLowerCase());
    if (!stale.length) continue;
    const modified = stale.filter((item) => item.modified);
    if (modified.length && !force) {
      throw new CatalogError(`Refusing to overwrite locally modified ${catalogLabel(resource)} ${resource.kind} files: ${modified.map((item) => item.path).join(", ")}. Pass --force.`, "LOCAL_CONFLICT", {
        category: "tracked-modification", paths: modified.map((item) => item.path), recoverable: true,
      });
    }
    if (dryRun) {
      for (const item of stale) onAction({
        action: "install", path: item.path,
        resource: { catalog: sourceCatalogName(resource), kind: resource.kind, id: resource.id },
      });
      messages.push(`Would update ${catalogLabel(resource)} ${resource.kind}: ${resource.id}`);
    } else {
      installSourceFileResource(resource, targetRoot, "both", {
        scope, force, destinations: stale.map((item) => item.path), onAction,
      });
      messages.push(`Updated ${catalogLabel(resource)} ${resource.kind}: ${resource.id}`);
    }
  }
  return messages;
}


function updateSourceResources(
  installed: InstalledSourceResource[],
  target: string,
  {
    dryRun = false,
    force = false,
    ghForce = false,
    ghForceAgent,
    onAction = () => {},
    nonInteractive = false,
    scope = "project",
  }: {
    dryRun?: boolean;
    force?: boolean;
    ghForce?: boolean;
    ghForceAgent?: string;
    onAction?: (action: PlanAction) => void;
    nonInteractive?: boolean;
    scope?: string;
  } = {},
  invokeGhSkill?: (args: string[], cwd: string) => number | GhSkillResult,
): string[] {
  invokeGhSkill ||= (args, cwd) => runGhSkill(args, cwd, undefined, {
    nonInteractive, captureOutput: nonInteractive,
  });
  const targetRoot = fs.realpathSync(target);
  if (ghForce && !ghForceAgent) {
    throw new CatalogError("A GitHub force retry must identify the failed agent.", "INVALID_ARGUMENT");
  }
  const installOptions = { scope, target: targetRoot };
  validateSourceUpdates(installed, { force, target: targetRoot, scope });
  const fileResources = installed.filter(({ resource }) => resource.kind !== "skill");
  const fileMessages = updateSourceFileResources(fileResources, target, { dryRun, force, onAction, scope });
  installed = installed.filter(({ resource }) => resource.kind === "skill");
  const messages = [...fileMessages];
  let hasUpdates = false;
  if (scope === "user") {
    for (const { installations } of installed) {
      for (const installation of installations) targetPath(targetRoot, installation.path);
    }
  }
  for (const { resource, installations } of installed) {
    const stale = installations.filter((installation) =>
      installation.missing || installation.modified ||
      installation.ref?.toLowerCase() !== resource.source_ref.toLowerCase(),
    );
    if (!stale.length) {
      continue;
    }
    hasUpdates = true;

    if (dryRun) {
      for (const installation of stale) {
        onAction({
          action: "delegate_install", path: installation.path,
          resource: { catalog: sourceCatalogName(resource), kind: "skill", id: resource.id },
          command: { program: "gh", args: buildSourceSkillArgs("install", resource, installation.agent, {
            ...installOptions, force: force || (ghForce && installation.agent === ghForceAgent),
          }) },
        });
      }
      const installedRefs = [...new Set(stale.map(({ ref }) => ref?.slice(0, 7) || "unknown"))];
      messages.push(
        `Would update ${catalogLabel(resource)} skill: ${resource.id} (installed at ${installedRefs.join(", ")}, catalog ${resource.source_ref.slice(0, 7)})`,
      );
      continue;
    }
    const completed = [];
    for (const installation of stale) {
      let result: number | GhSkillResult;
      try {
        result = invokeGhSkill(
          buildSourceSkillArgs("install", resource, installation.agent, {
            ...installOptions, force: force || (ghForce && installation.agent === ghForceAgent),
          }),
          targetRoot,
        );
      } catch (error) {
        if ((error as Error & { code?: string }).code !== "GH_SPAWN_FAILED") throw error;
        const partial = [...messages, ...(completed.length ? [`Updated agents: ${completed.join(", ")}`] : [])];
        const userMessage = `Could not start GitHub CLI while updating ${catalogLabel(resource)} skill ${resource.id} for ${installation.agent}. Check that gh is installed and available on PATH.${partial.length ? ` Already updated: ${partial.join("; ")}.` : ""}`;
        throw new CatalogError(userMessage, "GH_SPAWN_FAILED", {
          category: "github-cli", userMessage,
        });
      }
      const status = typeof result === "number" ? result : result.status;
      if (status !== 0) {
        const diagnostic = typeof result === "number" ? "" : formatGhDiagnostics(result);
        const ghForceRequired = /^Skills already installed: [^\r\n]+ \(Use --force to overwrite\)$/im.test(diagnostic);
        const cause = ghForceRequired
          ? "GitHub CLI says this skill is already installed and requires --force to overwrite it."
          : describeGhFailure(diagnostic);
        const priorUpdates = [
          ...messages,
          ...(completed.length ? [`Updated agents: ${completed.join(", ")}`] : []),
        ];
        const partial = priorUpdates.length
          ? ` Already updated: ${priorUpdates.join("; ")}. Those updates remain in place.`
          : " No agents were confirmed updated before this failure.";
        const userMessage = `Could not update ${catalogLabel(resource)} skill ${resource.id} for ${installation.agent}: gh exited with status ${status}. ${cause}${partial}`;
        if (ghForceRequired) {
          throw new CatalogError(
            `${userMessage}${diagnostic ? ` gh diagnostic: ${diagnostic}` : ""}`,
            "GH_FORCE_REQUIRED",
            {
              category: "github-force-required", recoverable: true, agent: installation.agent,
              userMessage, technicalDetail: diagnostic || undefined,
            },
          );
        }
        throw new CatalogError(
          `${userMessage}${diagnostic ? ` gh diagnostic: ${diagnostic}` : ""}`,
          "GH_UPDATE_FAILED",
          { category: "github-cli", userMessage, technicalDetail: diagnostic || undefined },
        );
      }
      recordSourceInstallation(resource, targetRoot, installation.agent);
      completed.push(installation.agent);
    }
    messages.push(`Updated ${catalogLabel(resource)} skill: ${resource.id}`);
  }
  if (!hasUpdates && installed.length) {
    messages.push("No source skill updates available.");
  }
  return messages;
}

function uninstallSourceFileResource(
  resource: CatalogResource,
  target: string,
  {
    dryRun = false,
    force = false,
    onAction = () => {},
  }: {
    dryRun?: boolean;
    force?: boolean;
    onAction?: (action: PlanAction) => void;
  } = {},
): string[] {
  const targetRoot = fs.realpathSync(target);
  const installed = readInstalledSourceResources(targetRoot, [resource], { catalog: sourceCatalogName(resource), kind: resource.kind })
    .find(({ resource: current }) => current.id === resource.id);
  if (!installed) throw new CatalogError(`No tracked ${catalogLabel(resource)} ${resource.kind} installation for ${resource.id}`);
  const paths = installed.installations.filter((item) => !item.missing).map((item) => item.path);
  const modified = installed.installations.filter((item) => item.modified);
  if (modified.length && !force) {
    throw new CatalogError(`Refusing to remove locally modified ${catalogLabel(resource)} ${resource.kind} files: ${modified.map((item) => item.path).join(", ")}. Pass --force.`, "LOCAL_CONFLICT", {
      category: "tracked-modification", paths: modified.map((item) => item.path), recoverable: true,
    });
  }
  const state = readInstallState(targetRoot);
  if (dryRun) {
    for (const relativePath of paths) onAction({
      action: "remove", path: relativePath,
      resource: { catalog: sourceCatalogName(resource), kind: resource.kind, id: resource.id },
    });
    if (!paths.length) onAction({
      action: "forget", path: null,
      resource: { catalog: sourceCatalogName(resource), kind: resource.kind, id: resource.id },
    });
    onAction({ action: "overwrite", path: LOCK_PATH });
    return paths.map((relativePath) => `Would remove: ${relativePath}`);
  }
  removeSourceResourceRecord(state, resource);
  const plan = new Map<string, InstallPlanEntry>();
  addInventoryStateToPlan(plan, state);
  writeInstallPlan(plan, targetRoot, { force: true, remove: paths });
  return paths.length ? paths.map((relativePath) => `Removed ${catalogLabel(resource)} ${resource.kind}: ${relativePath}`)
    : [`Forgot missing ${catalogLabel(resource)} ${resource.kind}: ${resource.id}`];
}

function pruneEmptySkillDirectory(targetRoot: string, relativeDirectory: string): void {
  let absolute;
  try { absolute = targetPath(targetRoot, relativeDirectory); }
  catch (error) {
    if (/symbolic link/i.test(error.message)) return;
    throw error;
  }
  let stat;
  try { stat = fs.lstatSync(absolute); }
  catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) return;
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      pruneEmptySkillDirectory(targetRoot, path.posix.join(relativeDirectory, entry.name));
    }
  }
  if (fs.readdirSync(absolute).length === 0) fs.rmdirSync(absolute);
}

function untrackedSkillPaths(targetRoot: string, relativeDirectory: string, managedPaths: Set<string>): string[] {
  const paths: string[] = [];
  const absolute = targetPath(targetRoot, relativeDirectory);
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const relative = path.posix.join(relativeDirectory, entry.name);
    if (entry.isSymbolicLink()) paths.push(relative);
    else if (entry.isDirectory()) paths.push(...untrackedSkillPaths(targetRoot, relative, managedPaths));
    else if (!managedPaths.has(relative)) paths.push(relative);
  }
  return paths;
}

function hasUntrackedSkillContent(targetRoot: string, relativeDirectory: string, managedPaths: Set<string>): boolean {
  const absolute = targetPath(targetRoot, relativeDirectory);
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const relative = path.posix.join(relativeDirectory, entry.name);
    if (entry.isSymbolicLink()) return true;
    if (entry.isDirectory()) {
      if (hasUntrackedSkillContent(targetRoot, relative, managedPaths)) return true;
    } else if (!managedPaths.has(relative)) return true;
  }
  return false;
}

function uninstallSourceResource(
  resource: CatalogResource,
  target: string,
  {
    dryRun = false,
    force = false,
    onAction = () => {},
  }: { dryRun?: boolean; force?: boolean; onAction?: (action: PlanAction) => void } = {},
): string[] {
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new CatalogError(`Target must be an existing directory: ${target}`);
  }
  if (resource.kind !== "skill") return uninstallSourceFileResource(resource, target, { dryRun, force, onAction });
  const targetRoot = fs.realpathSync(target);
  const key = sourceSkillKey(resource);
  const installed = readInstalledSourceSkills(targetRoot, [resource])
    .find(({ resource: installedResource }) => sourceSkillKey(installedResource) === key);
  if (!installed) {
    throw new CatalogError(`No tracked ${catalogLabel(resource)} skill installation for ${resource.id}`);
  }

  const mismatched = installed.installations.filter((entry) => !entry.missing && !entry.provenanceMatches);
  if (mismatched.length) {
    throw new CatalogError(`Refusing to remove ${catalogLabel(resource)} skill files with mismatched provenance: ${mismatched.map((entry) => entry.path).join(", ")}`);
  }
  const state: InstallState = readInstallState(targetRoot);
  const record = sourceSkillRecord(state, sourceCatalogName(resource), resource.id);
  const matchingRecord = record &&
    record.source_repository === resource.source_repository &&
    record.source_path === resource.source_path
    ? record
    : null;
  const skillDirectories = installed.installations.map(({ path: relativePath }) => path.posix.dirname(relativePath));
  const candidatePaths = matchingRecord
    ? Object.keys(matchingRecord.files).filter((relativePath) =>
      skillDirectories.some((directory) => relativePath.startsWith(`${directory}/`)))
    : installed.installations.filter((entry) => !entry.missing).map(({ path: relativePath }) => relativePath);
  const paths = candidatePaths.filter((relativePath) => installedFingerprint(targetRoot, relativePath));
  const untracked = paths.filter((relativePath) => !matchingRecord?.files[relativePath]);
  const modified = paths.filter((relativePath) => {
    const expected = matchingRecord?.files[relativePath];
    return expected && !sameFingerprint(installedFingerprint(targetRoot, relativePath), expected);
  });
  if (dryRun) {
    const messages = [];
    if (!paths.length) {
      messages.push(`Would forget missing ${catalogLabel(resource)} skill: ${resource.id}`);
      onAction({ action: "forget", path: null, resource: { catalog: sourceCatalogName(resource), kind: "skill", id: resource.id } });
    }
    for (const relativePath of paths) {
      messages.push(`Would remove: ${relativePath}`);
      onAction({ action: "remove", path: relativePath, resource: { catalog: sourceCatalogName(resource), kind: "skill", id: resource.id } });
    }
    for (const directory of skillDirectories) {
      const absolute = targetPath(targetRoot, directory);
      if (fs.existsSync(absolute) && hasUntrackedSkillContent(targetRoot, directory, new Set(paths))) {
        messages.push(`Would preserve additional contents in: ${directory}`);
      }
    }
    if (modified.length) {
      messages.push(
        `Locally modified ${catalogLabel(resource)} skill entry points require --force: ${modified.join(", ")}`,
      );
    } else if (untracked.length) {
      messages.push(
        `${catalogLabel(resource)} skill changes cannot be checked against an installation baseline; reinstall or update the skill to track it, or pass --force.`,
      );
    } else {
      messages.push(`${catalogLabel(resource)} skill entry points match their recorded installation baseline.`);
    }
    if (matchingRecord) onAction({ action: "overwrite", path: LOCK_PATH });
    return messages;
  }
  if (modified.length && !force) {
    throw new CatalogError(
      `Refusing to remove locally modified ${catalogLabel(resource)} skill files: ${modified.join(", ")}. Back them up or pass --force.`,
    );
  }
  if (untracked.length && !force) {
    throw new CatalogError(
      `Cannot verify whether ${catalogLabel(resource)} skill ${resource.id} was locally modified. Reinstall or update it to establish an installation baseline, or pass --force to remove its SKILL.md entry point.`,
    );
  }

  const plan = new Map<string, InstallPlanEntry>();
  if (matchingRecord) {
    removeSourceSkillRecord(state, resource);
    addInventoryStateToPlan(plan, state);
  }
  const expectedRemovals = new Map<string, FileFingerprint | null>();
  for (const relativePath of paths) expectedRemovals.set(relativePath, installedFingerprint(targetRoot, relativePath));
  writeInstallPlan(plan, targetRoot, {
    force: true,
    remove: paths,
    ...(force ? {} : { expectedRemovals }),
  });
  const messages = [];
  if (!paths.length) messages.push(`Forgot missing ${catalogLabel(resource)} skill: ${resource.id}`);
  for (const relativePath of paths) {
    messages.push(relativePath.endsWith("/SKILL.md")
      ? `Removed ${catalogLabel(resource)} skill entry point: ${relativePath}`
      : `Removed ${catalogLabel(resource)} skill file: ${relativePath}`);
  }
  for (const directory of skillDirectories) {
    pruneEmptySkillDirectory(targetRoot, directory);
    const absolute = targetPath(targetRoot, directory);
    if (fs.existsSync(absolute) && fs.readdirSync(absolute).length) {
      messages.push(`Preserved additional contents in: ${directory}`);
    }
  }
  return messages;
}


module.exports = {
  assertSourceResourceCanBeInstalled, readPinnedSourceFile, catalogLabel,
  installSourceFileResource, validateSourceUpdates, updateSourceResources,
  uninstallSourceResource,
};
