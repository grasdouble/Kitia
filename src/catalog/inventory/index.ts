"use strict";

const fs = require("node:fs");
const path = require("node:path");
const fileApi = require("./files.js");
const { targetPath } = fileApi;
const { CURRENT_INVENTORY_VERSION } = require("./version.js");
const {
  CatalogError, readUtf8, parseFrontmatter, CATALOG_NAME,
  INSTALL_SCAN_DIRECTORIES, USER_INSTALL_SCAN_DIRECTORIES, RESOURCE_ID, TOOLS, LOCK_PATH, MCP_DIRECTORY,
  SOURCE_SKILL_DIRECTORIES,
  INSTALLABLE_KINDS, rejectUnsupportedVersion, mcpConfigPaths,
} = require("../resources/index.js");
const { parseInjectedMetadata } = require("../resources/files.js");
import { isJsonObject } from "../json.js";
import type { JsonObject } from "../json.js";
import type { InstallState, McpConfigurationRecord } from "./files.js";
import type { FileFingerprint } from "../plan.js";

function isFileFingerprint(value: unknown): value is FileFingerprint {
  return isJsonObject(value) && typeof value.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(value.sha256) && typeof value.executable === "boolean";
}

function isMcpConfigurationRecord(value: unknown): value is McpConfigurationRecord {
  return isJsonObject(value) && typeof value.managed === "boolean" &&
    (!value.managed || typeof value.sha256 === "string" && /^[a-f0-9]{64}$/.test(value.sha256));
}

const SOURCE_COLLECTIONS = new Set(["skills", "agents", "instructions", "bundles", "mcps"]);

function validSourceCatalogName(name: string): boolean {
  return name.length > 0 && name === name.trim() &&
    !/[\/\\:\u0000-\u001f\u007f-\u009f]/u.test(name);
}

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


function findInstalledProvenance(
  targetRoot,
  trackedFiles = new Set(),
  runtimes = ["claude", "copilot"],
  { scope = "project" } = {},
) {
  const files = [];
  const scanDirectories = scope === "user" ? USER_INSTALL_SCAN_DIRECTORIES : INSTALL_SCAN_DIRECTORIES;
  const directories = [...new Set(runtimes.flatMap((runtime) =>
    scanDirectories[runtime] || [],
  ))];
  for (const directory of directories) {
    collectMarkdownFiles(targetRoot, directory, files, directory.endsWith("/skills") ? "skills" : "markdown");
  }

  const installed = new Map();
  for (const relativePath of files) {
    if (trackedFiles.has(relativePath)) {
      continue;
    }
    if (
      relativePath.includes("/skills/") &&
      path.posix.basename(relativePath) !== "SKILL.md"
    ) {
      continue;
    }
    const absolutePath = path.join(targetRoot, ...relativePath.split("/"));
    const provenance = parseInjectedMetadata(absolutePath);
    if (provenance["catalog-name"] !== CATALOG_NAME) {
      continue;
    }
    const key = provenance["catalog-resource"];
    if (
      typeof key !== "string" ||
      !/^(skill|agent|instruction):[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) ||
      typeof provenance["catalog-commit"] !== "string" ||
      !/^[0-9a-f]{40}$/i.test(provenance["catalog-commit"]) ||
      typeof provenance["catalog-content-sha256"] !== "string" ||
      !/^[0-9a-f]{64}$/i.test(provenance["catalog-content-sha256"]) ||
      !["shared", "claude", "copilot"].includes(provenance["catalog-runtime"])
    ) {
      throw new CatalogError(`Invalid catalog provenance in ${relativePath}`);
    }
    if (!resourceOwnsPath(key, relativePath)) {
      throw new CatalogError(`Catalog provenance does not match its file path: ${relativePath}`);
    }
    const entries = installed.get(key) || [];
    entries.push({ ...provenance, path: relativePath });
    installed.set(key, entries);
  }
  return installed;
}

function resourceOwnsPath(key, relativePath) {
  const [kind, id] = key.split(":");
  if (kind === "mcp") return relativePath === `${MCP_DIRECTORY}/${id}.cjs`;
  if (kind === "skill") {
    return [`.agents/skills/${id}/`, `.claude/skills/${id}/`]
      .some((prefix) => relativePath.startsWith(prefix));
  }
  const candidates = kind === "agent"
    ? [`.agents/agents/${id}.md`, `.claude/agents/${id}.md`, `.github/agents/${id}.agent.md`,
      `.copilot/agents/${id}.agent.md`, `.copilot/agents/${id}.md`]
    : kind === "instruction"
      ? [`.agents/instructions/${id}.md`, `.claude/rules/${id}.md`, `.github/instructions/${id}.instructions.md`]
      : [];
  return candidates.includes(relativePath);
}

function isUserResource(key: string, record: unknown) {
  const [kind] = key.split(":");
  const inventory = isJsonObject(record) ? record : {};
  const files = isJsonObject(inventory.files) ? inventory.files : {};
  return kind === "skill" || (kind === "agent" && Object.keys(files).every((relativePath) =>
    relativePath.startsWith(".claude/agents/") || relativePath.startsWith(".copilot/agents/")));
}
function readInstallState(targetRoot: string): InstallState {
  const lockFile = targetPath(targetRoot, LOCK_PATH);
  if (!fs.existsSync(lockFile)) {
    return {
      lock_version: CURRENT_INVENTORY_VERSION, catalog: CATALOG_NAME, resources: {}, sources: {},
      bundles: {}, mcps: {},
    };
  }
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
  if (typeof version === "number" && Number.isSafeInteger(version) &&
      version > 0 && version < CURRENT_INVENTORY_VERSION) {
    throw new CatalogError(
      `Installation inventory version ${version} must be migrated before using this CLI. Run npx --yes github:grasdouble/Kitia migrate --apply; inventories already at the current version are skipped.`,
      "INVENTORY_MIGRATION_REQUIRED",
    );
  }
  if (version !== CURRENT_INVENTORY_VERSION) {
    rejectUnsupportedVersion(
      version, CURRENT_INVENTORY_VERSION,
      "Installation inventory", "UNSUPPORTED_INVENTORY_VERSION",
    );
  }
  if (state.lock_version !== CURRENT_INVENTORY_VERSION ||
      state.catalog !== CATALOG_NAME ||
      Object.keys(state).some((key) =>
        !["lock_version", "catalog", "resources", "sources", "bundles", "mcps"].includes(key)) ||
      !isJsonObject(state.resources) || !isJsonObject(state.sources)) {
    fail();
  }
  const resources = isJsonObject(state.resources) ? state.resources : fail();
  const sources = isJsonObject(state.sources) ? state.sources : fail();
  for (const [key, recordValue] of Object.entries(resources)) {
    const identity = key.match(/^([a-z0-9]+(?:-[a-z0-9]+)*):([a-z0-9]+(?:-[a-z0-9]+)*)$/);
    if (identity && !INSTALLABLE_KINDS.has(identity[1])) {
      throw new CatalogError(
        `Installation inventory contains unsupported resource kind '${identity[1]}'. Use a compatible CLI version; the inventory and its files must not be rewritten or deleted.`,
        "UNSUPPORTED_RESOURCE_KIND",
      );
    }
    const record = isJsonObject(recordValue) ? recordValue : fail();
    const files = isJsonObject(record.files) ? record.files : fail();
    if (!/^(skill|agent|instruction):[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) ||
        typeof record.tool !== "string" || !TOOLS.has(record.tool) ||
        typeof record.digest !== "string" || !/^[a-f0-9]{64}$/.test(record.digest) ||
        typeof record.commit !== "string" || !/^[a-f0-9]{40}$/i.test(record.commit) ||
        typeof record.version !== "string" || !Object.keys(files).length) {
      fail();
    }
    for (const [relativePath, file] of Object.entries(files)) {
      if (!resourceOwnsPath(key, relativePath) || !isFileFingerprint(file)) fail();
      targetPath(targetRoot, relativePath);
    }
  }
  for (const [catalog, collectionsValue] of Object.entries(sources)) {
    if (!validSourceCatalogName(catalog) || !isJsonObject(collectionsValue)) fail();
    for (const [collection, recordsValue] of Object.entries(collectionsValue)) {
      if (!SOURCE_COLLECTIONS.has(collection)) {
        throw new CatalogError(
          `Source inventory contains unsupported resource collection '${collection}'. Use a compatible CLI version; do not rewrite the inventory.`,
          "UNSUPPORTED_RESOURCE_KIND",
        );
      }
      if (!isJsonObject(recordsValue)) fail();
      const kind = collection.slice(0, -1);
      if (!["skill", "agent", "instruction"].includes(kind)) {
        if (Object.keys(recordsValue).length) {
          throw new CatalogError(
            `Source inventory contains unsupported resource collection '${collection}'. Use a compatible CLI version; do not rewrite the inventory.`,
            "UNSUPPORTED_RESOURCE_KIND",
          );
        }
        continue;
      }
      for (const [id, recordValue] of Object.entries(recordsValue)) {
        const record = isJsonObject(recordValue) ? recordValue : fail();
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
  validateBundleState(state, targetRoot, fail);
  return state as unknown as InstallState;
}


function validateBundleState(state: JsonObject, targetRoot: string, fail: () => never) {
  const resources = isJsonObject(state.resources) ? state.resources : fail();
  const bundleRecords = isJsonObject(state.bundles) ? state.bundles : fail();
  const mcpRecords = isJsonObject(state.mcps) ? state.mcps : fail();
  for (const recordValue of Object.values(resources)) {
    const record = isJsonObject(recordValue) ? recordValue : fail();
    if (typeof record.standalone !== "boolean") fail();
  }
  for (const [id, recordValue] of Object.entries(bundleRecords)) {
    const record = isJsonObject(recordValue) ? recordValue : fail();
    const members = Array.isArray(record.resources) ? record.resources : fail();
    for (const memberValue of members) {
      if (isJsonObject(memberValue) && typeof memberValue.kind === "string" && RESOURCE_ID.test(memberValue.kind) &&
          ![...INSTALLABLE_KINDS, "mcp"].includes(memberValue.kind)) {
        throw new CatalogError(`Bundle inventory contains unsupported resource kind '${memberValue.kind}'. Use a compatible CLI version; do not rewrite the inventory.`, "UNSUPPORTED_RESOURCE_KIND");
      }
    }
    if (!RESOURCE_ID.test(id) || typeof record.tool !== "string" || !TOOLS.has(record.tool) ||
        typeof record.scope !== "string" || !["project", "user"].includes(record.scope) ||
        typeof record.digest !== "string" || !/^[a-f0-9]{64}$/.test(record.digest) || !members.length) fail();
    const identities = new Set<string>();
    for (const memberValue of members) {
      const member = isJsonObject(memberValue) ? memberValue : fail();
      if (Object.keys(member).sort().join(",") !== "catalog,id,kind" ||
          !RESOURCE_ID.test(String(member.id)) ||
          !(member.catalog === "internal" && typeof member.kind === "string" && INSTALLABLE_KINDS.has(member.kind) ||
            ["internal", "external"].includes(member.catalog as string) && member.kind === "mcp")) fail();
      const identity = `${member.kind === "mcp" ? "internal" : member.catalog}:${member.kind}:${member.id}`;
      if (identities.has(identity)) fail();
      identities.add(identity);
      const resourceKey = `${member.kind}:${member.id}`;
      if (member.kind === "mcp" ? !Object.hasOwn(mcpRecords, String(member.id))
        : !Object.hasOwn(resources, resourceKey)) fail();
      if (member.kind !== "mcp") {
        const dependency = isJsonObject(resources[resourceKey]) ? resources[resourceKey] : fail();
        if (record.scope === "user" && !isUserResource(resourceKey, dependency)) fail();
        if (record.tool === "both" ? dependency.tool !== "both"
          : dependency.tool !== "both" && dependency.tool !== record.tool) fail();
      }
    }
  }
  for (const [id, recordValue] of Object.entries(mcpRecords)) {
    const record = isJsonObject(recordValue) ? recordValue : fail();
    const values = isJsonObject(record.values) ? record.values : fail();
    const configurations = isJsonObject(record.configurations) ? record.configurations : fail();
    const files = isJsonObject(record.files) ? record.files : fail();
    if (!RESOURCE_ID.test(id) || typeof record.server !== "string" || !/^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/.test(record.server) ||
        typeof record.digest !== "string" || !/^[a-f0-9]{64}$/.test(record.digest) ||
        Object.entries(values).some(([name, value]) => !/^[a-z][a-z0-9_]*$/.test(name) || typeof value !== "string") ||
        !Object.keys(configurations).length ||
        (record.standalone !== undefined && typeof record.standalone !== "boolean") ||
        (record.tool !== undefined && (typeof record.tool !== "string" || !TOOLS.has(record.tool))) ||
        (record.scope !== undefined && (typeof record.scope !== "string" || !["project", "user"].includes(record.scope))) ||
        (record.standalone && (typeof record.tool !== "string" || !TOOLS.has(record.tool) ||
          typeof record.scope !== "string" || !["project", "user"].includes(record.scope)))) fail();
    for (const [relativePath, config] of Object.entries(configurations)) {
      if (![".mcp.json", ".claude.json", ".copilot/mcp-config.json"].includes(relativePath) ||
          !isMcpConfigurationRecord(config)) fail();
      targetPath(targetRoot, relativePath);
    }
    for (const [relativePath, file] of Object.entries(files)) {
      if (relativePath !== `${MCP_DIRECTORY}/${id}.cjs` || !isFileFingerprint(file)) fail();
      targetPath(targetRoot, relativePath);
    }
    const referencedByBundle = Object.values(bundleRecords).some((bundleValue) => {
      if (!isJsonObject(bundleValue) || !Array.isArray(bundleValue.resources)) return false;
      return bundleValue.resources.some((memberValue) =>
        isJsonObject(memberValue) && memberValue.kind === "mcp" && memberValue.id === id);
    });
    if (!record.standalone && !referencedByBundle) fail();
    if (record.standalone && typeof record.tool === "string" && typeof record.scope === "string" &&
        mcpConfigPaths(record.tool, record.scope).some((relativePath) => !Object.hasOwn(configurations, relativePath))) fail();
  }
  for (const bundleValue of Object.values(bundleRecords)) {
    const bundle = isJsonObject(bundleValue) ? bundleValue : fail();
    const members = Array.isArray(bundle.resources) ? bundle.resources : fail();
    for (const memberValue of members) {
      if (!isJsonObject(memberValue) || memberValue.kind !== "mcp") continue;
      const mcpRecordValue = mcpRecords[String(memberValue.id)];
      const mcpRecord = isJsonObject(mcpRecordValue) ? mcpRecordValue : fail();
      const configurations = isJsonObject(mcpRecord.configurations) ? mcpRecord.configurations : fail();
      if (typeof bundle.tool !== "string" || typeof bundle.scope !== "string") fail();
      const paths = mcpConfigPaths(bundle.tool, bundle.scope);
      if (paths.some((relativePath) => !Object.hasOwn(configurations, relativePath))) fail();
    }
  }
}

module.exports = {
  ...fileApi, findInstalledProvenance, findUnmanagedArtifacts, readInstallState, resourceOwnsPath, isUserResource,
};
