"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  CatalogError,
  formatResource,
  parseFrontmatter,
  validateManifest,
  validateBundleReferences,
} = require("../dist/catalog/resources/index.js");

const root = path.resolve(__dirname, "..");
const INSTALLABLE_KINDS = ["skill", "agent", "instruction"];
const RESOURCE_DIRECTORIES = {
  skill: "skills",
  agent: "agents",
  instruction: "instructions",
  bundle: "bundles",
  mcp: "mcps",
};

function readJson(filePath, label) {
  try {
    if (!fs.lstatSync(filePath).isFile()) {
      throw new CatalogError(`${label} must be a regular file: ${filePath}`);
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error instanceof CatalogError) {
      throw error;
    }
    throw new CatalogError(`Cannot read ${label} ${filePath}: ${error.message}`);
  }
}

function readMetadata(filePath, kind, id) {
  const metadata = readJson(filePath, "resource metadata");
  if (!metadata || Array.isArray(metadata) || typeof metadata !== "object") {
    throw new CatalogError(`${filePath} must contain a JSON object`);
  }
  if (["id", "kind", "group"].some((field) => Object.hasOwn(metadata, field))) {
    throw new CatalogError(`${filePath} must not define id, kind or group`);
  }
  if (kind !== "instruction" && Object.hasOwn(metadata, "description")) {
    throw new CatalogError(`${filePath} must not define description; use the resource frontmatter`);
  }
  if (kind === "instruction" && (typeof metadata.description !== "string" || !metadata.description.trim())) {
    throw new CatalogError(`${filePath} must define a non-empty description`);
  }
  return { id, kind, ...metadata };
}

function resourceDescription(sourceFile, kind, id) {
  if (kind === "instruction") {
    return null;
  }
  const metadata = parseFrontmatter(fs.readFileSync(sourceFile, "utf8"), sourceFile);
  if (metadata.get("name") !== id) {
    throw new CatalogError(`${sourceFile} frontmatter name must match resource id '${id}'`);
  }
  const description = metadata.get("description");
  if (typeof description !== "string" || !description.trim()) {
    throw new CatalogError(`${sourceFile} frontmatter must define a non-empty description`);
  }
  return description;
}

function discoverLocalResources(repositoryRoot) {
  const resources = [];
  const groupsDirectory = path.join(repositoryRoot, "catalogs");
  const catalogFiles = new Set([
    "catalog.json", "catalogSources.json", "CATALOG.md",
  ]);
  const groups = fs.readdirSync(groupsDirectory, { withFileTypes: true })
    .filter((entry) => {
      if (entry.isDirectory()) {
        return true;
      }
      if (catalogFiles.has(entry.name)) {
        return false;
      }
      throw new CatalogError(`Unexpected entry in ${groupsDirectory}: ${entry.name}`);
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const groupEntry of groups) {
    const group = groupEntry.name;
    const groupPath = path.join(groupsDirectory, group);
    const actualDirectories = fs.readdirSync(groupPath, { withFileTypes: true });
    if (actualDirectories.some((entry) =>
      !entry.isDirectory() || !Object.values(RESOURCE_DIRECTORIES).includes(entry.name))) {
      throw new CatalogError(`Groups may contain only skills, agents, instructions, bundles and mcps directories: ${groupPath}`);
    }
    for (const kind of INSTALLABLE_KINDS) {
      const sourceDirectory = path.join(groupPath, RESOURCE_DIRECTORIES[kind]);
      if (!fs.existsSync(sourceDirectory)) continue;
      if (!fs.lstatSync(sourceDirectory).isDirectory()) {
        throw new CatalogError(`Missing resource directory: ${sourceDirectory}`);
      }
      const allEntries = fs.readdirSync(sourceDirectory, { withFileTypes: true })
        .filter((entry) => entry.name !== ".gitkeep")
        .sort((left, right) => left.name.localeCompare(right.name));
      const entries = kind === "skill"
        ? allEntries
        : allEntries.filter((entry) => !entry.name.endsWith(".catalog.json"));
      const sidecars = new Set(
        allEntries.filter((entry) => entry.name.endsWith(".catalog.json")).map((entry) => entry.name),
      );

      for (const entry of entries) {
        if (kind === "skill" && !entry.isDirectory()) {
          throw new CatalogError(`Unexpected entry in ${sourceDirectory}: ${entry.name}`);
        }
        if (kind !== "skill" && !entry.isFile()) {
          throw new CatalogError(`Unexpected entry in ${sourceDirectory}: ${entry.name}`);
        }
        const id = kind === "skill" ? entry.name : entry.name.replace(/\.md$/, "");
        if (kind !== "skill" && !entry.name.endsWith(".md")) {
          throw new CatalogError(`Expected a Markdown resource in ${sourceDirectory}: ${entry.name}`);
        }
        const sourceFile = kind === "skill"
          ? path.join(sourceDirectory, id, "SKILL.md")
          : path.join(sourceDirectory, `${id}.md`);
        if (!fs.lstatSync(sourceFile).isFile()) {
          throw new CatalogError(`Missing resource source file: ${sourceFile}`);
        }
        const metadataFile = kind === "skill"
          ? path.join(sourceDirectory, id, "catalog.json")
          : path.join(sourceDirectory, `${id}.catalog.json`);
        if (kind !== "skill") {
          sidecars.delete(path.basename(metadataFile));
        }
        if (!fs.existsSync(metadataFile) || !fs.lstatSync(metadataFile).isFile()) {
          throw new CatalogError(`Missing catalog metadata file: ${metadataFile}`);
        }
        const resource = readMetadata(metadataFile, kind, id);
        resource.group = group;
        const description = resourceDescription(sourceFile, kind, id);
        if (description) {
          resource.description = description;
        }
        resources.push(resource);
      }
      if (sidecars.size) {
        throw new CatalogError(`Orphan catalog metadata in ${sourceDirectory}: ${[...sidecars].sort().join(", ")}`);
      }
    }
    for (const kind of ["bundle", "mcp"]) {
      const directory = path.join(groupPath, RESOURCE_DIRECTORIES[kind]);
      if (!fs.existsSync(directory)) continue;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name))) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) {
          throw new CatalogError(`Expected a JSON ${kind} in ${directory}: ${entry.name}`);
        }
        const metadata = readJson(path.join(directory, entry.name), kind);
        if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
          throw new CatalogError(`${kind} metadata must contain a JSON object: ${entry.name}`);
        }
        if (["id", "kind", "group"].some((field) => Object.hasOwn(metadata, field))) {
          throw new CatalogError(`${kind} identity is derived from its path: ${entry.name}`);
        }
        resources.push({ id: entry.name.slice(0, -5), kind, group, ...metadata });
      }
    }
  }
  const skillsDirectory = path.join(repositoryRoot, "skills");
  if (fs.existsSync(skillsDirectory)) {
    if (!fs.lstatSync(skillsDirectory).isDirectory()) {
      throw new CatalogError(`Skills root must be a directory: ${skillsDirectory}`);
    }
    for (const entry of fs.readdirSync(skillsDirectory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === ".DS_Store") continue;
      if (!entry.isDirectory()) {
        throw new CatalogError(`Unexpected entry in ${skillsDirectory}: ${entry.name}`);
      }
      const sourceDirectory = path.join(skillsDirectory, entry.name);
      const sourceFile = path.join(sourceDirectory, "SKILL.md");
      const metadataFile = path.join(sourceDirectory, "catalog.json");
      if (!fs.lstatSync(sourceFile).isFile() || !fs.lstatSync(metadataFile).isFile()) {
        throw new CatalogError(`Each root skill must contain SKILL.md and catalog.json: ${sourceDirectory}`);
      }
      const resource = readMetadata(metadataFile, "skill", entry.name);
      resource.group = "general";
      resource.description = resourceDescription(sourceFile, "skill", entry.name);
      resources.push(resource);
    }
  }
  return resources;
}

function buildCatalog(repositoryRoot = root) {
  const localEntries = discoverLocalResources(repositoryRoot);
  const manifest = {
    catalog_version: 2,
    resources: localEntries,
  };
  const resources = validateManifest(manifest, repositoryRoot);
  validateBundleReferences(resources);
  return {
    manifest,
    resources,
  };
}

function renderCatalog(resources) {
  const escapeCell = (text) => text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  return [
    "# Kitia — Your AI toolkit, in good hands.",
    "",
    "<!-- Generated from skills/ and catalogs/ by npm run catalog:build. Do not edit directly. -->",
    "",
    ...(resources.length
      ? [
        "Installable resources include skills, agents, instructions, bundles and MCP servers.",
        "MCP configuration does not imply authentication or authorization.",
        "Listing a resource does not constitute an endorsement for internal use.",
        "Client compatibility is an indicative declaration by the resource author.",
        "",
        "Commands without a tag follow the default branch. For reproducible use,",
        "replace the GitHub reference with a published tag or a full commit SHA.",
      ]
      : ["Kitia does not host AI resources. Register user-managed external catalogs with `kitia catalog add`."]),
    "",
    "| Resource | Type | Category | Status | Description |",
    "|---|---|---|---|---|",
    ...resources.map((resource) =>
      `| [${resource.id}](#${resource.kind}-${resource.id}) | ${resource.kind} | ${escapeCell(resource.category)} | ${resource.status} | ${escapeCell(resource.description)} |`),
    "",
    ...resources.map((resource) => formatResource(resource, { sourceLinkPrefix: "" })),
  ].join("\n");
}

function run({ repositoryRoot = root, check = false } = {}) {
  const { manifest, resources } = buildCatalog(repositoryRoot);
  const catalogDirectory = path.join(repositoryRoot, "catalogs");
  const jsonPath = path.join(catalogDirectory, "catalog.json");
  const catalogPath = path.join(catalogDirectory, "CATALOG.md");
  const jsonContent = `${JSON.stringify(manifest, null, 2)}\n`;
  const catalogContent = renderCatalog(resources);

  if (check) {
    let currentJson;
    try {
      currentJson = fs.readFileSync(jsonPath, "utf8");
    } catch (error) {
      throw new CatalogError(`Cannot read generated catalog ${jsonPath}: ${error.message}`);
    }
    if (currentJson !== jsonContent) {
      throw new CatalogError("catalog.json is out of date. Run npm run catalog:build and include the result.");
    }
    if (!fs.existsSync(catalogPath) || fs.readFileSync(catalogPath, "utf8") !== catalogContent) {
      throw new CatalogError("catalogs/CATALOG.md is out of date. Run npm run catalog:build and include the result.");
    }
    return;
  }
  fs.mkdirSync(catalogDirectory, { recursive: true });
  fs.writeFileSync(jsonPath, jsonContent);
  fs.writeFileSync(catalogPath, catalogContent);
  console.log("Generated catalogs/catalog.json and catalogs/CATALOG.md");
}

if (require.main === module) {
  try {
    run({ check: process.argv.includes("--check") });
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { buildCatalog, discoverLocalResources, renderCatalog, run };
