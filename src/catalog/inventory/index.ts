"use strict";

const fs = require("node:fs");
const path = require("node:path");
const fileApi = require("./files.js");
const { targetPath } = fileApi;
const { CURRENT_INVENTORY_VERSION } = require("./version.js");
const {
  CatalogError, readUtf8, CATALOG_NAME,
  INSTALL_SCAN_DIRECTORIES, USER_INSTALL_SCAN_DIRECTORIES, RESOURCE_ID, TOOLS, LOCK_PATH, MCP_DIRECTORY,
  SOURCE_SKILL_DIRECTORIES,
  INSTALLABLE_KINDS, rejectUnsupportedVersion, mcpConfigPaths,
} = require("../resources/index.js");
const { parseInjectedMetadata } = require("../resources/files.js");
import type { InstallState, JsonRecord } from "../../types.js";

const SOURCE_COLLECTIONS = new Set(["skills", "agents", "instructions", "bundles", "mcps"]);
function validSourceCatalogName(name: string): boolean {
  return name.length > 0 && name === name.trim() &&
    !/[\/\\:\u0000-\u001f\u007f-\u009f]/u.test(name) &&
    name.toUpperCase() !== "INTERNAL";
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
  return [...artifacts.values()];
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

function isUserResource(key: string, record: JsonRecord) {
  const [kind] = key.split(":");
  return kind === "skill" || (kind === "agent" && Object.keys(record.files).every((relativePath) =>
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
  let state: InstallState;
  try {
    state = JSON.parse(readUtf8(lockFile, "Installation state")) as InstallState;
  } catch (error) {
    throw new CatalogError(`Cannot read ${LOCK_PATH}: ${error.message}`);
  }
  const fail = (): never => { throw new CatalogError(`Invalid installation state in ${LOCK_PATH}; restore it from version control before continuing.`); };
  if (!state || Array.isArray(state) || state.catalog !== CATALOG_NAME) fail();
  if (Number.isSafeInteger(state.lock_version) &&
      state.lock_version > 0 && state.lock_version < CURRENT_INVENTORY_VERSION) {
    throw new CatalogError(
      `Installation inventory version ${state.lock_version} must be migrated before using this CLI. Run npx --yes github:grasdouble/Kiti migrate --apply; inventories already at the current version are skipped.`,
      "INVENTORY_MIGRATION_REQUIRED",
    );
  }
  if (state.lock_version !== CURRENT_INVENTORY_VERSION) {
    rejectUnsupportedVersion(
      state.lock_version, CURRENT_INVENTORY_VERSION,
      "Installation inventory", "UNSUPPORTED_INVENTORY_VERSION",
    );
  }
  if (!state || state.lock_version !== CURRENT_INVENTORY_VERSION ||
      state.catalog !== CATALOG_NAME ||
      Object.keys(state).some((key) =>
        !["lock_version", "catalog", "resources", "sources", "bundles", "mcps"].includes(key)) ||
      !state.resources || typeof state.resources !== "object" || Array.isArray(state.resources) ||
      !state.sources || typeof state.sources !== "object" || Array.isArray(state.sources)) {
    fail();
  }
  for (const [key, record] of Object.entries(state.resources)) {
    const identity = key.match(/^([a-z0-9]+(?:-[a-z0-9]+)*):([a-z0-9]+(?:-[a-z0-9]+)*)$/);
    if (identity && !INSTALLABLE_KINDS.has(identity[1])) {
      throw new CatalogError(
        `Installation inventory contains unsupported resource kind '${identity[1]}'. Use a compatible CLI version; the inventory and its files must not be rewritten or deleted.`,
        "UNSUPPORTED_RESOURCE_KIND",
      );
    }
    if (!/^(skill|agent|instruction):[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) ||
        !record || !TOOLS.has(record.tool) ||
        !/^[a-f0-9]{64}$/.test(record.digest) || !/^[a-f0-9]{40}$/i.test(record.commit) ||
        typeof record.version !== "string" || !record.files ||
        typeof record.files !== "object" || Array.isArray(record.files) ||
        !Object.keys(record.files).length) {
      fail();
    }
    for (const [relativePath, file] of Object.entries(record.files as Record<string, JsonRecord>)) {
      if (!resourceOwnsPath(key, relativePath) || !file ||
          !/^[a-f0-9]{64}$/.test(file.sha256) || typeof file.executable !== "boolean") {
        fail();
      }
      targetPath(targetRoot, relativePath);
    }
  }
  for (const [catalog, collections] of Object.entries(state.sources)) {
    if (typeof catalog !== "string" || !validSourceCatalogName(catalog) ||
        !collections || typeof collections !== "object" || Array.isArray(collections)) fail();
    for (const [collection, records] of Object.entries(collections)) {
      if (!SOURCE_COLLECTIONS.has(collection)) {
        throw new CatalogError(
          `Source inventory contains unsupported resource collection '${collection}'. Use a compatible CLI version; do not rewrite the inventory.`,
          "UNSUPPORTED_RESOURCE_KIND",
        );
      }
      if (!records || typeof records !== "object" || Array.isArray(records)) fail();
      const kind = collection.slice(0, -1);
      if (!["skill", "agent", "instruction"].includes(kind)) {
        if (Object.keys(records).length) {
          throw new CatalogError(
            `Source inventory contains unsupported resource collection '${collection}'. Use a compatible CLI version; do not rewrite the inventory.`,
            "UNSUPPORTED_RESOURCE_KIND",
          );
        }
        continue;
      }
      for (const [id, record] of Object.entries(records)) {
        const sourceParts = typeof record?.source_path === "string" ? record.source_path.split("/") : [];
        const validSourcePath = sourceParts.length > 0 && !record.source_path.startsWith("/") &&
          !record.source_path.includes("\\") && sourceParts.every((part) => part && part !== "." && part !== "..");
        if (!RESOURCE_ID.test(id) || id.length > 64 || !record ||
            typeof record.source_repository !== "string" ||
            !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(record.source_repository) ||
            !validSourcePath ||
            (record.source_ref !== undefined && !/^[a-f0-9]{40}$/i.test(record.source_ref)) ||
            !record.files || typeof record.files !== "object" ||
            Array.isArray(record.files) || !Object.keys(record.files).length) fail();
        const allowedPaths = kind === "skill"
          ? new Set(Object.values(SOURCE_SKILL_DIRECTORIES).map((directory) => `${directory}/${id}/SKILL.md`))
          : kind === "agent"
            ? new Set([`.claude/agents/${id}.md`, `.github/agents/${id}.agent.md`, `.copilot/agents/${id}.agent.md`])
            : new Set([`.claude/rules/${id}.md`, `.github/instructions/${id}.instructions.md`]);
        for (const [relativePath, file] of Object.entries(record.files as Record<string, JsonRecord>)) {
          if (!allowedPaths.has(relativePath) || !file ||
              !/^[a-f0-9]{64}$/.test(file.sha256) || typeof file.executable !== "boolean") {
            fail();
          }
          targetPath(targetRoot, relativePath);
        }
      }
    }
  }
  validateBundleState(state, targetRoot, fail);
  return state;
}

function validateBundleState(state: InstallState, targetRoot: string, fail: () => never) {
  const object = (value: unknown): value is JsonRecord =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);
  if (!object(state.bundles) || !object(state.mcps)) fail();
  for (const record of Object.values(state.resources)) {
    if (typeof record.standalone !== "boolean") fail();
  }
  for (const [id, record] of Object.entries(state.bundles)) {
    for (const member of Array.isArray(record?.resources) ? record.resources : []) {
      if (typeof member?.kind === "string" && RESOURCE_ID.test(member.kind) &&
          ![...INSTALLABLE_KINDS, "mcp"].includes(member.kind)) {
        throw new CatalogError(`Bundle inventory contains unsupported resource kind '${member.kind}'. Use a compatible CLI version; do not rewrite the inventory.`, "UNSUPPORTED_RESOURCE_KIND");
      }
    }
    if (!RESOURCE_ID.test(id) || !object(record) || !TOOLS.has(record.tool) ||
        !["project", "user"].includes(record.scope) || !/^[a-f0-9]{64}$/.test(record.digest) ||
        !Array.isArray(record.resources) || !record.resources.length ||
        record.resources.some((member) => !object(member) ||
          Object.keys(member).sort().join(",") !== "catalog,id,kind" ||
          !RESOURCE_ID.test(member.id) ||
          !(member.catalog === "internal" && INSTALLABLE_KINDS.has(member.kind) ||
            ["internal", "external"].includes(member.catalog) && member.kind === "mcp")) ||
        new Set(record.resources.map((member) => `${member.kind === "mcp" ? "internal" : member.catalog}:${member.kind}:${member.id}`)).size !== record.resources.length) fail();
    for (const member of record.resources) {
      if (member.kind === "mcp" ? !Object.hasOwn(state.mcps, member.id)
        : !Object.hasOwn(state.resources, `${member.kind}:${member.id}`)) fail();
      if (member.kind !== "mcp") {
        const dependency = state.resources[`${member.kind}:${member.id}`];
        if (record.scope === "user" && !isUserResource(`${member.kind}:${member.id}`, dependency)) fail();
        if (record.tool === "both" ? dependency.tool !== "both"
          : dependency.tool !== "both" && dependency.tool !== record.tool) fail();
      }
    }
  }
  for (const [id, record] of Object.entries(state.mcps)) {
    if (!RESOURCE_ID.test(id) || !object(record) ||
        typeof record.server !== "string" || !/^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/.test(record.server) ||
        !/^[a-f0-9]{64}$/.test(record.digest) || !object(record.values) ||
        Object.entries(record.values).some(([name, value]) =>
          !/^[a-z][a-z0-9_]*$/.test(name) || typeof value !== "string") ||
        !object(record.configurations) || !Object.keys(record.configurations).length ||
        !object(record.files) ||
        (record.standalone !== undefined && typeof record.standalone !== "boolean") ||
        (record.tool !== undefined && !TOOLS.has(record.tool)) ||
        (record.scope !== undefined && !["project", "user"].includes(record.scope)) ||
        (record.standalone && (!TOOLS.has(record.tool) || !["project", "user"].includes(record.scope)))) fail();
    for (const [relativePath, config] of Object.entries(record.configurations)) {
      if (![".mcp.json", ".claude.json", ".copilot/mcp-config.json"].includes(relativePath) ||
          !object(config) || typeof config.managed !== "boolean" ||
          (config.managed && !/^[a-f0-9]{64}$/.test(config.sha256))) fail();
      targetPath(targetRoot, relativePath);
    }
    for (const [relativePath, file] of Object.entries(record.files)) {
      if (relativePath !== `${MCP_DIRECTORY}/${id}.cjs` || !object(file) ||
          !/^[a-f0-9]{64}$/.test(file.sha256) || typeof file.executable !== "boolean") fail();
      targetPath(targetRoot, relativePath);
    }
    if (!record.standalone && !Object.values(state.bundles).some((bundle) => bundle.resources.some((member) =>
      member.kind === "mcp" && member.id === id))) fail();
    if (record.standalone && mcpConfigPaths(record.tool, record.scope).some((relativePath) =>
      !Object.hasOwn(record.configurations, relativePath))) fail();
  }
  for (const bundle of Object.values(state.bundles)) {
    for (const member of bundle.resources.filter((member) => member.kind === "mcp")) {
      const paths = mcpConfigPaths(bundle.tool, bundle.scope);
      if (paths.some((relativePath) => !Object.hasOwn(state.mcps[member.id].configurations, relativePath))) fail();
    }
  }
}

module.exports = {
  ...fileApi, findInstalledProvenance, findUnmanagedArtifacts, readInstallState, resourceOwnsPath, isUserResource,
};
