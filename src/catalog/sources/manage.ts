"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const {
  CatalogError, parseFrontmatter, validateSourceCatalog,
} = require("../resources/index.js");
const {
  catalogNameKey, isValidCatalogName, repositoryId, validateSourceConfiguration,
  loadSourceConfiguration, userCatalogSourcesFile, userCatalogIndexDirectory,
} = require("./config.js");
function sourceMetadata(file) {
  try {
    return parseFrontmatter(fs.readFileSync(file, "utf8"), file);
  } catch (error) {
    const text = fs.readFileSync(file, "utf8");
    const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!frontmatter) throw error;
    const metadata = new Map();
    for (const key of ["name", "description", "license"]) {
      const match = frontmatter[1].match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
      if (match) metadata.set(key, match[1].trim().replace(/^(['"])(.*)\1$/, "$2"));
    }
    if (!metadata.has("name") || !metadata.has("description")) throw error;
    return metadata;
  }
}

function safeRepositoryPath(checkout, sourcePath) {
  if (typeof sourcePath !== "string" || !sourcePath || sourcePath.startsWith("/") ||
      sourcePath.includes("\\") || sourcePath.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new CatalogError(`Unsafe source resource path: ${sourcePath}`);
  }
  const root = fs.realpathSync(checkout);
  const file = path.resolve(root, ...sourcePath.split("/"));
  if (!file.startsWith(`${root}${path.sep}`)) throw new CatalogError(`Source resource escapes repository: ${sourcePath}`);
  let current = root;
  for (const part of sourcePath.split("/")) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) throw new CatalogError(`Source resource does not exist: ${sourcePath}`);
    if (fs.lstatSync(current).isSymbolicLink()) throw new CatalogError(`Symbolic links are not allowed in source resources: ${sourcePath}`);
  }
  return file;
}

function discoverBasicMarkdownResources(checkout, kind, roots, suffix) {
  const resources = [];
  for (const sourceRoot of roots) {
    const rootPath = path.join(checkout, ...sourceRoot.split("/"));
    if (!fs.existsSync(rootPath)) continue;
    const root = safeRepositoryPath(checkout, sourceRoot);
    if (!fs.statSync(root).isDirectory()) throw new CatalogError(`${sourceRoot} must be a directory`);
    function visit(directory, segments) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isSymbolicLink()) {
          throw new CatalogError(`Symbolic links are not allowed in source resources: ${entry.name}`);
        }
        if (entry.isDirectory()) {
          visit(path.join(directory, entry.name), [...segments, entry.name]);
        } else if (entry.isFile() && /\.md$/i.test(entry.name) && !/^readme\.md$/i.test(entry.name)) {
          const id = entry.name.replace(suffix, "").replace(/\.md$/i, "");
          const sourcePath = path.posix.join(sourceRoot, ...segments, entry.name);
          resources.push({ id, kind, sourcePath, file: path.join(directory, entry.name), directory });
        }
      }
    }
    visit(root, []);
  }
  return resources;
}

const BASIC_AGENT_DIRECTORIES = [
  "agents", ".agents/agents", ".claude/agents", ".github/agents", ".copilot/agents",
];
const BASIC_INSTRUCTION_DIRECTORIES = [
  "instructions", ".agents/instructions", ".claude/rules", ".github/instructions",
];

function createSourceIndex(repository, name, checkout, configuration = { mode: "basic", entries: [] }) {
  const sourceRepository = repositoryId(repository);
  const sourceRef = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], {
    encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const mappings = configuration.mode === "custom" ? configuration.entries : null;
  const resourceDirectories = [];
  if (mappings) {
    for (const mapping of mappings) {
      let sourcePath = mapping.path;
      if (mapping.kind === "skill" && sourcePath.endsWith("/SKILL.md")) sourcePath = sourcePath.slice(0, -9);
      const resourcePath = mapping.kind === "skill" ? path.posix.join(sourcePath, "SKILL.md") : sourcePath;
      const file = safeRepositoryPath(checkout, resourcePath);
      if (!fs.lstatSync(file).isFile()) throw new CatalogError(`Source resource is not a regular file: ${resourcePath}`);
      resourceDirectories.push({ id: mapping.id, kind: mapping.kind, sourcePath, file, directory: path.dirname(file) });
    }
  } else {
    const skillsRootPath = path.join(checkout, "skills");
    if (fs.existsSync(skillsRootPath)) {
      const skillsRoot = safeRepositoryPath(checkout, "skills");
      if (!fs.statSync(skillsRoot).isDirectory()) throw new CatalogError("skills must be a directory");
      function visit(directory, segments) {
        const skill = path.join(directory, "SKILL.md");
        if (fs.existsSync(skill)) {
          safeRepositoryPath(checkout, path.posix.join("skills", ...segments, "SKILL.md"));
          resourceDirectories.push({
            id: segments.at(-1), kind: "skill", sourcePath: path.posix.join("skills", ...segments),
            file: skill, directory,
          });
          return;
        }
        for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          if (entry.isSymbolicLink()) throw new CatalogError(`Symbolic links are not allowed in source resources: ${entry.name}`);
          if (entry.isDirectory()) visit(path.join(directory, entry.name), [...segments, entry.name]);
        }
      }
      visit(skillsRoot, []);
    }
    resourceDirectories.push(
      ...discoverBasicMarkdownResources(checkout, "agent", BASIC_AGENT_DIRECTORIES, /\.agent\.md$/i),
      ...discoverBasicMarkdownResources(checkout, "instruction", BASIC_INSTRUCTION_DIRECTORIES, /\.instructions\.md$/i),
    );
    if (!resourceDirectories.length) {
      throw new CatalogError(`${sourceRepository} contains no supported skills, agents, or instructions`);
    }
  }
  const resources = [];
  for (const resource of resourceDirectories) {
    const { id, kind, sourcePath, file } = resource;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 64 || id.includes("--")) {
      throw new CatalogError(`Invalid resource id in ${name}: ${id}`);
    }
    let metadata;
    try {
      metadata = sourceMetadata(file);
    } catch (error) {
      if (kind !== "instruction") throw error;
      metadata = new Map();
    }
    if (kind !== "instruction" && (metadata.get("name") !== id ||
        typeof metadata.get("description") !== "string" || !metadata.get("description").trim())) {
      throw new CatalogError(`${file} must define matching name and a non-empty description`);
    }
    const instructionKey = ["apply_to", "applyTo", "paths"].find((key) => metadata.has(key));
    const instructionMetadata = instructionKey === undefined ? undefined : metadata.get(instructionKey);
    const applyTo = instructionKey === undefined
      ? ["**"]
      : typeof instructionMetadata === "string" ? [instructionMetadata] : instructionMetadata;
    if (kind === "instruction" &&
        (!Array.isArray(applyTo) || !applyTo.length ||
          applyTo.some((pattern) => typeof pattern !== "string" || !pattern.trim()))) {
      throw new CatalogError(`${sourceRepository}:${sourcePath} must define a non-empty apply_to, applyTo, or paths frontmatter value`);
    }
    const description = typeof metadata.get("description") === "string" && metadata.get("description").trim()
      ? metadata.get("description").trim().replace(/\s+/g, " ")
      : fs.readFileSync(file, "utf8").replace(/^---[\s\S]*?---\s*/, "").trim().split("\n")[0].replace(/^#\s*/, "").trim() || id;
    resources.push({
      id, kind, description, source_path: sourcePath,
      ...(kind === "instruction" ? { apply_to: applyTo } : {}),
      license_status: typeof metadata.get("license") === "string" && metadata.get("license").trim()
        ? metadata.get("license").trim().replace(/\s+/g, " ") : "not-declared",
    });
  }
  const catalog = { catalog_version: 1, catalog_name: name, source_repository: sourceRepository, source_ref: sourceRef, resources };
  validateSourceCatalog(catalog, { name, repositoryId: sourceRepository });
  return catalog;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function fetchSourceIndex(source) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-catalog-"));
  try {
    const checkout = path.join(temporaryRoot, "checkout");
    execFileSync("git", ["clone", "--quiet", "--depth", "1", source.repository, checkout], {
      encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return createSourceIndex(source.repository, source.name, checkout, source);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function addCatalog(name, repository, configuration = { mode: "basic", entries: [] }) {
  name = typeof name === "string" ? name.trim() : name;
  if (!isValidCatalogName(name)) {
    throw new CatalogError("Catalog name must be non-empty and cannot contain path separators, colons, or control characters; 'internal' is reserved");
  }
  const repositoryRef = repositoryId(repository);
  const mode = configuration?.mode ?? "basic";
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration) ||
      !["basic", "custom"].includes(mode) ||
      (mode === "custom" && !Array.isArray(configuration.entries)) ||
      (mode === "basic" && configuration.entries !== undefined && configuration.entries.length !== 0)) {
    throw new CatalogError("Catalog configuration must use basic mode or custom mode with explicit entries");
  }
  const current = loadSourceConfiguration();
  if (current.some((source) => catalogNameKey(source.name) === catalogNameKey(name))) {
    throw new CatalogError(`Catalog already exists: ${name}`);
  }
  if (current.some((source) => source.repositoryId === repositoryRef)) {
    throw new CatalogError(`Catalog repository is already registered: ${repositoryRef}`);
  }
  const source = { name, repository, repositoryId: repositoryRef, mode, entries: configuration.entries || [] };
  const priorUserSources = require("./config.js").loadUserSourceConfiguration();
  const validated = validateSourceConfiguration({ catalog_version: 1, sources: [
    ...priorUserSources.map(({ name: sourceName, repository: sourceRepository, mode: sourceMode, entries }) =>
      ({ name: sourceName, repository: sourceRepository, ...(sourceMode ? { mode: sourceMode, entries } : {}) })),
    { name, repository, mode, entries: source.entries },
  ] });
  const normalized = validated.at(-1);
  const index = fetchSourceIndex(normalized);
  const userSources = [...priorUserSources, source].map(({ name: sourceName, repository: sourceRepository, mode: sourceMode, entries }) => ({
    name: sourceName, repository: sourceRepository,
    ...(sourceMode ? { mode: sourceMode, entries } : {}),
  }));
  validateSourceConfiguration({ catalog_version: 1, sources: userSources });
  const directory = userCatalogIndexDirectory();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeJson(userCatalogSourcesFile(), { catalog_version: 1, sources: userSources });
  writeJson(path.join(directory, "catalogSources.json"), { catalog_version: 1, sources: userSources });
  writeJson(path.join(directory, `${name}.json`), index);
  return index;
}

function refreshCatalogs(names) {
  const userSources = require("./config.js").loadUserSourceConfiguration();
  const selected = names === undefined ? userSources : names.map((name) => {
    const source = userSources.find((entry) => catalogNameKey(entry.name) === catalogNameKey(name));
    if (!source) throw new CatalogError(`User catalog not found: ${name}`);
    return source;
  });
  if (!selected.length) throw new CatalogError("No user catalogs are configured to refresh");
  const directory = userCatalogIndexDirectory();
  const refreshed = [];
  const failures = [];
  for (const source of selected) {
    try {
      const index = fetchSourceIndex(source);
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      writeJson(path.join(directory, `${source.name}.json`), index);
      refreshed.push({ name: source.name, count: index.resources.length });
    } catch (error) {
      failures.push({
        name: source.name,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { refreshed, failures };
}


function removeCatalog(name) {
  const userSources = require("./config.js").loadUserSourceConfiguration();
  const source = userSources.find((entry) => catalogNameKey(entry.name) === catalogNameKey(name));
  if (!source) throw new CatalogError(`User catalog not found: ${name}`);
  const remaining = userSources.filter((entry) => entry !== source);
  const entries = remaining.map(({ name: sourceName, repository, mode, entries: mappings }) => ({
    name: sourceName, repository, ...(mode ? { mode, entries: mappings } : {}),
  }));
  writeJson(userCatalogSourcesFile(), { catalog_version: 1, sources: entries });
  const directory = userCatalogIndexDirectory();
  if (fs.existsSync(directory)) {
    for (const file of fs.readdirSync(directory)) {
      if (file === `${source.name}.json`) fs.rmSync(path.join(directory, file));
    }
    writeJson(path.join(directory, "catalogSources.json"), { catalog_version: 1, sources: entries });
  }
}

function manageCatalogCommand(options) {
  const output = options.output || console;
  if (options.action === "add") {
    addCatalog(options.name, options.repository);
    output.log(`Added catalog ${options.name} (${repositoryId(options.repository)}).`);
    return 0;
  }
  if (options.action === "refresh") {
    const result = refreshCatalogs(options.allCatalogs ? undefined : [options.name]);
    for (const catalog of result.refreshed) {
      output.log(`Refreshed catalog ${catalog.name} · ${catalog.count} resource${catalog.count === 1 ? "" : "s"} indexed.`);
    }
    for (const failure of result.failures) {
      output.error(`Catalog refresh failed for ${failure.name}: ${failure.message}`);
    }
    return result.failures.length ? 1 : 0;
  }
  if (options.action === "remove") {
    removeCatalog(options.name);
    output.log(`Removed user catalog ${options.name}.`);
    return 0;
  }
  if (options.action === "list") {
    for (const source of loadSourceConfiguration()) {
      output.log(`${source.name}\t${source.repository}`);
    }
    return 0;
  }
  throw new CatalogError("Usage: kitia catalog <add <name> <github-repository> | refresh <name> | refresh --all | remove <name> | list>");
}

module.exports = {
  sourceMetadata, createSourceIndex, addCatalog, refreshCatalogs, removeCatalog, manageCatalogCommand,
};
