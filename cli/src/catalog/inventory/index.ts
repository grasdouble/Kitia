"use strict";

const fs = require("node:fs");
const path = require("node:path");
const fileApi = require("./files.js");
const { targetPath } = fileApi;
const { CURRENT_INVENTORY_VERSION } = require("./version.js");
const { CatalogError, readUtf8, parseFrontmatter } = require("../resources/index.js");
const {
  INSTALL_SCAN_DIRECTORIES, USER_INSTALL_SCAN_DIRECTORIES, RESOURCE_ID, LOCK_PATH,
  SOURCE_SKILL_DIRECTORIES, rejectUnsupportedVersion,
} = require("../resources/index.js");
const CATALOG_NAME = "grasdouble/Kitia";
import { isJsonObject } from "../json.js";
import type { InstallState } from "./files.js";
import type { FileFingerprint } from "../plan.js";

function isFileFingerprint(value: unknown): value is FileFingerprint {
  return isJsonObject(value) && typeof value.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(value.sha256) && typeof value.executable === "boolean";
}


function validSourceCatalogName(name: string): boolean {
  return name.length > 0 && name === name.trim() &&
    !/[\/\\:\u0000-\u001f\u007f-\u009f]/u.test(name);
}

const SOURCE_RECORD_FIELDS = new Set(["source_repository", "source_path", "source_ref", "apply_to", "license_status", "files"]);
function collectMarkdownFiles(targetRoot, relativeDirectory, output, mode = "markdown") {
  const directory = targetPath(targetRoot, relativeDirectory, {
    allowFinalDirectorySymlink: true,
  });
  let stat;
  try {
    stat = fs.lstatSync(directory);
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (stat.isSymbolicLink()) {
    throw new CatalogError(`Refusing to inspect symbolic link: ${directory}`);
  }
  if (!stat.isDirectory()) {
    return;
  }
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (mode === "skills" && entry.isSymbolicLink()) continue;
    if (mode === "skills" && !entry.isDirectory()) continue;
    if (mode === "skill" && entry.name !== "SKILL.md") continue;
    if (entry.isSymbolicLink()) {
      const childPath = path.join(targetRoot, ...path.posix.join(relativeDirectory, entry.name).split("/"));
      throw new CatalogError(`Refusing to inspect symbolic link: ${childPath}`);
    }
    const childRelative = path.posix.join(relativeDirectory, entry.name);
    const childPath = targetPath(targetRoot, childRelative);
    if (entry.isDirectory() && mode !== "skill") {
      collectMarkdownFiles(targetRoot, childRelative, output, mode === "skills" ? "skill" : "markdown");
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      output.push(childRelative);
    }
  }
}
function collectUnmanagedSkillFiles(targetRoot, relativeDirectory, output) {
  const directory = targetPath(targetRoot, relativeDirectory);
  let stat;
  try {
    stat = fs.lstatSync(directory);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (stat.isSymbolicLink()) {
    throw new CatalogError(`Refusing to inspect symbolic link: ${directory}`);
  }
  if (!stat.isDirectory()) return;

  const skillFile = path.posix.join(relativeDirectory, "SKILL.md");
  try {
    const skillStat = fs.lstatSync(targetPath(targetRoot, skillFile));
    if (skillStat.isSymbolicLink()) throw new CatalogError(`Refusing to inspect symbolic link: ${skillFile}`);
    if (skillStat.isFile()) {
      output.push(skillFile);
      return;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    collectUnmanagedSkillFiles(targetRoot, path.posix.join(relativeDirectory, entry.name), output);
  }
}

function unmanagedArtifact(relativePath) {
  const roots: Array<[string, string[], RegExp]> = [
    ["skill", [".agents/skills/", ".claude/skills/"], /\/SKILL\.md$/i],
    ["agent", [".agents/agents/", ".claude/agents/", ".github/agents/", ".copilot/agents/"],
      /(?:\.agent)?\.md$/i],
    ["instruction", [".agents/instructions/", ".claude/rules/", ".github/instructions/"],
      /(?:\.instructions)?\.md$/i],
  ];
  for (const [kind, prefixes, suffix] of roots) {
    const prefix = prefixes.find((candidate) => relativePath.startsWith(candidate));
    if (!prefix) continue;
    const id = relativePath.slice(prefix.length).replace(suffix, "");
    return id ? { kind, id } : null;
  }
  return null;
}

function unmanagedArtifactDescription(targetRoot: string, paths: string[]): string {
  for (const relativePath of [...paths].sort()) {
    try {
      const filePath = targetPath(targetRoot, relativePath);
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink() || !stat.isFile()) continue;
      const metadata = parseFrontmatter(readUtf8(filePath, "Unmanaged artifact"), relativePath);
      const description = metadata.get("description");
      if (typeof description === "string" && description.trim()) {
        return description.trim().replace(/\s+/g, " ");
      }
    } catch {
      // Unmanaged files may not have valid frontmatter; keep scanning other locations.
    }
  }
  return paths.sort().join(", ");
}

function findUnmanagedArtifacts(targetRoot, excludedPaths: Set<string> = new Set()) {
  const scanDirectories = [
    ...Object.values(INSTALL_SCAN_DIRECTORIES),
    ...Object.values(USER_INSTALL_SCAN_DIRECTORIES),
  ];
  const directories = [...new Set(scanDirectories.flatMap((entries) =>
    Array.isArray(entries) ? entries.filter((entry): entry is string => typeof entry === "string") : [],
  ))];
  const files = [];
  for (const directory of directories) {
    if (directory.endsWith("/skills")) {
      collectUnmanagedSkillFiles(targetRoot, directory, files);
    } else {
      collectMarkdownFiles(targetRoot, directory, files);
    }
  }
  const artifacts = new Map<string, { kind: string; id: string; paths: string[] }>();
  for (const relativePath of files) {
    if (excludedPaths.has(relativePath)) continue;
    const artifact = unmanagedArtifact(relativePath);
    if (!artifact) continue;
    const key = `${artifact.kind}:${artifact.id}`;
    const paths = artifacts.get(key) || { ...artifact, paths: [] };
    paths.paths.push(relativePath);
    artifacts.set(key, paths);
  }
  return [...artifacts.values()].map((artifact) => ({
    ...artifact,
    paths: [...artifact.paths].sort(),
    description: unmanagedArtifactDescription(targetRoot, artifact.paths),
  }));
}


function readInstallState(targetRoot: string): InstallState {
  const lockFile = targetPath(targetRoot, LOCK_PATH);
  if (!fs.existsSync(lockFile)) return { lock_version: CURRENT_INVENTORY_VERSION, catalog: CATALOG_NAME, sources: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readUtf8(lockFile, "Installation state"));
  } catch (error) {
    throw new CatalogError(`Cannot read ${LOCK_PATH}: ${error.message}`);
  }
  const fail = (): never => { throw new CatalogError(`Invalid installation state in ${LOCK_PATH}; restore it from version control before continuing.`); };
  const state = isJsonObject(parsed) ? parsed : fail();
  if (state.catalog !== CATALOG_NAME) fail();
  const version = state.lock_version;
  if (typeof version === "number" && Number.isSafeInteger(version) && version > 0 && version < CURRENT_INVENTORY_VERSION) {
    throw new CatalogError(
      `Installation inventory version ${version} must be migrated before using this CLI. Run npx --yes @grasdouble/kitia migrate --apply; inventories already at the current version are skipped.`,
      "INVENTORY_MIGRATION_REQUIRED",
    );
  }
  if (version !== CURRENT_INVENTORY_VERSION) {
    rejectUnsupportedVersion(version, CURRENT_INVENTORY_VERSION,
      "Installation inventory", "UNSUPPORTED_INVENTORY_VERSION");
  }
  if (Object.keys(state).some((key) => !["lock_version", "catalog", "sources"].includes(key)) ||
      !isJsonObject(state.sources)) fail();
  const sources = state.sources;
  for (const [catalog, collectionsValue] of Object.entries(sources)) {
    if (!validSourceCatalogName(catalog) || !isJsonObject(collectionsValue)) fail();
    for (const [collection, recordsValue] of Object.entries(collectionsValue)) {
      if (!["skills", "agents", "instructions"].includes(collection)) {
        throw new CatalogError(`Source inventory contains unsupported resource collection '${collection}'. Use a compatible CLI version; do not rewrite the inventory.`, "UNSUPPORTED_RESOURCE_KIND");
      }
      if (!isJsonObject(recordsValue)) fail();
      const kind = collection.slice(0, -1);
      for (const [id, recordValue] of Object.entries(recordsValue)) {
        const record = isJsonObject(recordValue) ? recordValue : fail();
        if (Object.keys(record).some((field) => !SOURCE_RECORD_FIELDS.has(field))) fail();
        const sourcePath = record.source_path;
        const sourceParts = typeof sourcePath === "string" ? sourcePath.split("/") : [];
        const validSourcePath = typeof sourcePath === "string" && sourceParts.length > 0 && !sourcePath.startsWith("/") &&
          !sourcePath.includes("\\") && sourceParts.every((part) => part && part !== "." && part !== "..");
        const files = isJsonObject(record.files) ? record.files : fail();
        if (!RESOURCE_ID.test(id) || id.length > 64 ||
            typeof record.source_repository !== "string" ||
            !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(record.source_repository) ||
            !validSourcePath ||
            (record.source_ref !== undefined && (typeof record.source_ref !== "string" || !/^[a-f0-9]{40}$/i.test(record.source_ref))) ||
            (record.apply_to !== undefined && (!Array.isArray(record.apply_to) || record.apply_to.some((value) => typeof value !== "string"))) ||
            (record.license_status !== undefined && typeof record.license_status !== "string") ||
            !Object.keys(files).length) fail();
        const allowedPaths = kind === "skill"
          ? new Set(Object.values(SOURCE_SKILL_DIRECTORIES).map((directory) => `${directory}/${id}/SKILL.md`))
          : kind === "agent"
            ? new Set([`.claude/agents/${id}.md`, `.github/agents/${id}.agent.md`, `.copilot/agents/${id}.agent.md`])
            : new Set([`.claude/rules/${id}.md`, `.github/instructions/${id}.instructions.md`]);
        for (const [relativePath, file] of Object.entries(files)) {
          if (!allowedPaths.has(relativePath) || !isFileFingerprint(file)) fail();
          targetPath(targetRoot, relativePath);
        }
      }
    }
  }
  return state as unknown as InstallState;
}

module.exports = {
  ...fileApi, findUnmanagedArtifacts, readInstallState,
};

