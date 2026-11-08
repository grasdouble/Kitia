"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { CatalogError, isWithin, LOCK_PATH, addPlanEntry } = require("../resources/index.js");
import type { FileFingerprint, InstallPlanEntry } from "../plan.js";

export type InstallationTool = "claude" | "copilot" | "both";
export type InventoryScope = "project" | "user";

export interface SourceResourceInventoryRecord {
  source_repository: string;
  source_path: string;
  source_ref?: string;
  apply_to?: string[];
  license_status?: string;
  files: Record<string, FileFingerprint>;
}

export interface InstallState {
  lock_version: number;
  catalog: string;
  sources: Record<string, Record<string, Record<string, SourceResourceInventoryRecord>>>;
}


export interface PlanAction {
  action: string;
  path: string | null;
  resource?: { catalog: string; kind: string; id: string } | null;
  command?: { program: string; args: string[] };
}

export interface InstallPlanOptions {
  force?: boolean;
  dryRun?: boolean;
  remove?: string[];
  expectedRemovals?: Map<string, FileFingerprint | null>;
  onAction?: (action: PlanAction) => void;
}

function targetPath(targetRoot, relativePath, { allowFinalDirectorySymlink = false } = {}) {
  const parts = relativePath.split("/");
  if (path.posix.isAbsolute(relativePath) || /[\\:\0]/.test(relativePath) ||
      parts.some((part) => !part || part === ".." || part === ".")) {
    throw new CatalogError(`Unsafe installation path: ${relativePath}`);
  }
  let current = targetRoot;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code === "ENOENT") {
        current = path.join(current, ...parts.slice(index + 1));
        break;
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      if (parts[1] === "skills" && index === 2) {
        throw new CatalogError(`Refusing to use symbolic link as a managed skill directory: ${current}`);
      }
      const finalPart = index === parts.length - 1;
      if (finalPart && !allowFinalDirectorySymlink) {
        throw new CatalogError(`Refusing to replace symbolic link: ${current}`);
      }
      try {
        current = fs.realpathSync(current);
        stat = fs.statSync(current);
      } catch (error) {
        throw new CatalogError(`Cannot resolve installation symlink ${current}: ${error.message}`);
      }
      if (!isWithin(current, targetRoot)) {
        throw new CatalogError(`Installation symlink escapes target directory: ${relativePath}`);
      }
      if (!stat.isDirectory()) {
        throw new CatalogError(`Installation symlink must point to a directory: ${current}`);
      }
    }
    if (index < parts.length - 1 && !stat.isDirectory()) {
      throw new CatalogError(`Installation path is blocked by a non-directory: ${current}`);
    }
  }
  if (!isWithin(current, targetRoot)) {
    throw new CatalogError(`Installation path escapes target directory: ${relativePath}`);
  }
  return current;
}

function fileFingerprint(content: Buffer, executable: boolean): FileFingerprint {
  return { sha256: crypto.createHash("sha256").update(content).digest("hex"), executable };
}

function installedFingerprint(targetRoot: string, relativePath: string): FileFingerprint | null {
  const absolutePath = targetPath(targetRoot, relativePath);
  let stat;
  try {
    stat = fs.lstatSync(absolutePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  if (!stat.isFile()) {
    throw new CatalogError(`Managed path is not a regular file: ${relativePath}`);
  }
  return fileFingerprint(fs.readFileSync(absolutePath), Boolean(stat.mode & 0o111));
}

function sameFingerprint(left: FileFingerprint | null, right: FileFingerprint | null): boolean | null {
  return left && right && left.sha256 === right.sha256 &&
    (process.platform === "win32" || left.executable === right.executable);
}

function inspectInstalledFiles(targetRoot: string, record: { files: Record<string, FileFingerprint> }) {
  const missing = [];
  const modified = [];
  for (const [relativePath, expected] of Object.entries(record.files)) {
    const actual = installedFingerprint(targetRoot, relativePath);
    if (!actual) {
      missing.push(relativePath);
    } else if (!sameFingerprint(actual, expected)) {
      modified.push(relativePath);
    }
  }
  return { missing, modified };
}

function trackedPaths(state: InstallState) {
  return new Set(Object.values(state.sources).flatMap((collections) =>
    Object.values(collections).flatMap((records) =>
      Object.values(records).flatMap((record) => Object.keys(record.files)),
    ),
  ));
}

function writeInstallPlan(
  plan: Map<string, InstallPlanEntry>,
  target: string,
  {
    force = false,
    dryRun = false,
    remove = [],
    expectedRemovals,
    onAction = () => {},
  }: InstallPlanOptions = {},
) {
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new CatalogError(`Target must be an existing directory: ${target}`);
  }
  const targetRoot = fs.realpathSync(target);
  const actions = [];
  const conflicts = [];

  for (const relativePath of remove) {
    if (plan.has(relativePath)) {
      throw new CatalogError(`Cannot both install and remove ${relativePath}`);
    }
    const actual = installedFingerprint(targetRoot, relativePath);
    if (expectedRemovals?.has(relativePath) && !equalOptionalFingerprint(actual, expectedRemovals.get(relativePath))) {
      throw new CatalogError(`File changed while preparing removal: ${relativePath}. Retry after reviewing it.`, "LOCAL_CONFLICT");
    }
    if (actual) {
      actions.push(["remove", relativePath, null]);
    }
  }
  for (const [relativePath, file] of [...plan.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const { content, executable } = file;
    const destination = targetPath(targetRoot, relativePath);
    const current = installedFingerprint(targetRoot, relativePath);
    const hasExpected = Object.hasOwn(file, "expected");
    if (hasExpected && !equalOptionalFingerprint(current, file.expected)) {
      throw new CatalogError(`File changed while preparing the operation: ${relativePath}. Retry after reviewing it.`, "LOCAL_CONFLICT");
    }
    let stat;
    try {
      stat = fs.lstatSync(destination);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
    if (!stat) {
      actions.push(["install", relativePath, file]);
    } else if (stat.isSymbolicLink()) {
      throw new CatalogError(`Refusing to replace symbolic link: ${destination}`);
    } else if (!stat.isFile()) {
      throw new CatalogError(`Installation destination is not a file: ${destination}`);
    } else if (sameFingerprint(current, fileFingerprint(content, executable))) {
      actions.push(["unchanged", relativePath, file]);
    } else if (force || (hasExpected && file.expected !== null)) {
      actions.push(["overwrite", relativePath, file]);
    } else {
      conflicts.push(relativePath);
      actions.push(["conflict", relativePath, file]);
    }
  }

  if (conflicts.length) {
    throw new CatalogError(
      `Refusing to overwrite existing files:\n${conflicts.map((item) => `  ${item}`).join("\n")}\nPass --force to replace them.`,
      "LOCAL_CONFLICT",
    );
  }

  const messages = actions.map(([action, relativePath]) => {
    const verb =
      action === "remove"
        ? dryRun ? "Would remove" : "Removed"
        : action === "install"
        ? dryRun
          ? "Would install"
          : "Installed"
        : action === "overwrite"
          ? dryRun
            ? "Would overwrite"
            : "Overwrote"
          : "Unchanged";
    return `${verb}: ${relativePath}`;
  });
  if (dryRun) {
    for (const [action, relativePath] of actions) {
      onAction({ action, path: relativePath });
    }
    return messages;
  }
  // Publish the new inventory only after resource writes and removals succeed.
  actions.sort(([leftAction, left], [rightAction, right]) =>
    (left === LOCK_PATH ? 2 : leftAction === "remove" ? 1 : 0) -
    (right === LOCK_PATH ? 2 : rightAction === "remove" ? 1 : 0));
  const staged = [];
  const changed = [];
  try {
    for (const [action, relativePath, file] of actions) {
      if (action === "unchanged") continue;
      const destination = targetPath(targetRoot, relativePath);
      const previous = action === "install" ? null : {
        content: fs.readFileSync(destination),
        mode: fs.statSync(destination).mode & 0o777,
      };
      if (action === "remove") {
        staged.push({ action, destination, previous });
        continue;
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      targetPath(targetRoot, relativePath);
      const temporaryPath = path.join(
        path.dirname(destination),
        `.${path.basename(destination)}.catalog-${process.pid}-${crypto.randomUUID()}`,
      );
      const mode = file.mode ?? (file.executable ? 0o755 : 0o644);
      staged.push({ action, destination, temporaryPath, previous });
      fs.writeFileSync(temporaryPath, file.content, { flag: "wx", mode });
      if (process.platform !== "win32") fs.chmodSync(temporaryPath, mode);
    }
    for (const item of staged) {
      if (item.action === "remove") fs.unlinkSync(item.destination);
      else fs.renameSync(item.temporaryPath, item.destination);
      changed.push(item);
    }
  } catch (error) {
    for (const item of changed.reverse()) {
      if (!item.previous) {
        fs.unlinkSync(item.destination);
      } else if (item.action === "remove") {
        fs.writeFileSync(item.destination, item.previous.content, { mode: item.previous.mode });
      } else {
        const restorePath = path.join(
          path.dirname(item.destination),
          `.${path.basename(item.destination)}.catalog-restore-${process.pid}-${crypto.randomUUID()}`,
        );
        fs.writeFileSync(restorePath, item.previous.content, { flag: "wx", mode: item.previous.mode });
        fs.renameSync(restorePath, item.destination);
      }
    }
    throw error;
  } finally {
    for (const item of staged) {
      if (!item.temporaryPath) continue;
      try {
        fs.unlinkSync(item.temporaryPath);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  return messages;
}

function equalOptionalFingerprint(left: FileFingerprint | null, right: FileFingerprint | null): boolean {
  return !left && !right || Boolean(sameFingerprint(left, right));
}

function addInventoryStateToPlan(plan: Map<string, InstallPlanEntry>, state: InstallState) {
  addPlanEntry(plan, LOCK_PATH, Buffer.from(`${JSON.stringify(state, null, 2)}\n`));
}


module.exports = {
  targetPath, fileFingerprint, installedFingerprint, sameFingerprint, inspectInstalledFiles,
  trackedPaths, writeInstallPlan, addInventoryStateToPlan,
};
