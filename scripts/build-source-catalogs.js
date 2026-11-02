"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { validateSourceCatalog } = require("../dist/catalog/resources/index.js");
const { sourceMetadata } = require("../dist/catalog/sources/manage.js");
const {
  loadSourceConfiguration, repositoryId, validateSourceConfiguration,
} = require("../dist/catalog/sources/config.js");

const root = path.resolve(__dirname, "..");
const RESOURCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function buildSourceCatalog(sourceRoot, source, ref) {
  if (!/^[a-f0-9]{40}$/i.test(ref)) {
    throw new Error(`${source.name} source ref must be a full 40-character commit SHA`);
  }
  const skillsRoot = path.join(sourceRoot, "skills");
  if (!fs.lstatSync(skillsRoot).isDirectory()) {
    throw new Error(`${source.repositoryId} must contain a skills directory at its root`);
  }
  const directories = [];
  function visit(directory, segments) {
    if (fs.existsSync(path.join(directory, "SKILL.md"))) {
      directories.push({
        id: segments.at(-1),
        sourcePath: path.posix.join("skills", ...segments),
        skillRoot: directory,
      });
      return;
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) visit(path.join(directory, entry.name), [...segments, entry.name]);
    }
  }
  visit(skillsRoot, []);
  const resources = [];
  const seen = new Set();
  for (const { id, sourcePath, skillRoot } of directories) {
    if (id.length > 64 || !RESOURCE_ID.test(id) || id.includes("--")) {
      throw new Error(`Invalid skill directory name in ${source.name}: ${id}`);
    }
    if (seen.has(id)) throw new Error(`Duplicate skill ID in ${source.name}: ${id}`);
    seen.add(id);
    const skillFile = path.join(skillRoot, "SKILL.md");
    if (!fs.existsSync(skillFile) || !fs.lstatSync(skillFile).isFile()) {
      throw new Error(`Missing skill file: ${skillFile}`);
    }
    const metadata = sourceMetadata(skillFile);
    if (metadata.get("name") !== id) {
      throw new Error(`${skillFile} frontmatter name must match directory '${id}'`);
    }
    const license = metadata.get("license");
    if (license !== undefined && typeof license !== "string") {
      throw new Error(`${skillFile} frontmatter license must be a string`);
    }
    const description = metadata.get("description");
    if (typeof description !== "string" || !description.trim()) {
      throw new Error(`${skillFile} frontmatter must define a non-empty description`);
    }
    resources.push({
      id,
      kind: "skill",
      description: description.trim().replace(/\s+/g, " "),
      source_path: sourcePath,
      license_status: typeof license === "string" && license.trim()
        ? license.trim().replace(/\s+/g, " ")
        : "not-declared",
    });
  }

  const catalog = {
    catalog_version: 1,
    catalog_name: source.name,
    source_repository: source.repositoryId,
    source_ref: ref,
    resources,
  };
  validateSourceCatalog(catalog, source);
  return catalog;
}

function git(sourceRoot, args) {
  return execFileSync("git", ["-C", sourceRoot, ...args], {
    encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function remoteRepositoryId(remote) {
  const ssh = remote.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/i);
  if (ssh) return ssh[1];
  return repositoryId(remote);
}

function catalogFromCheckout(sourceRoot, source) {
  const remote = remoteRepositoryId(git(sourceRoot, ["remote", "get-url", "origin"]));
  if (remote !== source.repositoryId) {
    throw new Error(`Source checkout origin must point to ${source.repositoryId}`);
  }
  const status = git(sourceRoot, ["status", "--porcelain", "--untracked-files=all"]);
  if (status) throw new Error(`Source checkout has uncommitted changes:\n${status}`);
  return buildSourceCatalog(sourceRoot, source, git(sourceRoot, ["rev-parse", "HEAD"]));
}

function cloneSource(source, destination) {
  execFileSync("gh", ["repo", "clone", source.repository, destination, "--", "--depth", "1"], {
    encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" },
  });
}

function generateSourceCatalogs({
  catalogRoot = root,
  outputDirectory = path.join(root, "site-build", "data", "source-catalogs"),
  sourceRoots = {},
  clone = cloneSource,
  includeUserSources = true,
} = {}) {
  const sources = loadSourceConfiguration(catalogRoot, { includeUserSources });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-name-sources-"));
  const catalogs = [];
  try {
    fs.mkdirSync(outputDirectory, { recursive: true });
    const manifestFile = path.join(outputDirectory, "catalogSources.json");
    if (fs.existsSync(manifestFile)) {
      const previousConfiguration = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
      const previousSources = validateSourceConfiguration(previousConfiguration);
      const currentNames = new Set(sources.map(({ name }) => name));
      for (const { name } of previousSources) {
        if (!currentNames.has(name)) {
          fs.rmSync(path.join(outputDirectory, `${name}.json`), { force: true });
        }
      }
    }
    for (const source of sources) {
      let sourceRoot = sourceRoots[source.name];
      if (!sourceRoot) {
        sourceRoot = path.join(temporary, source.name);
        clone(source, sourceRoot);
      }
      const catalog = catalogFromCheckout(path.resolve(sourceRoot), source);
      fs.writeFileSync(
        path.join(outputDirectory, `${source.name}.json`),
        `${JSON.stringify(catalog, null, 2)}\n`,
      );
      catalogs.push(catalog);
    }
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(outputDirectory, "catalogSources.json"),
      `${JSON.stringify({
        catalog_version: 1,
        sources: sources.map(({ name, repository }) => ({ name, repository })),
      }, null, 2)}\n`,
    );
    return catalogs;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function parseBuildArguments(args) {
  const sourceRoots = {};
  let outputDirectory;
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    const value = args[++index];
    if (!["--source", "--output"].includes(option) || !value || value.startsWith("--")) {
      throw new Error("Expected [--source <name=checkout>]... [--output <directory>]");
    }
    if (option === "--output") {
      if (outputDirectory) throw new Error("--output may only be specified once");
      outputDirectory = path.resolve(value);
      continue;
    }
    const separator = value.indexOf("=");
    const sources = separator < 1 ? loadSourceConfiguration() : null;
    if (separator < 1 && sources.length !== 1) {
      throw new Error("--source must be specified as <catalog-name>=<checkout> when multiple sources are configured");
    }
    const name = separator < 1 ? sources[0].name : value.slice(0, separator);
    if (Object.hasOwn(sourceRoots, name)) throw new Error(`Duplicate source checkout: ${name}`);
    sourceRoots[name] = path.resolve(separator < 1 ? value : value.slice(separator + 1));
  }
  return { sourceRoots, outputDirectory };
}

function main(args = process.argv.slice(2)) {
  const options = parseBuildArguments(args);
  const catalogs = generateSourceCatalogs(options);
  console.log(`Generated ${catalogs.length} source catalog(s): ${catalogs.map((catalog) =>
    `${catalog.catalog_name} (${catalog.resources.length} skills, ${catalog.source_ref})`).join(", ")}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildSourceCatalog, catalogFromCheckout, generateSourceCatalogs, parseBuildArguments, main,
};
