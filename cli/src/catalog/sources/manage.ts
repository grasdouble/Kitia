"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFile, execFileSync } = require("node:child_process");
const { promisify } = require("node:util");
const execFileAsync = promisify(execFile);
const {
  CatalogError, parseFrontmatter, validateSourceCatalog,
} = require("../resources/index.js");
const {
  catalogNameKey, isValidCatalogName, repositoryId, validateSourceConfiguration,
  loadUserSourceConfiguration, userCatalogSourcesFile, userCatalogIndexDirectory, userCatalogDirectory,
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

function normalizeResourceId(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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

function discoverCustomSkills(checkout, sourceRoot) {
  const root = safeRepositoryPath(checkout, sourceRoot);
  const resources = [];
  function visit(directory, segments) {
    const skillFile = path.join(directory, "SKILL.md");
    if (fs.existsSync(skillFile)) {
      const sourcePath = path.posix.join(sourceRoot, ...segments);
      safeRepositoryPath(checkout, path.posix.join(sourcePath, "SKILL.md"));
      resources.push({
        id: segments.at(-1) || path.posix.basename(sourceRoot),
        kind: "skill",
        sourcePath,
        file: skillFile,
        directory,
      });
      return;
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) {
        throw new CatalogError(`Symbolic links are not allowed in source resources: ${entry.name}`);
      }
      if (entry.isDirectory()) visit(path.join(directory, entry.name), [...segments, entry.name]);
    }
  }
  visit(root, []);
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
      const target = safeRepositoryPath(checkout, sourcePath);
      const stat = fs.lstatSync(target);
      if (stat.isDirectory()) {
        let discovered;
        if (mapping.kind === "skill") {
          const skillFile = path.join(target, "SKILL.md");
          if (fs.existsSync(skillFile)) {
            safeRepositoryPath(checkout, path.posix.join(sourcePath, "SKILL.md"));
            discovered = [{
              id: mapping.id || path.posix.basename(sourcePath),
              kind: "skill",
              sourcePath,
              file: skillFile,
              directory: target,
            }];
          } else {
            discovered = discoverCustomSkills(checkout, sourcePath);
          }
        } else {
          discovered = discoverBasicMarkdownResources(
            checkout, mapping.kind, [sourcePath],
            mapping.kind === "agent" ? /\.agent\.md$/i : /\.instructions\.md$/i,
          );
        }
        if (!discovered.length) {
          throw new CatalogError(`No ${mapping.kind} resources found in source directory: ${sourcePath}`);
        }
        resourceDirectories.push(...discovered);
      } else if (stat.isFile() && mapping.kind !== "skill" && /\.md$/i.test(sourcePath)) {
        const filename = path.posix.basename(sourcePath);
        const suffix = mapping.kind === "agent" ? /\.agent\.md$/i : /\.instructions\.md$/i;
        resourceDirectories.push({
          id: mapping.id || filename.replace(suffix, "").replace(/\.md$/i, ""),
          kind: mapping.kind,
          sourcePath,
          file: target,
          directory: path.dirname(target),
        });
      } else {
        throw new CatalogError(`Source resource must be a directory or supported Markdown file: ${sourcePath}`);
      }
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
    const { kind, sourcePath, file } = resource;
    const id = kind === "skill" ? resource.id : normalizeResourceId(resource.id);
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
    if (kind !== "instruction" && (
      typeof metadata.get("name") !== "string" || !metadata.get("name").trim() ||
      (kind === "skill" && (
        normalizeResourceId(metadata.get("name")) !== id ||
        typeof metadata.get("description") !== "string" || !metadata.get("description").trim()
      ))
    )) {
      throw new CatalogError(`${file} must define a non-empty name${kind === "skill" ? " matching its id and a non-empty description" : ""}`);
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
    throw new CatalogError("Catalog name must be non-empty and cannot contain path separators, colons, or control characters");
  }
  const repositoryRef = repositoryId(repository);
  const mode = configuration?.mode ?? "basic";
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration) ||
      !["basic", "custom"].includes(mode) ||
      (mode === "custom" && !Array.isArray(configuration.entries)) ||
      (mode === "basic" && configuration.entries !== undefined && configuration.entries.length !== 0)) {
    throw new CatalogError("Catalog configuration must use basic mode or custom mode with explicit entries");
  }
  const current = loadUserSourceConfiguration();
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

function updateCatalog(originalName, name, repository, configuration = { mode: "basic", entries: [] }) {
  name = typeof name === "string" ? name.trim() : name;
  if (!isValidCatalogName(name)) {
    throw new CatalogError("Catalog name must be non-empty and cannot contain path separators, colons, or control characters");
  }
  const repositoryRef = repositoryId(repository);
  const mode = configuration?.mode ?? "basic";
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration) ||
      !["basic", "custom"].includes(mode) ||
      (mode === "custom" && !Array.isArray(configuration.entries)) ||
      (mode === "basic" && configuration.entries !== undefined && configuration.entries.length !== 0)) {
    throw new CatalogError("Catalog configuration must use basic mode or custom mode with explicit entries");
  }

  const userSources = require("./config.js").loadUserSourceConfiguration();
  const original = userSources.find(({ name: sourceName }) =>
    catalogNameKey(sourceName) === catalogNameKey(originalName));
  if (!original) throw new CatalogError(`User catalog not found: ${originalName}`);
  const otherSources = userSources.filter(({ name: sourceName }) =>
    catalogNameKey(sourceName) !== catalogNameKey(original.name));
  if (otherSources.some(({ name: sourceName }) => catalogNameKey(sourceName) === catalogNameKey(name))) {
    throw new CatalogError(`Catalog already exists: ${name}`);
  }
  if (otherSources.some(({ repositoryId: sourceRepository }) => sourceRepository === repositoryRef)) {
    throw new CatalogError(`Catalog repository is already registered: ${repositoryRef}`);
  }

  const validated = validateSourceConfiguration({ catalog_version: 1, sources: userSources.map(({
    name: sourceName, repository: sourceRepository, mode: sourceMode, entries,
  }) => catalogNameKey(sourceName) === catalogNameKey(original.name)
    ? { name, repository, mode, entries: configuration.entries || [] }
    : { name: sourceName, repository: sourceRepository, mode: sourceMode, entries }) });
  const normalized = validated.find(({ name: sourceName }) =>
    catalogNameKey(sourceName) === catalogNameKey(name));
  if (!normalized) throw new CatalogError(`User catalog not found: ${originalName}`);
  const index = fetchSourceIndex(normalized);
  const sources = validated.map(({ name: sourceName, repository: sourceRepository, mode: sourceMode, entries }) => ({
    name: sourceName, repository: sourceRepository, mode: sourceMode, entries,
  }));
  const manifest = { catalog_version: 1, sources };
  const directory = userCatalogIndexDirectory();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeJson(userCatalogSourcesFile(), manifest);
  writeJson(path.join(directory, "catalogSources.json"), manifest);
  writeJson(path.join(directory, `${name}.json`), index);
  if (original.name !== name) {
    const previousIndex = path.join(directory, `${original.name}.json`);
    if (fs.existsSync(previousIndex)) fs.rmSync(previousIndex);
  }
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

async function remoteHead(repository, run = execFileAsync) {
  const { stdout } = await run("git", ["ls-remote", "--symref", repository, "HEAD"], {
    encoding: "utf8",
    timeout: 15000,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  const match = String(stdout).match(/^([a-f0-9]{40})\tHEAD$/im);
  if (!match) throw new CatalogError(`Cannot resolve the default branch of ${repository}`);
  return match[1].toLowerCase();
}

async function checkCatalogFreshness(run = execFileAsync, names) {
  const sources = require("./config.js").loadUserSourceConfiguration();
  const selected = names === undefined
    ? sources
    : sources.filter((source) => names.some((name) =>
      catalogNameKey(name) === catalogNameKey(source.name)));
  const directory = userCatalogIndexDirectory();
  return Promise.all(selected.map(async (source) => {
    try {
      const indexFile = path.join(directory, `${source.name}.json`);
      const stat = fs.lstatSync(indexFile);
      if (!stat.isFile() || stat.isSymbolicLink()) return { name: source.name, status: "unknown" };
      const index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
      if (index.catalog_name !== source.name ||
          index.source_repository !== source.repositoryId ||
          !/^[a-f0-9]{40}$/i.test(index.source_ref || "")) {
        return { name: source.name, status: "unknown" };
      }
      const remote = await remoteHead(source.repository, run);
      return {
        name: source.name,
        status: remote === index.source_ref.toLowerCase() ? "current" : "outdated",
      };
    } catch {
      return { name: source.name, status: "unknown" };
    }
  }));
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

function exportCatalogConfigurationData() {
  const sources = loadUserSourceConfiguration().map(({ name, repository, mode, entries }) => ({
    name, repository, ...(mode ? { mode, entries } : {}),
  }));
  return { catalog_version: 1, sources };
}

function exportCatalogConfiguration(file) {
  writeJson(path.resolve(file), exportCatalogConfigurationData());
}


function importCatalogConfigurationText(contents, refresh = refreshCatalogs) {
  const manifest = JSON.parse(contents);
  validateSourceConfiguration({ catalog_version: manifest?.catalog_version, sources: [] });
  if (!Array.isArray(manifest.sources)) {
    throw new CatalogError("catalogSources.json must have catalog_version: 1 and a sources array");
  }
  const current = loadUserSourceConfiguration();
  const names = new Set(current.map(({ name }) => catalogNameKey(name)));
  const repositories = new Set(current.map(({ repositoryId: repository }) => repository));
  const added = [];
  const ignored = [];
  for (const rawSource of manifest.sources) {
    const [source] = validateSourceConfiguration({ catalog_version: 1, sources: [rawSource] });
    if (names.has(catalogNameKey(source.name))) {
      ignored.push({ name: source.name, reason: "Catalog name already exists." });
    } else if (repositories.has(source.repositoryId)) {
      ignored.push({ name: source.name, reason: `Repository already registered as another catalog (${source.repositoryId}).` });
    } else {
      names.add(catalogNameKey(source.name));
      repositories.add(source.repositoryId);
      added.push({
        name: source.name, repository: source.repository,
        ...(source.mode ? { mode: source.mode, entries: source.entries } : {}),
      });
    }
  }
  if (added.length) {
    const combined = [...current.map(({ name, repository, mode, entries }) => ({
      name, repository, ...(mode ? { mode, entries } : {}),
    })), ...added];
    const directory = userCatalogDirectory();
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeJson(userCatalogSourcesFile(), { catalog_version: 1, sources: combined });
    const indexDirectory = userCatalogIndexDirectory();
    fs.mkdirSync(indexDirectory, { recursive: true, mode: 0o700 });
    writeJson(path.join(indexDirectory, "catalogSources.json"), { catalog_version: 1, sources: combined });
  }
  const refreshResult = added.length
    ? refresh(added.map(({ name }) => name))
    : { refreshed: [], failures: [] };
  return {
    added: added.map(({ name }) => name),
    ignored,
    refreshed: refreshResult.refreshed,
    refreshFailures: refreshResult.failures,
  };
}



function manageCatalogCommand(options) {
  const output = options.output || console;
  if (options.action === "add") {
    addCatalog(options.name, options.repository);
    output.log(`Added catalog ${options.name} (${repositoryId(options.repository)}).`);
    return 0;
  }
  if (options.action === "export") {
    exportCatalogConfiguration(options.file);
    output.log(`Exported catalog configuration to ${options.file}.`);
    return 0;
  }
  if (options.action === "import") {
    const summary = importCatalogConfigurationText(fs.readFileSync(path.resolve(options.file), "utf8"));
    output.log(
      `Catalog import: ${summary.added.length} added, ${summary.ignored.length} ignored, ${summary.refreshed.length} refreshed, ${summary.refreshFailures.length} refresh failed.`,
    );
    for (const name of summary.added) output.log(`Added: ${name}`);
    for (const { name, reason } of summary.ignored) output.log(`Ignored: ${name} · ${reason}`);
    for (const catalog of summary.refreshed) {
      output.log(`Refreshed: ${catalog.name} · ${catalog.count} resources indexed.`);
    }
    for (const failure of summary.refreshFailures) {
      output.error(`Refresh failed: ${failure.name} · ${failure.message}`);
    }
    return summary.refreshFailures.length ? 1 : 0;
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
    for (const source of loadUserSourceConfiguration()) {
      output.log(`${source.name}\t${source.repository}`);
    }
    return 0;
  }
  throw new CatalogError("Usage: kitia catalog <add <name> <github-repository> | refresh <name> | refresh --all | remove <name> | list>");
}

module.exports = {
  sourceMetadata, createSourceIndex, addCatalog, updateCatalog, refreshCatalogs, checkCatalogFreshness,
  removeCatalog, manageCatalogCommand, exportCatalogConfigurationData, importCatalogConfigurationText,
};
