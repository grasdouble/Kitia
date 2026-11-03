"use strict";

const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");
const {
  KINDS,
  INSTALLABLE_KINDS,
  LOCAL_KINDS,
  validateEntry,
  formatResource,
} = require("../entries.js");
import type { CatalogResource } from "../entries.js";
import type { InstallPlanEntry } from "../plan.js";

const CATALOG_ROOT = path.resolve(__dirname, "../../..");
const CATALOG_NAME = "grasdouble/Kitia";
const TOOLS = new Set(["claude", "copilot", "both"]);
const INSTALL_SCAN_DIRECTORIES = {
  claude: [".claude/skills", ".claude/agents", ".claude/rules"],
  copilot: [
    ".agents/skills",
    ".agents/agents",
    ".agents/instructions",
    ".github/agents",
    ".github/instructions",
  ],
};
const USER_INSTALLABLE_KINDS = new Set(["skill", "agent", "bundle", "mcp"]);
const USER_INSTALL_SCAN_DIRECTORIES = {
  claude: [".claude/skills", ".claude/agents"],
  copilot: [".agents/skills", ".copilot/agents"],
};
const RESOURCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PROVENANCE_FIELDS = [
  "catalog-name",
  "catalog-resource",
  "catalog-commit",
  "catalog-version",
  "catalog-content-sha256",
  "catalog-runtime",
];
const LOCK_PATH = ".agents/kitia-lock.json";
const MCP_DIRECTORY = ".agents/kitia-mcp";
const SOURCE_SKILL_DIRECTORIES = {
  "github-copilot": ".agents/skills",
  "claude-code": ".claude/skills",
};

class CatalogError extends Error {
  code: string;

  constructor(message, code = "CATALOG_ERROR") {
    super(message);
    this.code = code;
  }
}

function rejectUnsupportedVersion(version, supported, label, code) {
  if (Number.isSafeInteger(version) && version > 0 && version !== supported) {
    throw new CatalogError(
      `${label} version ${version} is not supported by this CLI (supported: ${supported}). Use a compatible CLI version; do not rewrite or delete the data to change its version.`,
      code,
    );
  }
}

function isWithin(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

function rejectSymlinkPath(candidate, root) {
  if (!isWithin(candidate, root)) {
    throw new CatalogError(`Catalog resource escapes the catalog root: ${candidate}`);
  }

  const relative = path.relative(root, candidate);
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code === "ENOENT") {
        break;
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new CatalogError(`Symbolic links are not allowed in catalog resources: ${current}`);
    }
    if (!isWithin(fs.realpathSync(current), root)) {
      throw new CatalogError(`Catalog resource escapes the catalog root: ${current}`);
    }
  }
}

function resourceSource(root, kind, id, group) {
  if (kind === "skill" && group === "general") {
    return path.join(root, "skills", id);
  }
  const groupRoot = path.join(root, "catalogs", group);
  if (kind === "skill") {
    return path.join(groupRoot, "skills", id);
  }
  if (kind === "agent") {
    return path.join(groupRoot, "agents", `${id}.md`);
  }
  return path.join(groupRoot, "instructions", `${id}.md`);
}

function readUtf8(filePath, label = "file") {
  const content = fs.readFileSync(filePath);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    throw new CatalogError(`${label} is not valid UTF-8: ${filePath}`);
  }
}

function frontmatterParts(text, filePath) {
  const lines = text.split(/\r?\n/);
  if (!lines.length || lines[0].trim() !== "---") {
    throw new CatalogError(`${filePath} must start with YAML frontmatter`);
  }

  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) {
    throw new CatalogError(`Unclosed YAML frontmatter in ${filePath}`);
  }
  const document = YAML.parseDocument(lines.slice(1, end).join("\n"), {
    uniqueKeys: true,
    schema: "core",
  });
  if (document.errors.length || document.warnings.length) {
    throw new CatalogError(`Invalid YAML in ${filePath}: ${[...document.errors, ...document.warnings].map((error) => error.message).join("; ")}`);
  }
  if (!YAML.isMap(document.contents)) {
    throw new CatalogError(`${filePath} frontmatter must be a YAML mapping`);
  }
  let values;
  try {
    values = document.toJS({ maxAliasCount: 20, mapAsMap: true });
  } catch (error) {
    throw new CatalogError(`Invalid YAML in ${filePath}: ${error.message}`);
  }
  return { document, values, body: lines.slice(end + 1).join("\n") };
}

function parseFrontmatter(text, filePath) {
  return frontmatterParts(text, filePath).values;
}

function loadCatalog(catalogRoot = CATALOG_ROOT) {
  const root = fs.realpathSync(catalogRoot);
  const manifestPath = path.join(root, "catalogs", "catalog.json");
  if (!fs.existsSync(manifestPath)) return [];
  let manifest;
  try {
    manifest = JSON.parse(readUtf8(manifestPath, "Catalog manifest"));
  } catch (error) {
    if (error instanceof CatalogError) {
      throw error;
    }
    throw new CatalogError(`Cannot read catalog manifest ${manifestPath}: ${error.message}`);
  }

  return validateManifest(manifest, root);
}

function validateSourceCatalog(
  manifest,
  { name, repositoryId, label = `catalogs/${name}.json` },
) {
  rejectUnsupportedVersion(manifest?.catalog_version, 1, `${name} catalog`, "UNSUPPORTED_CATALOG_VERSION");
  if (!manifest || Array.isArray(manifest) || manifest.catalog_version !== 1) {
    throw new CatalogError(`${label} must have catalog_version: 1`);
  }
  if (manifest.catalog_name !== name) {
    throw new CatalogError(`${label} must identify catalog '${name}'`);
  }
  if (typeof manifest.source_repository !== "string" ||
      manifest.source_repository !== repositoryId ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(manifest.source_repository)) {
    throw new CatalogError(`${label} must reference configured repository ${repositoryId}`);
  }
  if (typeof manifest.source_ref !== "string" || !/^[a-f0-9]{40}$/i.test(manifest.source_ref)) {
    throw new CatalogError(`${label} source_ref must be a full 40-character commit SHA`);
  }
  if (!Array.isArray(manifest.resources)) {
    throw new CatalogError(`${label} must contain a resources array`);
  }
  const seen = new Set();
  return manifest.resources.map((entry, index) => {
    const entryLabel = `${label} resources[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new CatalogError(`${entryLabel} must be an object`);
    }
    if (typeof entry.id !== "string" || entry.id.length > 64 ||
        !RESOURCE_ID.test(entry.id) || entry.id.includes("--")) {
      throw new CatalogError(`${entryLabel}.id must be a lowercase kebab-case identifier of at most 64 characters`);
    }
    const kind = entry.kind;
    if (typeof kind === "string" && !["skill", "agent", "instruction"].includes(kind)) {
      throw new CatalogError(`${entryLabel}: resource kind '${kind}' is not supported by this CLI.`, "UNSUPPORTED_RESOURCE_KIND");
    }
    const sourcePath = entry.source_path;
    if (kind !== "skill" && kind !== "agent" && kind !== "instruction" ||
        typeof sourcePath !== "string" || !sourcePath || sourcePath.startsWith("/") ||
        sourcePath.includes("\\") || sourcePath.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new CatalogError(`${entryLabel} must reference a safe repository-relative skill, agent or instruction path`);
    }
    if (kind === "skill" && sourcePath.split("/").at(-1) !== entry.id) {
      throw new CatalogError(`${entryLabel} skill path must end with its id`);
    }
    if ((kind === "agent" || kind === "instruction") &&
        path.posix.basename(sourcePath).replace(kind === "agent" ? /(?:\.agent)?\.md$/i : /(?:\.instructions)?\.md$/i, "") !== entry.id) {
      throw new CatalogError(`${entryLabel} file path must identify ${kind} ${entry.id}`);
    }
    if (typeof entry.description !== "string" || !entry.description.trim()) {
      throw new CatalogError(`${entryLabel}.description must be a non-empty string`);
    }
    if (typeof entry.license_status !== "string" || !entry.license_status.trim()) {
      throw new CatalogError(`${entryLabel}.license_status must be a non-empty string`);
    }
    if (kind === "instruction" && (!Array.isArray(entry.apply_to) || !entry.apply_to.length ||
        entry.apply_to.some((pattern) => typeof pattern !== "string" || !pattern.trim()))) {
      throw new CatalogError(`${entryLabel}.apply_to must be a non-empty array of glob strings`);
    }
    const identity = `${kind}:${entry.id}`;
    if (seen.has(identity)) throw new CatalogError(`Duplicate ${name} ${kind}: ${entry.id}`);
    seen.add(identity);
    return {
      ...entry,
      description: entry.description.trim(),
      source_repository: manifest.source_repository,
      source_ref: manifest.source_ref,
      ...(kind === "instruction" ? { applyTo: entry.apply_to } : {}),
    };
  });
}

function validateManifest(manifest, catalogRoot = CATALOG_ROOT) {
  const root = fs.realpathSync(catalogRoot);
  rejectUnsupportedVersion(manifest?.catalog_version, 2, "Catalog", "UNSUPPORTED_CATALOG_VERSION");
  if (!manifest || Array.isArray(manifest) || manifest.catalog_version !== 2) {
    throw new CatalogError("catalog.json must have catalog_version: 2");
  }
  if (!Array.isArray(manifest.resources)) {
    throw new CatalogError("catalog.json must contain a resources array");
  }

  const seen = new Set();
  const resources = manifest.resources.map((entry, index) => {
    const label = `resources[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new CatalogError(`${label} must be an object`);
    }
    if (typeof entry.kind === "string" && RESOURCE_ID.test(entry.kind) && !KINDS.has(entry.kind)) {
      throw new CatalogError(
        `${label}: resource kind '${entry.kind}' is not supported by this CLI. Use a compatible CLI version; do not reinterpret this resource as another kind.`,
        "UNSUPPORTED_RESOURCE_KIND",
      );
    }
    validateEntry(entry, label, CatalogError);

    const { id, kind, description } = entry;
    if (
      typeof id !== "string" ||
      id.length > 64 ||
      !RESOURCE_ID.test(id) ||
      id.includes("--")
    ) {
      throw new CatalogError(`${label}.id must be a lowercase kebab-case identifier of at most 64 characters`);
    }
    if (typeof kind !== "string" || !KINDS.has(kind)) {
      throw new CatalogError(`${label}.kind must be one of: ${[...KINDS].join(", ")}`);
    }
    if (typeof description !== "string" || !description.trim()) {
      throw new CatalogError(`${label}.description must be a non-empty string`);
    }

    const key = `${kind}:${id}`;
    if (seen.has(key)) {
      throw new CatalogError(`Duplicate catalog resource: ${kind} ${id}`);
    }
    seen.add(key);

    let applyTo = [];
    if (kind === "instruction" && !Object.hasOwn(entry, "apply_to")) {
      throw new CatalogError(`${label}.apply_to is required for instructions; use ["**"] for an explicit global scope`);
    }
    if (Object.hasOwn(entry, "apply_to")) {
      if (kind !== "instruction") {
        throw new CatalogError(`${label}.apply_to is only valid for instructions`);
      }
      if (
        !Array.isArray(entry.apply_to) ||
        entry.apply_to.length === 0 ||
        entry.apply_to.some((pattern) => typeof pattern !== "string" || !pattern.trim())
      ) {
        throw new CatalogError(`${label}.apply_to must be a non-empty array of glob strings`);
      }
      applyTo = entry.apply_to;
    }

    const source = INSTALLABLE_KINDS.has(kind) ? resourceSource(root, kind, id, entry.group) : null;
    if (source) {
      rejectSymlinkPath(source, root);
    }
    return { ...entry, description: description.trim(), source, applyTo };
  });
  for (const resource of resources) {
    if (resource.replacement && (!seen.has(resource.replacement) || resource.replacement === `${resource.kind}:${resource.id}`)) {
      throw new CatalogError(`Invalid replacement for ${resource.kind}:${resource.id}: ${resource.replacement}`);
    }
  }
  return resources;
}

function validateMetadata(filePath, resource, isAgent) {
  const metadata = parseFrontmatter(readUtf8(filePath, "Markdown file"), filePath);
  if (isAgent) {
    const unsupported = [...metadata.keys()].filter((key) => !["name", "description"].includes(key));
    if (unsupported.length) {
      throw new CatalogError(
        `${filePath} uses runtime-specific agent fields not yet supported: ${unsupported.sort().join(", ")}`,
      );
    }
  }
  for (const field of ["name", "description"]) {
    if (typeof metadata.get(field) !== "string" || !metadata.get(field).trim()) {
      throw new CatalogError(`${filePath} frontmatter must define a non-empty ${field}`);
    }
  }
  if (metadata.get("name") !== resource.id) {
    throw new CatalogError(
      `${filePath} frontmatter name '${metadata.get("name")}' must match catalog id '${resource.id}'`,
    );
  }
  if (metadata.has("metadata") && !(metadata.get("metadata") instanceof Map)) {
    throw new CatalogError(`${filePath} metadata must be a YAML mapping`);
  }
}

function validateBundleReferences(resources: CatalogResource[]) {
  const entries = new Map<string, CatalogResource>(resources.map((resource) => [
    `internal:${resource.kind}:${resource.id}`, resource,
  ]));
  for (const bundle of resources.filter((resource) => resource.kind === "bundle")) {
    for (const member of bundle.resources) {
      const resource = entries.get(`${member.catalog}:${member.kind}:${member.id}`);
      if (!resource) throw new CatalogError(`Bundle ${bundle.id}: missing resource ${member.catalog}:${member.kind}:${member.id}`);
      if (member.kind === "mcp" && !resource.inputs) {
        throw new CatalogError(`Bundle ${bundle.id}: MCP ${member.id} needs an explicit inputs declaration for managed setup`);
      }
    }
  }
}

function mcpConfigPaths(tool, scope) {
  if (scope !== "user") return [".mcp.json"];
  return (tool === "both" ? ["claude", "copilot"] : [tool])
    .map((runtime) => runtime === "claude" ? ".claude.json" : ".copilot/mcp-config.json");
}

function addPlanEntry(
  plan: Map<string, InstallPlanEntry>,
  relativePath: string,
  content: Buffer,
  executable = false,
): void {
  const existing = plan.get(relativePath);
  if (existing && (!existing.content.equals(content) || existing.executable !== executable)) {
    throw new CatalogError(`Multiple resources generate different content for ${relativePath}`);
  }
  plan.set(relativePath, { content, executable });
}

function assertInstallableResource(resource) {
  if (!INSTALLABLE_KINDS.has(resource.kind)) {
    throw new CatalogError(`${resource.kind} ${resource.id} is a reference, not an installable resource. Use show ${resource.kind} ${resource.id} for access instructions.`);
  }
}

module.exports = {
  CATALOG_ROOT, CATALOG_NAME, TOOLS, INSTALL_SCAN_DIRECTORIES,
  USER_INSTALLABLE_KINDS, USER_INSTALL_SCAN_DIRECTORIES,
  RESOURCE_ID, PROVENANCE_FIELDS, LOCK_PATH, MCP_DIRECTORY, SOURCE_SKILL_DIRECTORIES,
  KINDS, INSTALLABLE_KINDS, LOCAL_KINDS,
  CatalogError, isWithin, rejectSymlinkPath, readUtf8, parseFrontmatter,
  rejectUnsupportedVersion,
  loadCatalog, validateSourceCatalog, validateManifest,
  validateBundleReferences, mcpConfigPaths, validateMetadata, frontmatterParts,
  addPlanEntry, assertInstallableResource, formatResource, validateEntry,
};
