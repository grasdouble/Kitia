"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { CatalogError, readUtf8 } = require("../resources/index.js");
const os = require("node:os");

const CATALOG_NAME_FORBIDDEN = /[\/\\:\u0000-\u001f\u007f-\u009f]/u;
function catalogNameKey(name: string): string { return name.toUpperCase(); }
function isValidCatalogName(name: unknown): name is string {
  return typeof name === "string" && name.length > 0 && name === name.trim() &&
    !CATALOG_NAME_FORBIDDEN.test(name);
}
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;


function repositoryId(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CatalogError("Catalog source repository must be an HTTPS GitHub URL");
  }
  const pathname = url.pathname.replace(/\/+$/, "").replace(/\.git$/i, "");
  const id = pathname.slice(1);
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com" ||
      url.username || url.password || url.port || url.search || url.hash ||
      !REPOSITORY.test(id)) {
    throw new CatalogError(`Invalid GitHub source repository URL: ${value}`);
  }
  return id;
}

function validateSourceConfiguration(configuration: unknown) {
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) {
    throw new CatalogError("catalogSources.json must have catalog_version: 1 and a sources array");
  }
  const manifest = configuration as Record<string, unknown>;
  if (manifest.catalog_version !== 1 || !Array.isArray(manifest.sources)) {
    throw new CatalogError("catalogSources.json must have catalog_version: 1 and a sources array");
  }
  const names = new Set<string>();
  const repositories = new Set<string>();
  return manifest.sources.map((source: unknown, index: number) => {
    const label = `catalogSources.json sources[${index}]`;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new CatalogError(`${label} must define a catalog name and HTTPS GitHub repository URL`);
    }
    const entry = source as Record<string, unknown>;
    if (!isValidCatalogName(entry.name) || typeof entry.repository !== "string") {
      throw new CatalogError(`${label} must define a catalog name and HTTPS GitHub repository URL`);
    }
    if (Object.keys(entry).some((key) => !["name", "repository", "mode", "entries"].includes(key))) {
      throw new CatalogError(`${label} contains unsupported fields`);
    }
    let mode: "basic" | "custom" = entry.mode === undefined ? "basic" : entry.mode as "basic" | "custom";
    if (mode !== "basic" && mode !== "custom") throw new CatalogError(`${label}.mode must be basic or custom`);
    let entries: Array<{ kind: string; id?: string; path: string }> = [];
    if (entry.entries !== undefined) {
      if (!Array.isArray(entry.entries)) throw new CatalogError(`${label}.entries must be an array`);
      entries = entry.entries.map((item: unknown, itemIndex) => {
        const itemLabel = `${label}.entries[${itemIndex}]`;
        if (!item || typeof item !== "object" || Array.isArray(item)) throw new CatalogError(`${itemLabel} must be an object`);
        const mapping = item as Record<string, unknown>;
        if (Object.keys(mapping).some((key) => !["kind", "id", "path"].includes(key)) ||
            !["skill", "agent", "instruction"].includes(String(mapping.kind)) ||
            typeof mapping.path !== "string") {
          throw new CatalogError(`${itemLabel} must define a supported kind and safe repository-relative path`);
        }
        const sourcePath = mapping.path.replace(/\/+$/, "");
        if (!sourcePath || sourcePath.startsWith("/") || sourcePath.includes("\\") ||
            sourcePath.split("/").some((part) => !part || part === "." || part === "..")) {
          throw new CatalogError(`${itemLabel} must define a supported kind and safe repository-relative path`);
        }
        let id = mapping.id;
        if (id === undefined) {
          const parts = sourcePath.split("/");
          const basename = parts.at(-1) || "";
          if (mapping.kind === "skill" && basename.toLowerCase() === "skill.md") {
            id = parts.at(-2);
          } else if (mapping.kind !== "skill" && /\.md$/i.test(basename)) {
            id = basename.replace(mapping.kind === "agent" ? /(?:\.agent)?\.md$/i : /(?:\.instructions)?\.md$/i, "");
          }
        }
        if (id !== undefined &&
            (typeof id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) ||
              id.length > 64 || id.includes("--"))) {
          throw new CatalogError(`${itemLabel}.id must be a valid kebab-case identifier`);
        }
        const kind = mapping.kind as string;
        if (entries.some((existing) => existing.kind === kind &&
            (existing.path === sourcePath || (id !== undefined && existing.id === id)))) {
          throw new CatalogError(`${label} contains duplicate resource mappings`);
        }
        return { kind, ...(id === undefined ? {} : { id: id as string }), path: sourcePath };
      });
    }
    if (mode === "custom" && entry.entries === undefined) throw new CatalogError(`${label} custom mode requires entries`);
    if (mode === "basic" && entries.length) throw new CatalogError(`${label} basic mode cannot define entries`);
    const repository = repositoryId(entry.repository);
    const nameKey = catalogNameKey(entry.name);
    if (names.has(nameKey)) throw new CatalogError(`Duplicate catalog source name: ${entry.name}`);
    if (repositories.has(repository)) throw new CatalogError(`Duplicate catalog source repository: ${repository}`);
    names.add(nameKey);
    repositories.add(repository);
    return { name: entry.name, repository: entry.repository, repositoryId: repository, mode, entries };
  });
}

function userCatalogDirectory() {
  if (process.env.KITIA_CONFIG_DIR) return process.env.KITIA_CONFIG_DIR;
  const current = path.join(os.homedir(), ".config", "kitia");
  const previous = path.join(os.homedir(), ".config", "kiti");
  if (!fs.existsSync(current) && fs.existsSync(previous)) {
    fs.mkdirSync(path.dirname(current), { recursive: true });
    fs.cpSync(previous, current, { recursive: true, errorOnExist: true, force: false });
  }
  return current;
}

function userCatalogSourcesFile() {
  return path.join(userCatalogDirectory(), "catalogSources.json");
}

function userCatalogIndexDirectory() {
  return path.join(userCatalogDirectory(), "source-catalogs");
}

function loadUserSourceConfiguration() {
  const file = userCatalogSourcesFile();
  if (!fs.existsSync(file)) return [];
  return validateSourceConfiguration(JSON.parse(readUtf8(file, "User catalog source configuration")));
}


module.exports = {
  catalogNameKey, isValidCatalogName, repositoryId, validateSourceConfiguration,
  userCatalogDirectory, userCatalogSourcesFile, userCatalogIndexDirectory, loadUserSourceConfiguration,
};

