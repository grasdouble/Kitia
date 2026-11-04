"use strict";

const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");
import type { CatalogResource } from "../entries.js";
import type { InstallPlanEntry } from "../plan.js";

const INSTALLABLE_KINDS = new Set(["skill", "agent", "instruction"]);
const USER_INSTALLABLE_KINDS = new Set(["skill", "agent"]);
const TOOLS = new Set(["claude", "copilot", "both"]);
const RESOURCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LOCK_PATH = ".agents/kitia-lock.json";
const INSTALL_SCAN_DIRECTORIES = {
  claude: [".claude/skills", ".claude/agents", ".claude/rules"],
  copilot: [".agents/skills", ".agents/agents", ".agents/instructions", ".github/agents", ".github/instructions"],
};
const USER_INSTALL_SCAN_DIRECTORIES = {
  claude: [".claude/skills", ".claude/agents"],
  copilot: [".agents/skills", ".copilot/agents"],
};
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
  return relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
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
  if (end < 0) throw new CatalogError(`Unclosed YAML frontmatter in ${filePath}`);
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
    if (typeof kind === "string" && ![...INSTALLABLE_KINDS].includes(kind)) {
      throw new CatalogError(`${entryLabel}: resource kind '${kind}' is not supported by this CLI.`, "UNSUPPORTED_RESOURCE_KIND");
    }
    const sourcePath = entry.source_path;
    if (!INSTALLABLE_KINDS.has(kind) || typeof sourcePath !== "string" || !sourcePath || sourcePath.startsWith("/") ||
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
    } as CatalogResource;
  });
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

module.exports = {
  INSTALLABLE_KINDS,
  USER_INSTALLABLE_KINDS,
  TOOLS,
  RESOURCE_ID,
  LOCK_PATH,
  INSTALL_SCAN_DIRECTORIES,
  USER_INSTALL_SCAN_DIRECTORIES,
  SOURCE_SKILL_DIRECTORIES,
  CatalogError,
  rejectUnsupportedVersion,
  isWithin,
  readUtf8,
  frontmatterParts,
  parseFrontmatter,
  validateSourceCatalog,
  addPlanEntry,
};
