"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const YAML = require("yaml");
const {
  CATALOG_ROOT, CATALOG_NAME, PROVENANCE_FIELDS, INSTALLABLE_KINDS, LOCAL_KINDS,
  CatalogError, rejectSymlinkPath, readUtf8, parseFrontmatter, frontmatterParts,
  loadCatalog, validateMetadata,
} = require("./index.js");

function readSourceFiles(resource, root) {
  root = fs.realpathSync(root);
  if (resource.kind !== "skill") {
    return [[path.basename(resource.source), fs.readFileSync(resource.source), false]];
  }

  let executableFiles;
  if (process.platform === "win32") {
    if (fs.existsSync(path.join(root, ".git"))) {
      const index = execFileSync("git", ["ls-files", "--stage", "-z", "--", "catalogs", "skills"], {
        cwd: root, encoding: "utf8",
      });
      executableFiles = new Set(index.split("\0").filter((entry) => entry.startsWith("100755 "))
        .map((entry) => entry.slice(entry.indexOf("\t") + 1)));
    } else {
      const buildFile = path.join(root, "dist", "catalog-build.json");
      executableFiles = new Set(fs.existsSync(buildFile)
        ? readBuildInfo(root).executable_files || []
        : []);
    }
  }
  const files = [];
  function visit(directory, relativeDirectory = "") {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name === "node_modules") {
        continue;
      }
      const absolutePath = path.join(directory, entry.name);
      rejectSymlinkPath(absolutePath, root);
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      if (relativePath === "catalog.json") {
        continue;
      }
      if (entry.isDirectory()) {
        visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        const executable = executableFiles
          ? executableFiles.has(path.relative(root, absolutePath).split(path.sep).join("/"))
          : Boolean(fs.statSync(absolutePath).mode & 0o111);
        files.push([relativePath, fs.readFileSync(absolutePath), executable]);
      } else {
        throw new CatalogError(`Unsupported file type in skill: ${absolutePath}`);
      }
    }
  }
  visit(resource.source);
  return files;
}

function validateResource(resource, root) {
  root = fs.realpathSync(root);
  if (!INSTALLABLE_KINDS.has(resource.kind)) {
    return;
  }
  if (resource.kind === "skill") {
    if (!fs.existsSync(resource.source) || !fs.statSync(resource.source).isDirectory()) {
      throw new CatalogError(`Skill directory does not exist: ${resource.source}`);
    }
    const skillFile = path.join(resource.source, "SKILL.md");
    rejectSymlinkPath(skillFile, root);
    if (!fs.existsSync(skillFile) || !fs.statSync(skillFile).isFile()) {
      throw new CatalogError(`Skill is missing SKILL.md: ${resource.source}`);
    }
    readSourceFiles(resource, root);
    validateMetadata(skillFile, resource, false);
    return;
  }

  if (!fs.existsSync(resource.source) || !fs.statSync(resource.source).isFile()) {
    throw new CatalogError(`${resource.kind} file does not exist: ${resource.source}`);
  }
  if (resource.kind === "agent") {
    validateMetadata(resource.source, resource, true);
    return;
  }
  if (!readUtf8(resource.source, "Instruction").trim()) {
    throw new CatalogError(`Instruction must not be empty: ${resource.source}`);
  }
}

function validateCatalog(catalogRoot = CATALOG_ROOT) {
  const root = fs.realpathSync(catalogRoot);
  const resources = loadCatalog(root);
  if (resources.some((resource) => !LOCAL_KINDS.has(resource.kind) || !resource.group)) {
    throw new CatalogError("catalog.json may contain only grouped installable resources");
  }
  for (const resource of resources) {
    validateResource(resource, root);
  }
  return resources;
}

function resourceDigest(resource, catalogRoot) {
  const root = fs.realpathSync(catalogRoot);
  const digest = crypto.createHash("sha256");
  digest.update(JSON.stringify({
    format: 2,
    kind: resource.kind,
    id: resource.id,
    applyTo: resource.kind === "instruction" ? resource.applyTo : null,
  }));
  digest.update("\0");
  for (const [relativePath, content, executable] of readSourceFiles(resource, root).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    digest.update(relativePath, "utf8");
    digest.update("\0");
    digest.update(content);
    digest.update("\0");
    digest.update(executable ? "executable\0" : "regular\0");
  }
  return digest.digest("hex");
}

function resourceProvenance(resource, catalogRoot, buildInfo, runtime) {
  return {
    "catalog-name": CATALOG_NAME,
    "catalog-resource": `${resource.kind}:${resource.id}`,
    "catalog-commit": buildInfo.commit,
    "catalog-version": buildInfo.package_version,
    "catalog-content-sha256": resourceDigest(resource, catalogRoot),
    "catalog-runtime": runtime,
  };
}

function injectProvenance(content, provenance, filePath) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(content);
  const { document, body } = frontmatterParts(text, filePath);
  const metadata = document.get("metadata", true);
  if (metadata && !YAML.isMap(metadata)) {
    throw new CatalogError(`${filePath} metadata must be a YAML mapping`);
  }
  if (!metadata) {
    document.set("metadata", document.createNode({}));
  }
  for (const field of PROVENANCE_FIELDS) {
    document.setIn(["metadata", field], provenance[field]);
  }
  return Buffer.from(`---\n${document.toString({ defaultStringType: "QUOTE_DOUBLE", defaultKeyType: "PLAIN" })}---\n${body}`, "utf8");
}

function parseInjectedMetadata(filePath) {
  const text = readUtf8(filePath, "Markdown file");
  if (!/^---\r?\n/.test(text) || !text.includes("catalog-name")) {
    return {};
  }
  const metadata = parseFrontmatter(text, filePath).get("metadata");
  if (!(metadata instanceof Map) || !metadata.has("catalog-name")) {
    return {};
  }
  return Object.fromEntries(PROVENANCE_FIELDS.map((field) => [field, metadata.get(field)]));
}

function readBuildInfo(catalogRoot = CATALOG_ROOT) {
  const root = fs.realpathSync(catalogRoot);
  const buildFile = path.join(root, "dist", "catalog-build.json");
  let buildInfo;
  if (fs.existsSync(buildFile) && !fs.existsSync(path.join(root, ".git"))) {
    try {
      buildInfo = JSON.parse(readUtf8(buildFile, "Catalog build metadata"));
    } catch (error) {
      if (error instanceof CatalogError) {
        throw error;
      }
      throw new CatalogError(`Cannot read build metadata ${buildFile}: ${error.message}`);
    }
  } else {
    const packageInfo = JSON.parse(readUtf8(path.join(root, "package.json"), "Package manifest"));
    const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    buildInfo = {
      catalog: CATALOG_NAME,
      commit: git(["rev-parse", "HEAD"]),
      package_version: packageInfo.version,
      dirty: git(["status", "--porcelain", "--untracked-files=all"]).length > 0,
    };
  }
  if (
    buildInfo.catalog !== CATALOG_NAME ||
    typeof buildInfo.commit !== "string" ||
    !/^[0-9a-f]{40}$/i.test(buildInfo.commit) ||
    typeof buildInfo.package_version !== "string" ||
    typeof buildInfo.dirty !== "boolean" ||
    (buildInfo.executable_files !== undefined &&
      (!Array.isArray(buildInfo.executable_files) ||
        buildInfo.executable_files.some((file) => typeof file !== "string")))
  ) {
    throw new CatalogError(`Invalid catalog build metadata: ${buildFile}`);
  }
  return buildInfo;
}

module.exports = {
  readSourceFiles, validateResource, validateCatalog, resourceDigest, resourceProvenance,
  injectProvenance, parseInjectedMetadata, readBuildInfo,
};
