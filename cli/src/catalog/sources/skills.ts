"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const YAML = require("yaml");
const { spawnSync, execFileSync } = require("node:child_process");
const {
  CatalogError, SOURCE_SKILL_DIRECTORIES, LOCK_PATH, addPlanEntry,
} = require("../resources/index.js");
const {
  targetPath, readInstallState, installedFingerprint, sameFingerprint, fileFingerprint, writeInstallPlan,
  addInventoryStateToPlan,
} = require("../inventory/index.js");
const { loadSourceCatalogsFromDirectory } = require("./loader.js");
const { loadUserSourceConfiguration, userCatalogIndexDirectory } = require("./config.js");
const {
  sourceCatalogName, sourceSkillKey, sourceSkillRecords, sourceSkillRecord,
  removeSourceSkillRecord, readInstalledSourceSkills, recordSourceInstallation,
  removeSourceResourceRecord, readInstalledSourceResources,
  recordSourceResourceInstallation,
} = require("./installed.js");
import type { CatalogResource } from "../entries.js";
const { auditTextResources } = require("../audit.js");
import type { FileFingerprint, InstallPlanEntry } from "../plan.js";
import type { CliOptions } from "../../cli/arguments.js";
import type { InstallState, PlanAction } from "../inventory/files.js";
import type { InstalledSourceResource } from "./installed.js";

const {
  MAX_BUNDLE_FILES, MAX_BUNDLE_CONTENT_BYTES, readCachedResourceFiles,
} = require("../bundles.js");
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

function readPinnedSourceFiles(
  resource: CatalogResource,
  { maxFiles = MAX_BUNDLE_FILES, maxBytes = MAX_BUNDLE_CONTENT_BYTES } = {},
) {
  if (!/^[a-f0-9]{40}$/i.test(resource.source_ref || "")) {
    throw new CatalogError("Source resource has no pinned commit SHA");
  }
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-source-bundle-"));
  try {
    const checkout = path.join(temporaryRoot, "repository");
    const environment = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1" };
    execFileSync("git", ["clone", "--quiet", "--no-checkout", `https://github.com/${resource.source_repository}.git`, checkout], {
      encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"], env: environment,
    });
    execFileSync("git", ["-C", checkout, "checkout", "--quiet", "--detach", resource.source_ref], {
      encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"], env: environment,
    });
    const actualRef = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    if (actualRef.toLowerCase() !== resource.source_ref.toLowerCase()) {
      throw new CatalogError("Retrieved source commit does not match the catalog pin");
    }
    if (!resource.source_path || !/^[a-f0-9]{40}$/i.test(resource.source_ref)) {
      throw new CatalogError("Bundle resource has no safe pinned source path");
    }
    const tree = execFileSync("git", [
      "-C", checkout, "ls-tree", "-r", "-z", "--full-tree", resource.source_ref, "--", resource.source_path,
    ], { encoding: "buffer", timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const treeEntries = [];
    let totalBytes = 0;
    for (const record of tree.toString("binary").split("\0")) {
      if (!record) continue;
      const tab = record.indexOf("\t");
      if (tab < 0) throw new CatalogError("Pinned source tree contains a malformed Git tree entry");
      const [mode, type, oid] = record.slice(0, tab).split(" ");
      const filePath = decoder.decode(Buffer.from(record.slice(tab + 1), "binary"));
      if (resource.kind === "skill") {
        if (!filePath.startsWith(`${resource.source_path}/`)) continue;
      } else if (filePath !== resource.source_path) {
        continue;
      }
      const relativePath = resource.kind === "skill"
        ? filePath.slice(resource.source_path.length + 1)
        : path.posix.basename(filePath);
      if (!relativePath || relativePath.startsWith("/") || relativePath.includes("\\") ||
          relativePath.split("/").some((part) => !part || part === "." || part === "..")) {
        throw new CatalogError(`Unsafe pinned source file path: ${filePath}`);
      }
      if (type !== "blob" || !["100644", "100755"].includes(mode)) {
        throw new CatalogError(`Resource bundle cannot contain a symlink or submodule: ${filePath}`);
      }
      const sizeText = execFileSync("git", ["-C", checkout, "cat-file", "-s", oid], { encoding: "utf8" }).trim();
      const size = Number(sizeText);
      if (treeEntries.length >= maxFiles) throw new CatalogError(`Resource bundle exceeds ${MAX_BUNDLE_FILES} files`);
      if (!Number.isSafeInteger(size) || size < 0 || size > 16 * 1024 * 1024) {
        throw new CatalogError(`Pinned source file exceeds 16777216 byte bundle limit: ${filePath}`);
      }
      if (totalBytes + size > maxBytes) {
        throw new CatalogError(`Resource bundle exceeds ${MAX_BUNDLE_CONTENT_BYTES} content bytes`);
      }
      totalBytes += size;
      const content = execFileSync("git", ["-C", checkout, "cat-file", "blob", oid], {
        encoding: "buffer", maxBuffer: 16 * 1024 * 1024 + 1,
      });
      if (content.length !== size) throw new CatalogError(`Pinned source blob size changed while reading: ${filePath}`);
      if (content.toString("utf8").startsWith("version https://git-lfs.github.com/spec/v1\n")) {
        throw new CatalogError(`Resource bundle cannot include external Git LFS content: ${filePath}`);
      }
      treeEntries.push({ path: relativePath, content, executable: mode === "100755" });
    }
    if (resource.kind === "skill" && !treeEntries.some(({ path: filePath }) => filePath === "SKILL.md")) {
      throw new CatalogError(`Pinned skill tree has no SKILL.md: ${resource.source_path}`);
    }
    if (resource.kind !== "skill" && treeEntries.length !== 1) {
      throw new CatalogError(`Pinned ${resource.kind} source must be one regular Git file: ${resource.source_path}`);
    }
    return treeEntries;
  } catch (error) {
    if (error instanceof CatalogError) throw error;
    throw new CatalogError(`Cannot retrieve complete pinned source ${resource.source_repository}/${resource.source_path}@${resource.source_ref}: ${error.message}`);
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
    destinations: requestedDestinations, bundleFiles,
  }: {
    scope?: string;
    force?: boolean;
    dryRun?: boolean;
    onAction?: (action: PlanAction) => void;
    destinations?: string[];
    bundleFiles?: Array<{ path: string; content: Buffer; executable: boolean }>;
  } = {},
): string[] {
  if (!["agent", "instruction"].includes(resource.kind)) throw new CatalogError(`Unsupported source resource kind: ${resource.kind}`);
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) throw new CatalogError(`Target must be an existing directory: ${target}`);
  const targetRoot = fs.realpathSync(target);
  const destinations = requestedDestinations || sourceFileDestinations(resource, tool, scope);
  const verifiedBundleFiles = bundleFiles ?? (!dryRun && resource.bundle_id
    ? readCachedResourceFiles(resource)
    : null);
  const content = dryRun ? null : verifiedBundleFiles
    ? verifiedBundleFiles[0]?.content
    : readPinnedSourceFile(resource);
  if (!dryRun && !content) throw new CatalogError(`Bundle contains no ${resource.kind} source file: ${resource.id}`);
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

function materializeBundledSkillEntry(resource: CatalogResource, content: Buffer): Buffer {
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(content); }
  catch { throw new CatalogError(`Bundled skill entry point is not valid UTF-8: ${resource.source_path}`); }
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) throw new CatalogError(`Bundled skill entry point must have YAML frontmatter: ${resource.source_path}`);
  const document = YAML.parseDocument(frontmatter[1], { uniqueKeys: true, schema: "core" });
  if (document.errors.length || document.warnings.length) {
    throw new CatalogError(`Invalid bundled skill frontmatter: ${[...document.errors, ...document.warnings].map(({ message }) => message).join("; ")}`);
  }
  let metadata = document.get("metadata", true);
  if (metadata !== undefined && !YAML.isMap(metadata)) {
    throw new CatalogError(`Bundled skill metadata must be a YAML mapping: ${resource.source_path}`);
  }
  if (metadata === undefined) metadata = document.createNode({});
  metadata.set("github-repo", `https://github.com/${resource.source_repository}`);
  metadata.set("github-path", resource.source_path);
  metadata.set("github-ref", resource.source_ref);
  metadata.set("github-pinned", resource.source_ref);
  document.set("metadata", metadata);
  return Buffer.from(`---\n${document.toString().trimEnd()}\n---\n${text.slice(frontmatter[0].length)}`, "utf8");
}

function installBundledSourceSkill(
  resource: CatalogResource,
  target: string,
  agents: string[],
  bundleFiles: Array<{ path: string; content: Buffer; executable: boolean }>,
  {
    force = false, dryRun = false, onAction = () => {},
  }: { force?: boolean; dryRun?: boolean; onAction?: (action: PlanAction) => void } = {},
): string[] {
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new CatalogError(`Target must be an existing directory: ${target}`);
  }
  if (resource.kind !== "skill" || !bundleFiles.some(({ path: filePath }) => filePath === "SKILL.md")) {
    throw new CatalogError(`A signed skill bundle with SKILL.md is required for ${resource.id}`);
  }
  const targetRoot = fs.realpathSync(target);
  const state = readInstallState(targetRoot);
  const previous = sourceSkillRecord(state, sourceCatalogName(resource), resource.id);
  if (previous && (previous.source_repository !== resource.source_repository ||
      previous.source_path !== resource.source_path)) {
    throw new CatalogError(`Refusing to replace tracked skill provenance for ${resource.id}`, "LOCAL_CONFLICT", {
      category: "provenance-conflict", paths: [], recoverable: false,
    });
  }
  const selectedPrefixes = agents.map((agent) => {
    const directory = SOURCE_SKILL_DIRECTORIES[agent];
    if (!directory) throw new CatalogError(`Unsupported source skill runtime: ${agent}`);
    return `${directory}/${resource.id}/`;
  });
  const plan = new Map<string, InstallPlanEntry>();
  const outputContents = new Map<string, { content: Buffer; executable: boolean }>();
  for (const prefix of selectedPrefixes) {
    for (const file of bundleFiles) {
      const relativePath = `${prefix}${file.path}`;
      targetPath(targetRoot, relativePath);
      const content = file.path === "SKILL.md"
        ? materializeBundledSkillEntry(resource, file.content)
        : file.content;
      outputContents.set(relativePath, { content, executable: file.executable });
    }
  }
  const oldPaths = Object.keys(previous?.files || {}).filter((relativePath) =>
    selectedPrefixes.some((prefix) => relativePath.startsWith(prefix)));
  const removals: string[] = [];
  const expectedRemovals = new Map<string, FileFingerprint | null>();
  const files = previous ? { ...previous.files } : {};
  for (const relativePath of oldPaths) {
    const actual = installedFingerprint(targetRoot, relativePath);
    const expected = previous.files[relativePath];
    if (actual && !sameFingerprint(actual, expected) && !force) {
      throw new CatalogError(`Refusing to replace locally modified source skill file ${relativePath}; pass --force.`, "LOCAL_CONFLICT", {
        category: "tracked-modification", paths: [relativePath], recoverable: true,
      });
    }
    if (!outputContents.has(relativePath)) {
      delete files[relativePath];
      if (actual) {
        removals.push(relativePath);
        expectedRemovals.set(relativePath, actual);
      }
    }
  }
  const destinations: string[] = [];
  for (const [relativePath, entry] of outputContents) {
    const actual = installedFingerprint(targetRoot, relativePath);
    const expected = previous?.files[relativePath];
    if (expected && actual && !sameFingerprint(actual, expected) && !force) {
      throw new CatalogError(`Refusing to overwrite locally modified source skill file ${relativePath}; pass --force.`, "LOCAL_CONFLICT", {
        category: "tracked-modification", paths: [relativePath], recoverable: true,
      });
    }
    const planEntry: InstallPlanEntry = {
      content: entry.content,
      executable: entry.executable,
      ...(expected ? { expected: actual } : {}),
    };
    plan.set(relativePath, planEntry);
    files[relativePath] = fileFingerprint(entry.content, entry.executable);
    destinations.push(relativePath);
  }
  state.sources ||= {};
  state.sources[sourceCatalogName(resource)] ||= {};
  state.sources[sourceCatalogName(resource)].skills ||= {};
  state.sources[sourceCatalogName(resource)].skills[resource.id] = {
    source_repository: resource.source_repository,
    source_path: resource.source_path,
    source_ref: resource.source_ref,
    files,
  };
  addInventoryStateToPlan(plan, state);
  const inventoryEntry = plan.get(LOCK_PATH);
  if (inventoryEntry) inventoryEntry.expected = installedFingerprint(targetRoot, LOCK_PATH);
  writeInstallPlan(plan, targetRoot, {
    force,
    dryRun,
    remove: removals,
    ...(force ? {} : { expectedRemovals }),
    onAction: (action) => {
      if (action.path === LOCK_PATH) return;
      onAction({
        ...action,
        resource: { catalog: sourceCatalogName(resource), kind: "skill", id: resource.id },
      });
    },
  });
  return destinations;
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

function buildSourceSkillArgs(
  action: string,
  resource: CatalogResource,
  agent?: string,
  { force = false, scope = "project", target }: { force?: boolean; scope?: string; target?: string } = {},
): string[] {
  if (action === "preview") {
    return [
      "skill", "preview", resource.source_repository,
      `${resource.source_path}@${resource.source_ref}`,
    ];
  }
  if (action === "install" && ["claude-code", "github-copilot"].includes(agent)) {
    if (scope === "user" && (!target || !path.isAbsolute(target))) {
      throw new CatalogError("User-scope source installation requires an absolute home directory");
    }
    return [
      "skill", "install", resource.source_repository, resource.source_path,
      "--agent", agent, "--scope", scope, "--pin", resource.source_ref,
      ...(scope === "user" ? ["--dir", path.join(target, SOURCE_SKILL_DIRECTORIES[agent])] : []),
      ...(force ? ["--force"] : []),
    ];
  }
  throw new CatalogError(`Unsupported source skill action: ${action}`);
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
    if (resource.bundle_id) {
      const bundleFiles = readCachedResourceFiles(resource);
      const conflicts: string[] = [];
      for (const installation of installations) {
        const prefix = `${SOURCE_SKILL_DIRECTORIES[installation.agent]}/${resource.id}/`;
        for (const file of bundleFiles) {
          const relativePath = `${prefix}${file.path}`;
          if (!managedPaths.has(relativePath) && installedFingerprint(targetRoot, relativePath)) {
            conflicts.push(relativePath);
          }
        }
      }
      if (conflicts.length && !force) {
        throw new CatalogError(
          `Refusing to overwrite existing local skill files: ${conflicts.join(", ")}. Review them and pass --force.`,
          "LOCAL_CONFLICT",
          { category: "untracked-destination", paths: conflicts, recoverable: true },
        );
      }
      continue;
    }
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

type GhSkillResult = { status: number; stdout?: string | Buffer | null; stderr?: string | Buffer | null };

function updateSourceResources(
  installed: InstalledSourceResource[],
  target: string,
  {
    dryRun = false,
    force = false,
    onAction = () => {},
    nonInteractive = false,
    scope = "project",
  }: {
    dryRun?: boolean;
    force?: boolean;
    onAction?: (action: PlanAction) => void;
    nonInteractive?: boolean;
    scope?: string;
  } = {},
  invokeGhSkill?: (args: string[], cwd: string) => number | GhSkillResult,
): string[] {
  invokeGhSkill ||= (args, cwd) => runGhSkill(args, cwd, spawnSync, {
    nonInteractive, captureOutput: nonInteractive,
  });
  const targetRoot = fs.realpathSync(target);
  const installOptions = { force: true, scope, target: targetRoot };
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
    const bundleFiles = resource.bundle_id ? readCachedResourceFiles(resource) : null;
    if (bundleFiles) {
      const paths = installBundledSourceSkill(
        resource, targetRoot, stale.map(({ agent }) => agent), bundleFiles,
        { force, dryRun, onAction },
      );
      messages.push(`${dryRun ? "Would update" : "Updated"} ${catalogLabel(resource)} skill: ${resource.id} (${paths.join(", ")})`);
      continue;
    }
    if (dryRun) {
      for (const installation of stale) {
        onAction({
          action: "delegate_install", path: installation.path,
          resource: { catalog: sourceCatalogName(resource), kind: "skill", id: resource.id },
          command: { program: "gh", args: buildSourceSkillArgs("install", resource, installation.agent, installOptions) },
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
          buildSourceSkillArgs("install", resource, installation.agent, installOptions),
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
        const cause = describeGhFailure(diagnostic);
        const priorUpdates = [
          ...messages,
          ...(completed.length ? [`Updated agents: ${completed.join(", ")}`] : []),
        ];
        const partial = priorUpdates.length
          ? ` Already updated: ${priorUpdates.join("; ")}. Those updates remain in place.`
          : " No agents were confirmed updated before this failure.";
        const userMessage = `Could not update ${catalogLabel(resource)} skill ${resource.id} for ${installation.agent}: gh exited with status ${status}. ${cause}${partial}`;
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

function runGhSkill(
  args: string[],
  cwd = process.cwd(),
  spawn: typeof spawnSync = spawnSync,
  { nonInteractive = false, captureOutput = false }: { nonInteractive?: boolean; captureOutput?: boolean } = {},
): number | GhSkillResult {
  let result;
  try {
    result = spawn("gh", args, {
      cwd,
      stdio: captureOutput ? ["ignore", "pipe", "pipe"] : nonInteractive ? ["ignore", "inherit", "inherit"] : "inherit",
      ...(captureOutput ? { encoding: "utf8" } : {}),
      ...(nonInteractive ? { env: { ...process.env, GH_PROMPT_DISABLED: "1" } } : {}),
    });
  } catch (error) {
    const code = (error as Error & { code?: string }).code || "process launch failed";
    throw new CatalogError(
      `Could not start GitHub CLI for source skill update: ${code}. Check that gh is installed and available on PATH.`,
      "GH_SPAWN_FAILED",
      {
        category: "github-cli",
        userMessage: "Could not start GitHub CLI for the source skill update. Check that gh is installed and available on PATH.",
      },
    );
  }
  if (result.error) {
    throw new CatalogError(
      `Could not start GitHub CLI for source skill update: ${result.error.code || "process launch failed"}. Check that gh is installed and available on PATH.`,
      "GH_SPAWN_FAILED",
      {
        category: "github-cli",
        userMessage: "Could not start GitHub CLI for the source skill update. Check that gh is installed and available on PATH.",
      },
    );
  }
  const status = result.status ?? 1;
  return captureOutput ? { status, stdout: result.stdout, stderr: result.stderr } : status;
}

function formatGhDiagnostics(result: GhSkillResult): string {
  const raw = result.stderr || result.stdout;
  if (raw == null) return "";
  const text = raw.toString()
    .replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{12,}\b/gi, "[REDACTED]")
    .replace(/\b(Bearer|token)\s+[A-Za-z0-9._~+/-]{12,}={0,2}\b/gi, "$1 [REDACTED]")
    .replace(/\b(gh[_-]?)?(token|authorization|password)\b["']?\s*[:=]\s*["']?([^\s"',;}&]+)/gi, "$1$2=[REDACTED]")
    .trim();
  if (!text) return "";
  const limit = 400;
  return text.length > limit ? `${text.slice(0, limit)}… [diagnostic truncated]` : text;
}

function describeGhFailure(diagnostic: string): string {
  const text = diagnostic.toLowerCase();
  if (/rate.?limit|api rate limit/.test(text)) return "GitHub reports an API rate limit; wait for the limit to reset, then retry.";
  if (/not logged in|authentication|bad credentials|unauthorized|http 401|status 401/.test(text)) {
    return "GitHub CLI authentication failed; run `gh auth login` and verify repository access.";
  }
  if (/repository not found|could not read from remote|not found|http 404/.test(text)) {
    return "The repository or pinned resource was not found; verify the catalog repository, pin, and your access.";
  }
  if (/could not resolve host|connection refused|network is unreachable|timed? out|temporary failure|tls handshake|no such host/.test(text)) {
    return "GitHub could not be reached; check the network connection and retry.";
  }
  return "gh did not provide a recognized cause. Check GitHub CLI authentication, repository access, network connectivity, and the pinned resource, then retry.";
}

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
  bundleFiles?: Array<{ path: string; content: Buffer; executable: boolean }> | null,
  { tool = "claude", scope = "project" }: { tool?: string; scope?: string } = {},
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
  let files;
  if (!bundleFiles) {
    files = [{
      path: filePath,
      kind: resource.kind,
      content: readPinnedSourceFile({ ...resource, source_path: filePath }),
    }];
  } else if (resource.kind === "instruction") {
    files = sourceFileDestinations(resource, tool, scope).map((destination) => ({
      path: destination,
      kind: resource.kind,
      content: materializeSourceFile(resource, bundleFiles[0].content, destination),
    }));
  } else {
    files = bundleFiles.map((file) => ({
      path: resource.kind === "skill" ? `${resource.source_path}/${file.path}` : filePath,
      kind: resource.kind,
      content: resource.kind === "skill" && file.path === "SKILL.md"
        ? materializeBundledSkillEntry(resource, file.content)
        : file.content,
    }));
  }
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
): number {
  invokeGhSkill ||= (args, cwd) => runGhSkill(args, cwd, spawnSync, options);
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
  const bundleFiles = resource.bundle_id ? readCachedResourceFiles(resource) : null;
  if (options.offline && (options.action === "preview" || !bundleFiles)) {
    throw new CatalogError(
      "Source resource installation requires an imported signed bundle when offline; source preview still requires GitHub.",
      "INVALID_ARGUMENT",
    );
  }
  options.onResource?.({ catalog: sourceCatalogName(resource), kind: resource.kind, id: resource.id, status: "planned", source: true });

  let target = process.cwd();
  if (options.action === "install") {
    if (!fs.existsSync(options.target) || !fs.statSync(options.target).isDirectory()) {
      throw new CatalogError(`Target must be an existing directory: ${options.target}`);
    }
    target = fs.realpathSync(options.target);
    if (resource.kind === "skill") assertSourceSkillCanBeInstalled(resource, target);
    else assertSourceFileCanBeInstalled(resource, target);
  }
  if (options.action === "install") {
    if (resource.license_status.toLocaleLowerCase() === "proprietary") {
      output.error(`Warning: ${resource.id} is marked Proprietary; confirm you are authorized before installing.`);
    } else if (resource.license_status === "not-declared") {
      output.error(`Warning: ${resource.id} has no declared license; verify usage rights before installing.`);
    }
  }
  if (options.audit) {
    const audit = auditPinnedResource(resource, output, bundleFiles, {
      tool: options.tool || "claude",
      scope: options.scope || "project",
    });
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
      const content = bundleFiles ? bundleFiles[0].content : readPinnedSourceFile(resource);
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
      bundleFiles,
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
  if (options.action === "install" && options.dryRun && bundleFiles) {
    const paths = installBundledSourceSkill(resource, target, agents, bundleFiles, {
      force: Boolean(options.force), dryRun: true, onAction: options.onAction,
    });
    output.log(`Would install ${catalogLabel(resource)} skill: ${resource.id} (${paths.join(", ")})`);
    return 0;
  }
  if ((options.json || options.offline) && options.dryRun) {
    for (const agent of agents) {
      options.onAction?.({
        action: "delegate_install", path: `${SOURCE_SKILL_DIRECTORIES[agent]}/${resource.id}/SKILL.md`,
        resource: { catalog: sourceCatalogName(resource), kind: "skill", id: resource.id },
        command: { program: "gh", args: buildSourceSkillArgs("install", resource, agent, options) },
      });
      if (!options.json) output.log(`Would install ${catalogLabel(resource)} skill: ${resource.id} for ${agent} at ${resource.source_ref}`);
    }
    output.error("Source skill installation is delegated to gh; auxiliary files and conflicts are resolved by gh at execution time.");
    return 0;
  }
  if (options.action === "preview" || options.dryRun) {
    if (options.dryRun) output.error(`Dry run: previewing the ${catalogLabel(resource)} skill; no files will be installed.`);
    const result = invokeGhSkill(buildSourceSkillArgs("preview", resource), target);
    return typeof result === "number" ? result : result.status;
  }
  if (bundleFiles) {
    const paths = installBundledSourceSkill(resource, target, agents, bundleFiles, {
      force: Boolean(options.force), onAction: options.onAction,
    });
    output.log(`Installed ${catalogLabel(resource)} skill: ${resource.id} (${paths.join(", ")})`);
    return 0;
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

module.exports = {
  buildSourceSkillArgs, readPinnedSourceFiles, readInstalledSourceSkills, readInstalledSourceResources,
  installSourceFileResource, installBundledSourceSkill, validateSourceUpdates, updateSourceResources,
  uninstallSourceResource, runGhSkill, formatSourceResource, runSourceCommand,
};
