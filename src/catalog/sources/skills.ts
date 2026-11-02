"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync, execFileSync } = require("node:child_process");
const {
  CatalogError, SOURCE_SKILL_DIRECTORIES, LOCK_PATH, addPlanEntry,
} = require("../resources/index.js");
const {
  targetPath, readInstallState, installedFingerprint, sameFingerprint, writeInstallPlan,
  addInventoryStateToPlan,
} = require("../inventory/index.js");
const { loadSourceCatalogsFromDirectory, loadPublishedSourceCatalogs } = require("./loader.js");
const { loadSourceConfiguration } = require("./config.js");
const {
  sourceCatalogName, sourceSkillKey, sourceSkillRecords, sourceSkillRecord,
  removeSourceSkillRecord, readInstalledSourceSkills, recordSourceInstallation,
  removeSourceResourceRecord, readInstalledSourceResources,
  recordSourceResourceInstallation,
} = require("./installed.js");
import type {
  CatalogResource, CliOptions, InstallState, InstalledSourceResource, PlanAction,
} from "../../types.js";

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
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kiti-source-file-"));
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
    scope = "project", force = false, dryRun = false, onAction = () => {}, destinations: requestedDestinations,
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
  const plan = new Map();
  for (const relativePath of destinations) {
    targetPath(targetRoot, relativePath);
    if (!dryRun) addPlanEntry(plan, relativePath, materializeSourceFile(resource, content, relativePath));
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
  if (state.resources[`${resource.kind}:${resource.id}`]) {
    throw new CatalogError(`${resource.kind} ID '${resource.id}' is already installed from the internal catalog.`, "LOCAL_CONFLICT");
  }
  for (const [catalog, collections] of Object.entries(state.sources || {})) {
    if (catalog !== sourceCatalogName(resource) && collections[`${resource.kind}s`]?.[resource.id]) {
      throw new CatalogError(`${resource.kind}:${resource.id} is already tracked from another source catalog.`, "LOCAL_CONFLICT");
    }
  }
}

function assertSourceSkillCanBeInstalled(resource: CatalogResource, target: string): void {
  const state = readInstallState(target);
  const key = sourceSkillKey(resource);
  const anotherSource = [...sourceSkillRecords(state).keys()].some((installedKey) =>
    installedKey !== key && installedKey.endsWith(`:${resource.id}`));
  if (state.resources[`skill:${resource.id}`] || anotherSource) {
    throw new CatalogError(
      `Skill ID '${resource.id}' is already tracked from another catalog in this target; remove it before installing from ${catalogLabel(resource)}.`,
      "LOCAL_CONFLICT",
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

function validateSourceUpdates(installed: InstalledSourceResource[], { force = false }: { force?: boolean } = {}): void {
  for (const { resource, installations, removed } of installed) {
    if (removed) {
      throw new CatalogError(`${catalogLabel(resource)} ${resource.kind} ${resource.id} was removed from the catalog. Use uninstall to remove it explicitly.`);
    }
    const modified = installations.filter((installation) => installation.modified);
    if (modified.length && !force) {
      throw new CatalogError(`Refusing to overwrite locally modified ${catalogLabel(resource)} ${resource.kind} files: ${modified.map((entry) => entry.path).join(", ")}. Review them and pass --force.`, "LOCAL_CONFLICT");
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
      throw new CatalogError(`Refusing to overwrite locally modified ${catalogLabel(resource)} ${resource.kind} files: ${modified.map((item) => item.path).join(", ")}. Pass --force.`, "LOCAL_CONFLICT");
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
  invokeGhSkill?: (args: string[], cwd: string) => number,
): string[] {
  invokeGhSkill ||= (args, cwd) => runGhSkill(args, cwd, spawnSync, { nonInteractive });
  const targetRoot = fs.realpathSync(target);
  const installOptions = { force, scope, target: targetRoot };
  const fileResources = installed.filter(({ resource }) => resource.kind !== "skill");
  const fileMessages = updateSourceFileResources(fileResources, target, { dryRun, force, onAction, scope });
  installed = installed.filter(({ resource }) => resource.kind === "skill");
  const messages = [...fileMessages];
  let hasUpdates = false;
  validateSourceUpdates(installed, { force });
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
      const status = invokeGhSkill(
        buildSourceSkillArgs("install", resource, installation.agent, installOptions),
        targetRoot,
      );
      if (status !== 0) {
        const partial = completed.length
          ? `; already updated for ${completed.join(", ")}`
          : "";
        throw new CatalogError(
          `Could not update ${catalogLabel(resource)} skill ${resource.id} for ${installation.agent} (gh exited with status ${status}${partial}).`,
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
    throw new CatalogError(`Refusing to remove locally modified ${catalogLabel(resource)} ${resource.kind} files: ${modified.map((item) => item.path).join(", ")}. Pass --force.`, "LOCAL_CONFLICT");
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
  const plan = new Map();
  addInventoryStateToPlan(plan, state);
  writeInstallPlan(plan, targetRoot, { force: true, remove: paths });
  return paths.length ? paths.map((relativePath) => `Removed ${catalogLabel(resource)} ${resource.kind}: ${relativePath}`)
    : [`Forgot missing ${catalogLabel(resource)} ${resource.kind}: ${resource.id}`];
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
  const paths = installed.installations.filter((entry) => !entry.missing)
    .map(({ path: relativePath }) => relativePath);
  const state: InstallState = readInstallState(targetRoot);
  const record = sourceSkillRecord(state, sourceCatalogName(resource), resource.id);
  const matchingRecord = record &&
    record.source_repository === resource.source_repository &&
    record.source_path === resource.source_path
    ? record
    : null;
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
      const skillDirectory = path.dirname(targetPath(targetRoot, relativePath));
      if (fs.readdirSync(skillDirectory).some((entry) => entry !== "SKILL.md")) {
        messages.push(
          `Would preserve additional contents in: ${path.relative(targetRoot, skillDirectory).split(path.sep).join("/")}`,
        );
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
    if (record) onAction({ action: "overwrite", path: LOCK_PATH });
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

  if (record) {
    removeSourceSkillRecord(state, resource);
    const plan = new Map();
    addInventoryStateToPlan(plan, state);
    writeInstallPlan(plan, targetRoot, { force: true, remove: paths });
  }
  const messages = [];
  if (!paths.length) {
    messages.push(`Forgot missing ${catalogLabel(resource)} skill: ${resource.id}`);
  }
  for (const relativePath of paths) {
    const skillFile = targetPath(targetRoot, relativePath);
    if (!record) {
      const stat = fs.lstatSync(skillFile);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new CatalogError(`Refusing to remove non-regular ${catalogLabel(resource)} skill file: ${relativePath}`);
      }
      fs.unlinkSync(skillFile);
    }
    messages.push(`Removed ${catalogLabel(resource)} skill entry point: ${relativePath}`);
    const skillDirectory = path.dirname(skillFile);
    const directoryStat = fs.lstatSync(skillDirectory);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      throw new CatalogError(`Refusing to remove non-directory ${catalogLabel(resource)} skill path: ${skillDirectory}`);
    }
    fs.rmSync(skillDirectory, { recursive: true });
    messages.push(
      `Removed ${catalogLabel(resource)} skill directory: ${path.relative(targetRoot, skillDirectory).split(path.sep).join("/")}`,
    );
  }
  return messages;
}

function runGhSkill(
  args: string[],
  cwd = process.cwd(),
  spawn: any = spawnSync,
  { nonInteractive = false }: { nonInteractive?: boolean } = {},
): number {
  const result = spawn("gh", args, {
    cwd, stdio: nonInteractive ? ["ignore", "inherit", "inherit"] : "inherit",
    ...(nonInteractive ? { env: { ...process.env, GH_PROMPT_DISABLED: "1" } } : {}),
  });
  if (result.error) {
    throw new CatalogError(`Cannot run 'gh ${args.join(" ")}': ${result.error.message}`);
  }
  return result.status ?? 1;
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

function runSourceCommand(
  options: CliOptions,
  catalogRoot: string,
  invokeGhSkill?: (args: string[], cwd: string) => number,
): number {
  invokeGhSkill ||= (args, cwd) => runGhSkill(args, cwd, spawnSync, options);
  const output = options.output || console;
  const catalog = options.catalog || "source";
  let sourceResources: CatalogResource[] = options.sourceResources || [];
  if (!options.resource && !sourceResources.length) {
    const configuredSources = loadSourceConfiguration(catalogRoot);
    if (process.env.KITI_SOURCE_CATALOGS) {
      if (options.refreshCatalog) {
        throw new CatalogError("--refresh-catalog cannot be combined with KITI_SOURCE_CATALOGS", "INVALID_ARGUMENT");
      }
      sourceResources = loadSourceCatalogsFromDirectory(
        process.env.KITI_SOURCE_CATALOGS,
        configuredSources,
      );
    } else {
      sourceResources = loadPublishedSourceCatalogs(options, undefined, spawnSync, configuredSources);
    }
  }
  const resource = options.resource
    ? { ...options.resource, catalog: options.resource.catalog || catalog }
    : sourceResources.find((entry) => entry.catalog === catalog && entry.id === options.id &&
      (!options.kind || entry.kind === options.kind));
  if (!resource) {
    throw new CatalogError(`${catalog} resource not found: ${options.id}`);
  }
  if (options.offline && (options.action === "preview" || !options.dryRun)) {
    throw new CatalogError("Source resource preview and installation require network access. Use an installation --dry-run --json plan while offline.", "INVALID_ARGUMENT");
  }
  options.onResource?.({ catalog: sourceCatalogName(resource), kind: resource.kind, id: resource.id, status: "planned" });

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
    });
    output.log(`${options.dryRun ? "Would install" : "Installed"} ${catalogLabel(resource)} ${resource.kind}: ${resource.id}${options.dryRun ? ` at ${resource.source_ref}` : ""} (${paths.join(", ")})`);
    return 0;
  }
  if (options.action === "install" && options.scope === "user") {
    const agents = options.tool === "both" ? ["github-copilot", "claude-code"]
      : [options.tool === "claude" ? "claude-code" : "github-copilot"];
    for (const agent of agents) {
      targetPath(target, `${SOURCE_SKILL_DIRECTORIES[agent]}/${resource.id}/SKILL.md`);
    }
  }
  if ((options.json || options.offline) && options.dryRun) {
    const agents = options.tool === "both" ? ["github-copilot", "claude-code"]
      : [options.tool === "claude" ? "claude-code" : "github-copilot"];
    for (const agent of agents) {
      options.onAction?.({
        action: "delegate_install", path: `${SOURCE_SKILL_DIRECTORIES[agent]}/${resource.id}/SKILL.md`,
        resource: { catalog: sourceCatalogName(resource), kind: "skill", id: resource.id },
        command: { program: "gh", args: buildSourceSkillArgs("install", resource, agent, options) },
      });
      if (!options.json) {
        output.log(`Would install ${catalogLabel(resource)} skill: ${resource.id} for ${agent} at ${resource.source_ref}`);
      }
    }
    output.error("Source skill installation is delegated to gh; auxiliary files and conflicts are resolved by gh at execution time.");
    return 0;
  }
  if (options.action === "preview" || options.dryRun) {
    if (options.dryRun) {
      output.error(`Dry run: previewing the ${catalogLabel(resource)} skill; no files will be installed.`);
    }
    return invokeGhSkill(buildSourceSkillArgs("preview", resource), target);
  }

  const agents = options.tool === "both"
    ? ["github-copilot", "claude-code"]
    : [options.tool === "copilot" ? "github-copilot" : "claude-code"];
  const completed = [];
  for (const agent of agents) {
    const status = invokeGhSkill(
      buildSourceSkillArgs("install", resource, agent, options),
      target,
    );
    if (status !== 0) {
      if (completed.length) {
        output.error(
          `The skill was already installed for ${completed.join(", ")}, but installation for ${agent} failed.`,
        );
      }
      return status;
    }
    recordSourceInstallation(resource, target, agent);
    completed.push(agent);
  }
  return 0;
}

module.exports = {
  buildSourceSkillArgs, readInstalledSourceSkills, readInstalledSourceResources,
  installSourceFileResource, validateSourceUpdates, updateSourceResources,
  uninstallSourceResource, runGhSkill, formatSourceResource, runSourceCommand,
};
