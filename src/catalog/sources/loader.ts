"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const {
  CATALOG_NAME, CatalogError, readUtf8, validateSourceCatalog,
} = require("../resources/index.js");
const { loadSourceConfiguration, validateSourceConfiguration } = require("./config.js");

const SOURCE_WORKFLOW = "pages.yml";
const SOURCE_ARTIFACT = "source-catalogs";
const CACHE_MAX_AGE = 60 * 60 * 1000;
const MAX_INDEX_BYTES = 2 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;

function sourceCacheFile() {
  const home = os.homedir();
  const directory = process.platform === "win32"
    ? process.env.LOCALAPPDATA || path.join(home, "AppData", "Local")
    : process.platform === "darwin"
      ? path.join(home, "Library", "Caches")
      : process.env.XDG_CACHE_HOME || path.join(home, ".cache");
  if (!path.isAbsolute(directory)) {
    throw new CatalogError("The source catalog cache directory must be an absolute path");
  }
  return path.join(directory, "kitia", "source-catalogs.json");
}

function readIndex(file, maxBytes = MAX_INDEX_BYTES) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > maxBytes) {
    throw new CatalogError(`Catalog index must be a regular JSON file of at most ${maxBytes} bytes`);
  }
  try {
    return JSON.parse(readUtf8(file, "Catalog index"));
  } catch (error) {
    if (error instanceof CatalogError) throw error;
    throw new CatalogError(`Cannot read catalog index: ${error.message}`);
  }
}

function gh(args, spawn, timeout = 15000) {
  const result = spawn("gh", args, {
    encoding: "utf8", timeout, maxBuffer: MAX_ARTIFACT_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GH_PROMPT_DISABLED: "1" },
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr?.trim() || `exit status ${result.status}`;
    throw new CatalogError(
      `Cannot retrieve source catalogs with GitHub CLI: ${detail}. Authenticate gh with read access to ${CATALOG_NAME}, Actions and the configured source repositories (including organization SSO when required).`,
      "CATALOG_UNAVAILABLE",
    );
  }
  return result.stdout;
}

function githubJson(endpoint, spawn) {
  try {
    return JSON.parse(gh(["api", "--hostname", "github.com", endpoint], spawn));
  } catch (error) {
    if (error instanceof CatalogError) throw error;
    throw new CatalogError("GitHub returned an invalid JSON response for source catalogs");
  }
}

function sameSources(left, right) {
  return left.length === right.length && left.every((source, index) =>
    source.name === right[index].name && source.repositoryId === right[index].repositoryId);
}

function validateCatalogSet(entries, sources, sourceDirectory = "") {
  if (!Array.isArray(entries) || entries.length !== sources.length) {
    throw new CatalogError("Source catalog set does not match catalogSources.json");
  }
  const byName = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry.name !== "string" || byName.has(entry.name)) {
      throw new CatalogError("Source catalog set contains an invalid or duplicate catalog name");
    }
    byName.set(entry.name, entry.catalog);
  }
  return sources.flatMap((source) => {
    if (!byName.has(source.name)) {
      throw new CatalogError(`Source catalog set is missing ${source.name}`);
    }
    return validateSourceCatalog(byName.get(source.name), {
      ...source,
      label: `${sourceDirectory ? `${sourceDirectory}/` : ""}${source.name}.json`,
    }).map((resource) => ({ ...resource, catalog: source.name }));
  });
}

function readSourceCatalogsDirectory(directory, sources) {
  const rootEntries = fs.readdirSync(directory).sort();
  const sourceFiles = sources.map(({ name }) => `${name}.json`).sort();
  const sameEntries = (actual, expected) =>
    actual.length === expected.length && actual.every((entry, index) => entry === expected[index]);
  const flatEntries = ["catalogSources.json", ...sourceFiles].sort();
  let catalogDirectory = directory;
  let legacyLayout = false;
  if (!sameEntries(rootEntries, flatEntries) &&
      sameEntries(rootEntries, ["catalogSources.json", "catalogs"])) {
    catalogDirectory = path.join(directory, "catalogs");
    const stat = fs.lstatSync(catalogDirectory);
    if (!stat.isDirectory()) {
      throw new CatalogError("Source catalog directory catalogs entry must be a directory");
    }
    const catalogFiles = fs.readdirSync(catalogDirectory).sort();
    if (!sameEntries(catalogFiles, sourceFiles)) {
      throw new CatalogError("Source catalog directory contains missing or unexpected catalog files");
    }
    legacyLayout = true;
  } else if (!sameEntries(rootEntries, flatEntries)) {
    throw new CatalogError(
      "Source catalog directory must contain catalogSources.json and exactly the configured source indexes",
    );
  }
  const publishedSources = validateSourceConfiguration(
    readIndex(path.join(directory, "catalogSources.json")),
  );
  if (!sameSources(publishedSources, sources)) {
    throw new CatalogError("Published source configuration differs from catalogSources.json in this CLI");
  }
  const catalogs = sources.map((source) => ({
    name: source.name,
    catalog: readIndex(path.join(catalogDirectory, `${source.name}.json`)),
  }));
  validateCatalogSet(catalogs, sources, legacyLayout ? "catalogs" : "");
  return catalogs;
}

function verifyPublishedSources(directory, sources) {
  return readSourceCatalogsDirectory(directory, sources);
}

function downloadSourceCatalogs(spawn, sources) {
  const response = githubJson(
    `repos/${CATALOG_NAME}/actions/workflows/${SOURCE_WORKFLOW}/runs?branch=main&status=success&per_page=5`,
    spawn,
  );
  if (!Array.isArray(response.workflow_runs)) {
    throw new CatalogError("GitHub returned an invalid workflow-run response");
  }
  for (const run of response.workflow_runs.slice(0, 5)) {
    if (!run || !Number.isSafeInteger(run.id) || run.id <= 0 || run.head_branch !== "main" ||
        run.head_repository?.full_name !== CATALOG_NAME ||
        run.path !== `.github/workflows/${SOURCE_WORKFLOW}` ||
        run.status !== "completed" || run.conclusion !== "success" ||
        !["push", "schedule", "workflow_dispatch"].includes(run.event)) continue;
    const artifacts = githubJson(`repos/${CATALOG_NAME}/actions/runs/${run.id}/artifacts?per_page=100`, spawn);
    if (!Array.isArray(artifacts.artifacts)) {
      throw new CatalogError("GitHub returned an invalid artifact response");
    }
    const matches = artifacts.artifacts.filter((entry) =>
      entry?.name === SOURCE_ARTIFACT && entry.expired === false);
    if (!matches.length) continue;
    if (matches.length !== 1 || !Number.isSafeInteger(matches[0].id) || matches[0].id <= 0 ||
        !Number.isSafeInteger(matches[0].size_in_bytes) || matches[0].size_in_bytes < 0 ||
        matches[0].size_in_bytes > MAX_ARTIFACT_BYTES) {
      throw new CatalogError("The published source catalog artifact is ambiguous or too large");
    }
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-source-catalogs-"));
    try {
      gh([
        "run", "download", String(run.id), "--repo", `github.com/${CATALOG_NAME}`,
        "--name", SOURCE_ARTIFACT, "--dir", temporary,
      ], spawn, 30000);
      return {
        run_id: run.id,
        artifact_id: matches[0].id,
        catalogs: verifyPublishedSources(temporary, sources),
      };
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
  throw new CatalogError(
    "No unexpired source-catalogs artifact was found in the five most recent successful main site builds. Run the site publication workflow or provide KITIA_SOURCE_CATALOGS.",
    "CATALOG_UNAVAILABLE",
  );
}

function readCache(file, sources) {
  let cache;
  try {
    cache = readIndex(file, MAX_ARTIFACT_BYTES + 4096);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (cache?.cache_version !== 1 || typeof cache.fetched_at !== "string" ||
      !Number.isFinite(Date.parse(cache.fetched_at)) ||
      !Number.isSafeInteger(cache.run_id) || cache.run_id <= 0 ||
      !Number.isSafeInteger(cache.artifact_id) || cache.artifact_id <= 0 ||
      !Array.isArray(cache.catalogs)) {
    throw new CatalogError(`Invalid or unsupported source catalog cache at ${file}; review and remove this cache file explicitly.`);
  }
  validateCatalogSet(cache.catalogs, sources);
  return cache;
}

function writeCache(file, cache) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(cache)}\n`, { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function loadSourceCatalogsFromDirectory(directory, sources) {
  return validateCatalogSet(readSourceCatalogsDirectory(directory, sources), sources);
}

function loadPublishedSourceCatalogs(
  {
    offline = false, refreshCatalog = false, dryRun = false,
    cacheFile = sourceCacheFile(),
    now = Date.now(),
  } = {},
  warn = (warning) => console.error(`Warning: ${warning.message}`),
  spawn = spawnSync,
  sources = loadSourceConfiguration(),
) {
  const cached = readCache(cacheFile, sources);
  const age = cached ? now - Date.parse(cached.fetched_at) : Infinity;
  if (offline) {
    if (!cached) {
      throw new CatalogError(
        "No cached source catalogs are available offline. Fetch once while online or provide KITIA_SOURCE_CATALOGS.",
        "CATALOG_UNAVAILABLE",
      );
    }
    return validateCatalogSet(cached.catalogs, sources);
  }
  if (!refreshCatalog && age >= 0 && age < CACHE_MAX_AGE) {
    return validateCatalogSet(cached.catalogs, sources);
  }
  let downloaded;
  try {
    downloaded = downloadSourceCatalogs(spawn, sources);
  } catch (error) {
    if (!cached || refreshCatalog || error.code !== "CATALOG_UNAVAILABLE") throw error;
    const pins = cached.catalogs.map(({ name, catalog }) =>
      `${name}@${catalog.source_ref}`).join(", ");
    warn({
      code: "SOURCE_CATALOG_STALE",
      message: `${error.message} Using the source catalog cache fetched at ${cached.fetched_at} (upstream ${pins}); freshness could not be checked.`,
    });
    return validateCatalogSet(cached.catalogs, sources);
  }
  if (!dryRun) {
    try {
      writeCache(cacheFile, {
        cache_version: 1, fetched_at: new Date(now).toISOString(), ...downloaded,
      });
    } catch (error) {
      warn({
        code: "SOURCE_CATALOG_CACHE_WRITE_FAILED",
        message: `Source catalogs were retrieved, but their cache could not be saved: ${error.message}`,
      });
    }
  }
  return validateCatalogSet(downloaded.catalogs, sources);
}

module.exports = {
  SOURCE_WORKFLOW, SOURCE_ARTIFACT, CACHE_MAX_AGE, MAX_INDEX_BYTES,
  sourceCacheFile, validateCatalogSet, loadSourceCatalogsFromDirectory, loadPublishedSourceCatalogs,
};
