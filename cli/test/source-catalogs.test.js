"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { afterEach, test } = require("node:test");
const {
  checkCatalogFreshness, createSourceIndex, manageCatalogCommand, updateCatalog, importCatalogConfigurationText,
} = require("../dist/catalog/sources/manage.js");
const { writeInstallPlan } = require("../dist/catalog/inventory/files.js");
const {
  installSourceFileResource, runGhSkill, listSkillVersions, listSkillVersionsAsync, latestSourceVersionAtRef, uniqueSkillVersionPrefixes,
  formatSkillVersionTable, resolveSkillVersionPrefix, buildSourceSkillArgs,
} = require("../dist/catalog/sources/skills.js");
const { loadUserSourceConfiguration, validateSourceConfiguration } = require("../dist/catalog/sources/config.js");
const { createDashboardActionHandler } = require("../dist/cli/dashboard.js");
const { recordSourceInstallation } = require("../dist/catalog/sources/installed.js");
const { loadCommandCatalogs } = require("../dist/catalog/loading.js");
const { findUnmanagedArtifacts, installedFingerprint, readInstallState } = require("../dist/catalog/inventory/index.js");
const { collectInstalledScopes } = require("../dist/catalog/lifecycle.js");
const { formatDashboardRows, listCatalogResources } = require("../dist/cli/catalog.js");
const { filterCatalogResources, cycleFilter, filterInventory, inventoryCatalogLabel, dashboardStatus } =
  require("../dist/dashboard/helpers.mjs");
const { renderInstalledResources } = require("../dist/dashboard/terminal.js");
const {
  checkInstalledResources, readInstalledSourceSkills, runSourceCommand, main: runCliMain,
  uninstallSourceResource, updateSourceResources,
} = require("../dist/cli/main.js");
const { parseArguments } = require("../dist/cli/arguments.js");
const { executeCommand } = require("../dist/cli/commands.js");
const { mergeRefreshedCatalogResources } = require("../dist/dashboard/helpers.mjs");
test("catalog discovery ranks exact identifiers and preserves existing filters", () => {
  const resources = [
    { id: "release-helper", kind: "skill", catalog: "main", description: "Helps with release notes", tags: ["release"] },
    { id: "release", kind: "agent", catalog: "main", description: "Prepares software releases", tags: ["automation"] },
    { id: "release-guide", kind: "instruction", catalog: "other", description: "Release process", tags: ["release"] },
  ];
  const ranked = listCatalogResources(resources, { query: "release" });
  assert.deepEqual(ranked.map(({ id }) => id), ["release", "release-helper", "release-guide"]);
  assert.deepEqual(listCatalogResources(resources, {
    query: "release", kind: "skill", tag: "release",
  }).map(({ id }) => id), ["release-helper"]);
  assert.deepEqual(filterCatalogResources(resources, "release", "main", "all")
    .map(({ id }) => id), ["release", "release-helper"]);
});

test("catalog browser search covers discovery metadata fields", () => {
  const resource = {
    id: "deploy-helper", kind: "skill", catalog: "main",
    category: "deployment", owner: "platform", tags: ["release"],
    status: "stable", license_status: "MIT", license_spdx: "MIT",
    use_when: "shipping software", example: "deploy release",
    expected_output: "deployment plan", source_repository: "org/tools",
    source_path: "skills/deploy-helper",
  };
  for (const query of [
    "deployment", "platform", "release", "stable", "MIT", "shipping",
    "deploy", "plan", "org/tools", "skills/deploy-helper",
  ]) {
    assert.deepEqual(filterCatalogResources([resource], query, "all", "all"), [resource], query);
  }
});
test("catalog browser filters compose tag, status, and SPDX license constraints", () => {
  const resources = [
    { id: "release-helper", kind: "skill", catalog: "main", tags: ["release"], status: "stable", license_status: "MIT", license_spdx: "MIT" },
    { id: "release-agent", kind: "agent", catalog: "main", tags: ["review"], status: "experimental", license_status: "Apache-2.0", license_spdx: "Apache-2.0" },
    { id: "release-guide", kind: "instruction", catalog: "other", tags: ["review"], status: "stable", license_status: "Proprietary" },
  ];
  assert.deepEqual(filterCatalogResources(resources, "", "all", "all", [], { tag: "review" })
    .map(({ id }) => id), ["release-agent", "release-guide"]);
  assert.deepEqual(filterCatalogResources(resources, "", "all", "all", [], { status: "stable" })
    .map(({ id }) => id), ["release-helper", "release-guide"]);
  assert.deepEqual(filterCatalogResources(resources, "", "all", "all", [], { license: "Apache-2.0" })
    .map(({ id }) => id), ["release-agent"]);
  assert.deepEqual(filterCatalogResources(resources, "release", "main", "skill", [], {
    tag: "release", status: "stable", license: "MIT",
  }).map(({ id }) => id), ["release-helper"]);
  assert.equal(cycleFilter("all", resources, "tag", "kind", "all"), "release");
});
test("dashboard preview, audit, and install dispatch use source audit and capture semantics", async () => {
  const { createDashboardActionHandler } = require("../dist/cli/dashboard.js");
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-dashboard-inspection-"));
  const configDirectory = path.join(temporary, "config");
  const indexDirectory = path.join(configDirectory, "source-catalogs");
  fs.mkdirSync(indexDirectory, { recursive: true });
  const repository = "https://github.com/org/repo";
  const configuration = { catalog_version: 1, sources: [{ name: "Test", repository }] };
  writeJson(path.join(configDirectory, "catalogSources.json"), configuration);
  writeJson(path.join(indexDirectory, "catalogSources.json"), configuration);
  const resource = {
    catalog: "Test", kind: "skill", id: "reviewer",
    source_repository: "org/repo", source_path: "skills/reviewer/SKILL.md",
    source_ref: "a".repeat(40), license_status: "MIT", description: "Review changes.",
  };
  writeJson(path.join(indexDirectory, "Test.json"), {
    catalog_version: 1, catalog_name: "Test", source_repository: "org/repo",
    source_ref: "a".repeat(40), resources: [{
      kind: "skill", id: "reviewer", source_path: "skills/reviewer/SKILL.md",
      description: "Review changes.", license_status: "MIT",
    }],
  });
  const previousConfig = process.env.KITIA_CONFIG_DIR;
  process.env.KITIA_CONFIG_DIR = configDirectory;
  try {
    const dispatched = [];
    const handler = createDashboardActionHandler(async (options) => {
      dispatched.push(options);
      options.output.log("Inspection output");
      return 0;
    });
    const invoke = (action, installOptions = {}) => handler(action, resource, {
      target: temporary, userTarget: temporary,
    }, { sourceResources: [resource] }, installOptions);
    await invoke("preview");
    await invoke("audit");
    await invoke("install");
    const ref = "b".repeat(40);
    await invoke("install", { ref });
    await invoke("update", { ref });
    assert.deepEqual(dispatched.map(({ command, audit, captureOutput, ref: selectedRef }) =>
      ({ command, audit, captureOutput, ref: selectedRef })), [
      { command: "preview", audit: undefined, captureOutput: true, ref: undefined },
      { command: "preview", audit: true, captureOutput: true, ref: undefined },
      { command: "install", audit: true, captureOutput: false, ref: undefined },
      { command: "install", audit: true, captureOutput: false, ref },
      { command: "update", audit: undefined, captureOutput: false, ref },
    ]);
  } finally {
    if (previousConfig === undefined) delete process.env.KITIA_CONFIG_DIR;
    else process.env.KITIA_CONFIG_DIR = previousConfig;
  }
});
test("dashboard installs the selected full skill revision from the revision picker", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 120;
  output.rows = 40;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const selectedSha = "b".repeat(40);
  const actions = [];
  const done = runDashboard([], input, output, [], {
    catalogResources: [{
      catalog: "Test", kind: "skill", id: "revision-skill",
      source_repository: "org/repo", source_path: "skills/revision-skill",
      source_ref: "a".repeat(40), license_status: "MIT",
    }],
    listSkillVersions: async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return [
        { sha: "a".repeat(40), prefix: "aaaaaaa", date: "2026-11-09T00:00:00Z", subject: "Current pin" },
        { sha: selectedSha, prefix: "bbbbbbb", date: "2026-11-08T00:00:00Z", subject: "Previous revision" },
      ];
    },
    execute: async (action, resource, options) => {
      actions.push({ action, resource: resource.id, ref: options.ref });
      await new Promise((resolve) => setTimeout(resolve, 400));
      return { code: 0, messages: ["Installed selected revision."], resources: [], errors: [] };
    },
  });
  let dashboardFinished = false;
  void done.then(() => { dashboardFinished = true; });
  await new Promise((resolve) => setTimeout(resolve, 80));
  input.write("a");
  await new Promise((resolve) => setTimeout(resolve, 80));
  input.write("v");
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.ok(["|", "/", "-", "\\"].some((frame) =>
    rendered.includes(`${frame} Loading commit history for revision-skill`)));
  await new Promise((resolve) => setTimeout(resolve, 160));
  input.write("\x1b[B");
  await new Promise((resolve) => setTimeout(resolve, 50));
  input.write("\r");
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.match(rendered, /Selected commit:/);
  assert.ok(rendered.includes(selectedSha));
  input.write("\r");
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.match(rendered, /CONFIRM INSTALL/);
  input.write("y");
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.ok(["|", "/", "-", "\\"].some((frame) =>
    rendered.includes(`${frame} Installing skill:revision-skill`)));
  assert.match(rendered, /LOADING/);
  input.write("q");
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(dashboardFinished, false, "input remains blocked while the loader popup is active");
  const displayedFrames = ["|", "/", "-", "\\"].filter((frame) =>
    rendered.includes(`${frame} Installing skill:revision-skill`));
  assert.ok(displayedFrames.length >= 2, `expected animation frames, got ${displayedFrames.join(", ")}`);
  await new Promise((resolve) => setTimeout(resolve, 250));
  input.write("q");
  assert.equal(await done, true);
  input.destroy();
  output.destroy();
});
test("dashboard shows the loading popup for consecutive actions", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 120;
  output.rows = 40;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  let callCount = 0;
  const done = runDashboard([], input, output, [], {
    catalogResources: [{
      catalog: "Test", kind: "skill", id: "repeat-skill",
      source_repository: "org/repo", source_path: "skills/repeat-skill",
      source_ref: "a".repeat(40), license_status: "MIT",
    }],
    execute: async () => {
      callCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 250));
      return { code: 0, messages: ["Preview ready."], resources: [], errors: [] };
    },
  });
  input.write("a");
  await new Promise((resolve) => setTimeout(resolve, 80));
  input.write("p");
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.match(rendered, /LOADING/);
  await new Promise((resolve) => setTimeout(resolve, 200));
  input.write("\r");
  await new Promise((resolve) => setTimeout(resolve, 80));
  const secondActionStart = rendered.length;
  input.write("p");
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.match(rendered.slice(secondActionStart), /LOADING/);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(callCount, 2);
  input.write("\r");
  await new Promise((resolve) => setTimeout(resolve, 30));
  input.write("q");
  assert.equal(await done, true);
  input.destroy();
  output.destroy();
});
test("dashboard revision picker applies a selected full SHA to a confirmed skill update", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 120;
  output.rows = 40;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const selectedSha = "c".repeat(40);
  const installedSkill = {
    catalog: "Test", kind: "skill", id: "revision-skill", managed: true,
    scope: "project", status: "current", source_repository: "org/repo",
    source_path: "skills/revision-skill/SKILL.md", source_ref: "a".repeat(40),
  };
  const actions = [];
  const done = runDashboard([installedSkill], input, output, [], {
    listSkillVersions: () => [
      { sha: "a".repeat(40), prefix: "aaaaaaa", date: "2026-11-09T00:00:00Z", subject: "Current pin" },
      { sha: selectedSha, prefix: "ccccccc", date: "2026-11-08T00:00:00Z", subject: "Previous revision" },
    ],
    execute: async (action, resource, options) => {
      actions.push({ action, resource: resource.id, ref: options.ref });
      return { code: 0, messages: ["Updated selected revision."], resources: [installedSkill], errors: [] };
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  input.write("v");
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.match(rendered, /SKILL REVISIONS/);
  input.write("\x1b[B");
  await new Promise((resolve) => setTimeout(resolve, 50));
  input.write("\r");
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.match(rendered, /CONFIRM UPDATE/);
  assert.ok(rendered.includes(selectedSha));
  input.write("y");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(actions, [{ action: "update", resource: "revision-skill", ref: selectedSha }]);
  input.write("q");
  assert.equal(await done, true);
  input.destroy();
  output.destroy();
});



let temporary;

afterEach(() => {
  if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
  temporary = null;
});
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
test("refreshing one catalog replaces only its resources in the catalog list", () => {
  const existingAlpha = { catalog: "Alpha", kind: "agent", id: "old-agent" };
  const existingBeta = { catalog: "Beta", kind: "skill", id: "unchanged-skill" };
  const updatedAlpha = { catalog: "Alpha", kind: "agent", id: "new-agent" };
  const unrelatedBetaUpdate = { catalog: "Beta", kind: "skill", id: "new-beta-skill" };

  assert.deepEqual(mergeRefreshedCatalogResources(
    [existingAlpha, existingBeta],
    [updatedAlpha, unrelatedBetaUpdate],
    ["alpha"],
  ), [updatedAlpha, existingBeta]);
});

test("Matt Pocock catalog preset resolves to its repository", () => {
  assert.deepEqual(parseArguments(["catalog", "add", "matt-pocock"]), {
    command: "catalog",
    action: "add",
    name: "matt-pocock",
    repository: "https://github.com/mattpocock/skills",
  });
});
test("Anthropics catalog preset resolves to its repository", () => {
  assert.deepEqual(parseArguments(["catalog", "add", "anthropics"]), {
    command: "catalog",
    action: "add",
    name: "Anthropics",
    repository: "https://github.com/anthropics/skills",
  });
});
test("GitHub Awesome Copilot catalog preset resolves to its repository", () => {
  assert.deepEqual(parseArguments(["catalog", "add", "github-awesome-copilot"]), {
    command: "catalog",
    action: "add",
    name: "github-awesome-copilot",
    repository: "https://github.com/github/awesome-copilot",
  });
});

test("first Kitia use preserves existing Kiti catalog settings", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-config-migration-"));
  const home = path.join(temporary, "home");
  const legacy = path.join(home, ".config", "kiti");
  const current = path.join(home, ".config", "kitia");
  const manifest = {
    catalog_version: 1,
    sources: [{ name: "Test", repository: "https://github.com/grasdouble/AI-Kit" }],
  };
  writeJson(path.join(legacy, "catalogSources.json"), manifest);
  writeJson(path.join(legacy, "source-catalogs", "Test.json"), { catalog_name: "Test" });

  const previous = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    KITIA_CONFIG_DIR: process.env.KITIA_CONFIG_DIR,
  };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.KITIA_CONFIG_DIR;
  try {
    assert.deepEqual(loadUserSourceConfiguration().map(({ name }) => name), ["Test"]);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(current, "catalogSources.json"), "utf8")), manifest);
    assert.equal(fs.existsSync(path.join(current, "source-catalogs", "Test.json")), true);
    assert.equal(fs.existsSync(path.join(legacy, "catalogSources.json")), true);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("onboarding defaults its project scan to the current directory", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-onboarding-target-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(temporary);
    const options = parseArguments(["onboarding"]);
    assert.equal(options.target, ".");
    assert.deepEqual(collectInstalledScopes({ project: options.target, user: temporary }, []).errors, []);
  } finally {
    process.chdir(previousCwd);
  }
});

test("dashboard shows the installed and available versions with the changelog link", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const previousVersion = process.env.KITIA_INSTALLED_VERSION;
  const previousFetch = global.fetch;
  process.env.KITIA_INSTALLED_VERSION = "1.0.0";
  global.fetch = async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return { ok: true, json: async () => ({ version: "1.0.2" }) };
  };
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 120;
  output.rows = 40;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  let done;
  const plain = () => rendered.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  try {
    done = runDashboard([], input, output);
    const deadline = Date.now() + 2_000;
    while (!plain().includes("NEW VERSION AVAILABLE") && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.match(plain(), /NEW VERSION AVAILABLE/);
    assert.match(plain(), /Installed: 1\.0\.0/);
    assert.match(plain(), /Available: 1\.0\.2/);
    assert.match(plain(), /github\.com\/grasdouble\/Kitia\/blob\/main\/CHANGELOG\.md#102/);
  } finally {
    if (done) {
      input.write("\x1b");
      await new Promise((resolve) => setTimeout(resolve, 50));
      input.write("q");
      await done;
    }
    input.destroy();
    output.destroy();
    if (previousVersion === undefined) delete process.env.KITIA_INSTALLED_VERSION;
    else process.env.KITIA_INSTALLED_VERSION = previousVersion;
    global.fetch = previousFetch;
  }
});

test("no-argument CLI defaults to the dashboard", () => {
  assert.deepEqual(parseArguments([]), { command: "dashboard", target: "." });
});


test("catalog freshness compares cached index with remote default branch", async () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-catalog-freshness-"));
  const previousConfig = process.env.KITIA_CONFIG_DIR;
  const configDirectory = path.join(temporary, "config");
  const repository = "https://github.com/example/test";
  const revision = "a".repeat(40);
  const remote = (ref) => async () => ({ stdout: `${ref}\tHEAD\n` });
  try {
    process.env.KITIA_CONFIG_DIR = configDirectory;
    writeJson(path.join(configDirectory, "catalogSources.json"), {
      catalog_version: 1,
      sources: [{ name: "Test", repository }],
    });
    writeJson(path.join(configDirectory, "source-catalogs", "Test.json"), {
      catalog_name: "Test",
      source_repository: "example/test",
      source_ref: revision,
      resources: [],
    });
    assert.deepEqual(await checkCatalogFreshness(remote(revision)), [
      { name: "Test", status: "current" },
    ]);
    assert.deepEqual(await checkCatalogFreshness(remote("b".repeat(40))), [
      { name: "Test", status: "outdated" },
    ]);
    assert.deepEqual(await checkCatalogFreshness(async () => {
      throw new Error("network unavailable");
    }), [{ name: "Test", status: "unknown" }]);
  } finally {
    if (previousConfig === undefined) delete process.env.KITIA_CONFIG_DIR;
    else process.env.KITIA_CONFIG_DIR = previousConfig;
  }
});

function createSource(name, repository) {
  const source = path.join(temporary, name);
  const skill = path.join(source, "skills", "demo-skill");
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, "SKILL.md"), [
    "---",
    "name: demo-skill",
    "description: A generated source skill.",
    "license: MIT",
    "---",
    "",
    "Synthetic body that must not appear in the index.",
    "",
  ].join("\n"));
  execFileSync("git", ["init", "--quiet", source]);
  execFileSync("git", ["-C", source, "remote", "add", "origin", repository]);
  execFileSync("git", ["-C", source, "add", "."]);
  execFileSync("git", [
    "-C", source, "-c", "user.name=Catalog fixtures", "-c",
    "user.email=fixtures@example.invalid", "-c", "commit.gpgsign=false",
    "commit", "--quiet", "-m", "Add synthetic skill",
  ]);
  return source;
}
test("user catalogs can be added, listed and removed without repository manifests", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-user-catalog-lifecycle-"));
  const repository = "https://github.com/example/user-catalog";
  const upstream = createSource("upstream", repository);
  const configDirectory = path.join(temporary, "config");
  const environmentKeys = [
    "KITIA_CONFIG_DIR", "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0",
  ];
  const previousEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  process.env.KITIA_CONFIG_DIR = configDirectory;
  process.env.GIT_CONFIG_COUNT = "1";
  process.env.GIT_CONFIG_KEY_0 = `url.${pathToFileURL(upstream).href}.insteadOf`;
  process.env.GIT_CONFIG_VALUE_0 = repository;
  const run = (args) => {
    const logs = [];
    const errors = [];
    const code = manageCatalogCommand({
      ...parseArguments(["catalog", ...args]),
      output: { log: (message) => logs.push(message), error: (message) => errors.push(message) },
    });
    return { code, logs, errors };
  };
  try {
    const added = run(["add", "team-alpha", repository]);
    assert.equal(added.code, 0, added.errors.join("\n"));
    assert.match(added.logs.join("\n"), /Added catalog team-alpha/);
    assert.deepEqual(run(["list"]).logs, [`team-alpha\t${repository}`]);
    assert.equal(fs.existsSync(path.join(configDirectory, "source-catalogs", "team-alpha.json")), true);
    assert.equal(parseArguments(["list", "--catalog", "team-alpha"]).catalog, "team-alpha");
    const loaded = loadCommandCatalogs({ command: "list", catalog: "team-alpha" }, () => {});
    assert.ok(loaded.sourceResources.length > 0);
    assert.ok(loaded.sourceResources.every((resource) => resource.catalog === "team-alpha"));
    assert.equal(run(["remove", "team-alpha"]).code, 0);
    assert.deepEqual(loadUserSourceConfiguration(), []);
    assert.equal(fs.existsSync(path.join(configDirectory, "source-catalogs", "team-alpha.json")), false);
  } finally {
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
test("catalog import skips same-name and same-repository entries but adds non-conflicting catalogs", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-import-catalog-config-"));
  const previousConfig = process.env.KITIA_CONFIG_DIR;
  const directory = path.join(temporary, "config");
  process.env.KITIA_CONFIG_DIR = directory;
  try {
    const existing = {
      catalog_version: 1,
      sources: [{ name: "Shared", repository: "https://github.com/example/existing" }],
    };
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "catalogSources.json"), JSON.stringify(existing));
    const summary = importCatalogConfigurationText(JSON.stringify({
      catalog_version: 1,
      sources: [
        { name: "Shared", repository: "https://github.com/example/other" },
        { name: "Renamed", repository: "https://github.com/example/existing" },
        { name: "New", repository: "https://github.com/example/new" },
        { name: "Offline", repository: "https://github.com/example/offline" },
      ],
    }), (names) => {
      assert.deepEqual(names, ["New", "Offline"]);
      return {
        refreshed: [{ name: "New", count: 2 }],
        failures: [{ name: "Offline", message: "network unavailable" }],
      };
    });
    assert.deepEqual(summary, {
      added: ["New", "Offline"],
      ignored: [
        { name: "Shared", reason: "Catalog name already exists." },
        {
          name: "Renamed",
          reason: "Repository already registered as another catalog (example/existing).",
        },
      ],
      refreshed: [{ name: "New", count: 2 }],
      refreshFailures: [{ name: "Offline", message: "network unavailable" }],
    });
    assert.deepEqual(loadUserSourceConfiguration().map(({ name }) => name), ["Shared", "New", "Offline"]);
  } finally {
    if (previousConfig === undefined) delete process.env.KITIA_CONFIG_DIR;
    else process.env.KITIA_CONFIG_DIR = previousConfig;
  }
});

test("catalog refresh updates one or all configured user indexes", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-refresh-catalog-"));
  const repositoryUrls = [
    "https://github.com/example/refresh-alpha",
    "https://github.com/example/refresh-beta",
  ];
  const alpha = createSource("alpha-upstream", repositoryUrls[0]);
  const beta = createSource("beta-upstream", repositoryUrls[1]);
  const configDirectory = path.join(temporary, "config");
  const sourceIndexDirectory = path.join(configDirectory, "source-catalogs");
  const betaEntry = { kind: "instruction", id: "review-policy", path: "policies/review-policy.instructions.md" };
  fs.mkdirSync(path.dirname(path.join(beta, betaEntry.path)), { recursive: true });
  fs.writeFileSync(path.join(beta, betaEntry.path), [
    "---", "name: review-policy", "description: Original policy.", "apply_to:", "  - src/**",
    "---", "", "Policy body.",
  ].join("\n"));
  execFileSync("git", ["-C", beta, "add", "."]);
  execFileSync("git", [
    "-C", beta, "-c", "user.name=Catalog fixtures", "-c",
    "user.email=fixtures@example.invalid", "-c", "commit.gpgsign=false",
    "commit", "--quiet", "-m", "Add source policy",
  ]);
  const sources = [
    { name: "Alpha", repository: repositoryUrls[0] },
    { name: "Beta", repository: repositoryUrls[1], mode: "custom", entries: [betaEntry] },
  ];
  const registry = { catalog_version: 1, sources };
  const envKeys = [
    "KITIA_CONFIG_DIR", "GIT_CONFIG_COUNT",
    "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0", "GIT_CONFIG_KEY_1", "GIT_CONFIG_VALUE_1",
  ];
  const previousEnvironment = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  try {
    process.env.KITIA_CONFIG_DIR = configDirectory;
    process.env.GIT_CONFIG_COUNT = "2";
    process.env.GIT_CONFIG_KEY_0 = `url.${pathToFileURL(alpha).href}.insteadOf`;
    process.env.GIT_CONFIG_VALUE_0 = repositoryUrls[0];
    process.env.GIT_CONFIG_KEY_1 = `url.${pathToFileURL(beta).href}.insteadOf`;
    process.env.GIT_CONFIG_VALUE_1 = repositoryUrls[1];
    writeJson(path.join(configDirectory, "catalogSources.json"), registry);
    writeJson(path.join(sourceIndexDirectory, "catalogSources.json"), registry);
    writeJson(path.join(sourceIndexDirectory, "Alpha.json"),
      createSourceIndex(repositoryUrls[0], "Alpha", alpha));
    writeJson(path.join(sourceIndexDirectory, "Beta.json"),
      createSourceIndex(repositoryUrls[1], "Beta", beta, { mode: "custom", entries: [betaEntry] }));
    const betaOriginalRef = JSON.parse(fs.readFileSync(path.join(sourceIndexDirectory, "Beta.json"), "utf8")).source_ref;

    const agent = path.join(alpha, "agents", "release.agent.md");
    fs.mkdirSync(path.dirname(agent), { recursive: true });
    fs.writeFileSync(agent, "---\nname: release\ndescription: Release agent.\n---\n\nAgent body.\n");
    fs.writeFileSync(path.join(beta, betaEntry.path), [
      "---", "name: review-policy", "description: Updated policy.", "apply_to:", "  - src/**",
      "---", "", "Updated policy body.",
    ].join("\n"));
    for (const source of [alpha, beta]) {
      execFileSync("git", ["-C", source, "add", "."]);
      execFileSync("git", [
        "-C", source, "-c", "user.name=Catalog fixtures", "-c",
        "user.email=fixtures@example.invalid", "-c", "commit.gpgsign=false",
        "commit", "--quiet", "-m", "Update source artifacts",
      ]);
    }

    const runCommand = (args) => {
      const logs = [];
      const errors = [];
      const code = manageCatalogCommand({
        ...parseArguments(args),
        output: { log: (message) => logs.push(message), error: (message) => errors.push(message) },
      });
      return { code, logs, errors };
    };
    const single = runCommand(["catalog", "refresh", "Alpha"]);
    assert.equal(single.code, 0);
    assert.match(single.logs.join("\n"), /Refreshed catalog Alpha/);
    const alphaIndex = JSON.parse(fs.readFileSync(path.join(sourceIndexDirectory, "Alpha.json"), "utf8"));
    assert.ok(alphaIndex.resources.some(({ kind, id }) => kind === "agent" && id === "release"));
    assert.equal(JSON.parse(fs.readFileSync(path.join(sourceIndexDirectory, "Beta.json"), "utf8")).source_ref,
      betaOriginalRef);

    const all = runCommand(["catalog", "refresh", "--all"]);
    assert.equal(all.code, 0);
    assert.match(all.logs.join("\n"), /Refreshed catalog Alpha/);
    assert.match(all.logs.join("\n"), /Refreshed catalog Beta/);
    const betaIndex = JSON.parse(fs.readFileSync(path.join(sourceIndexDirectory, "Beta.json"), "utf8"));
    assert.equal(betaIndex.resources.find(({ id }) => id === "review-policy").description, "Updated policy.");
    assert.deepEqual(loadUserSourceConfiguration().find(({ name }) => name === "Beta").entries, [betaEntry]);
    assert.deepEqual(loadUserSourceConfiguration().find(({ name }) => name === "Beta").mode, "custom");
    const userConfigurationFile = path.join(configDirectory, "catalogSources.json");
    const configurationBeforeUpdate = JSON.parse(fs.readFileSync(userConfigurationFile, "utf8"));
    const betaIndexBeforeUpdate = fs.readFileSync(path.join(sourceIndexDirectory, "Beta.json"), "utf8");
    assert.throws(() => updateCatalog("Beta", "Beta", repositoryUrls[1], {
      mode: "custom", entries: [{ kind: "instruction", path: "missing" }],
    }), /Source resource does not exist/);
    assert.deepEqual(JSON.parse(fs.readFileSync(userConfigurationFile, "utf8")), configurationBeforeUpdate);
    assert.equal(fs.readFileSync(path.join(sourceIndexDirectory, "Beta.json"), "utf8"), betaIndexBeforeUpdate);
    assert.throws(() => updateCatalog("Beta", "Alpha", repositoryUrls[1]), /Catalog already exists/);
    const updated = updateCatalog("Beta", "BetaEdited", repositoryUrls[1], {
      mode: "custom", entries: [{ kind: "instruction", path: "policies/" }],
    });
    assert.equal(updated.catalog_name, "BetaEdited");
    assert.deepEqual(updated.resources.map(({ kind, id }) => `${kind}:${id}`), [
      "instruction:review-policy",
    ]);
    const updatedSources = loadUserSourceConfiguration();
    assert.deepEqual(updatedSources.map(({ name }) => name), ["Alpha", "BetaEdited"]);
    assert.deepEqual(updatedSources.find(({ name }) => name === "BetaEdited").entries, [
      { kind: "instruction", path: "policies" },
    ]);
    assert.equal(fs.existsSync(path.join(sourceIndexDirectory, "Beta.json")), false);
    assert.equal(fs.existsSync(path.join(sourceIndexDirectory, "BetaEdited.json")), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(sourceIndexDirectory, "catalogSources.json"), "utf8")),
      JSON.parse(fs.readFileSync(userConfigurationFile, "utf8")));
  } finally {
    for (const key of envKeys) {
      if (previousEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnvironment[key];
    }
  }
});



test("Basic source indexing discovers categorized skills, agents, and instructions", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-categorized-source-"));
  const repository = "https://github.com/example/categorized";
  const source = createSource("categorized", repository);
  const skill = path.join(source, "skills", "engineering", "research");
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, "SKILL.md"), [
    "---",
    "name: research",
    "description: Research sources: follow first-party references.",
    "---",
    "",
    "Synthetic categorized skill.",
  ].join("\n"));
  const agent = path.join(source, "agents", "engineering", "release.agent.md");
  const friendlyNamedAgent = path.join(source, "agents", "accessibility-runtime-tester.agent.md");
  const instruction = path.join(source, ".github", "instructions", "checklist.instructions.md");
  fs.mkdirSync(path.dirname(agent), { recursive: true });
  fs.mkdirSync(path.dirname(instruction), { recursive: true });
  fs.writeFileSync(agent, [
    "---", "name: release", "description: Release agent.", "---", "", "Agent body.",
  ].join("\n"));
  fs.writeFileSync(friendlyNamedAgent, [
    "---", "name: Accessibility Runtime Tester", "---", "", "Accessibility agent.",
  ].join("\n"));
  fs.writeFileSync(instruction, [
    "---", "name: checklist", "description: Review checklist.",
    "applyTo: src/**", "---", "", "Instruction body.",
  ].join("\n"));
  fs.writeFileSync(path.join(source, "agents", "README.md"), "Not an agent resource.");
  const globalInstruction = path.join(source, "instructions", "global-guidance.md");
  fs.mkdirSync(path.dirname(globalInstruction), { recursive: true });
  fs.writeFileSync(globalInstruction, "# Global guidance\nApply this guidance across the repository.\n");
  execFileSync("git", ["-C", source, "add", "."]);
  execFileSync("git", [
    "-C", source, "-c", "user.name=Catalog fixtures", "-c",
    "user.email=fixtures@example.invalid", "-c", "commit.gpgsign=false",
    "commit", "--quiet", "-m", "Add categorized skill, agent and instructions",
  ]);

  const catalog = createSourceIndex(repository, "categorized", source);
  assert.equal(catalog.resources.find((entry) => entry.id === "research").source_path,
    "skills/engineering/research");
  assert.equal(catalog.resources.find((entry) => entry.id === "research").description,
    "Research sources: follow first-party references.");
  assert.deepEqual(catalog.resources.map(({ kind, id }) => `${kind}:${id}`).sort(), [
    "agent:accessibility-runtime-tester", "agent:release", "instruction:checklist",
    "instruction:global-guidance", "skill:demo-skill", "skill:research",
  ]);
  assert.equal(catalog.resources.find((entry) => entry.id === "release").source_path,
    "agents/engineering/release.agent.md");
  assert.equal(catalog.resources.find((entry) => entry.id === "accessibility-runtime-tester").description,
    "Accessibility agent.");
  const scopedInstruction = catalog.resources.find((entry) => entry.id === "checklist");
  assert.equal(scopedInstruction.source_path, ".github/instructions/checklist.instructions.md");
  assert.deepEqual(scopedInstruction.apply_to, ["src/**"]);
  const globalResource = catalog.resources.find((entry) => entry.id === "global-guidance");
  assert.equal(globalResource.source_path, "instructions/global-guidance.md");
  assert.deepEqual(globalResource.apply_to, ["**"]);
  assert.equal(catalog.resources.some(({ id }) => id === "readme"), false);
});
test("custom catalog mappings index explicit paths and default unscoped instructions globally", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-custom-source-"));
  const repository = "https://github.com/example/custom";
  const source = createSource("custom", repository);
  const skill = path.join(source, "custom-skills", "workflow", "review");
  const agent = path.join(source, "specialists", "release.agent.md");
  const instruction = path.join(source, "policies", "checklist.instructions.md");
  fs.mkdirSync(skill, { recursive: true });
  fs.mkdirSync(path.dirname(agent), { recursive: true });
  fs.mkdirSync(path.dirname(instruction), { recursive: true });
  fs.writeFileSync(path.join(skill, "SKILL.md"), [
    "---", "name: review", "description: Review changes.", "---", "", "Skill body.",
  ].join("\n"));
  fs.writeFileSync(agent, [
    "---", "name: release", "description: Release agent.", "---", "", "Agent body.",
  ].join("\n"));
  fs.writeFileSync(instruction, [
    "---", "name: checklist", "description: Review checklist.",
    "apply_to:", "  - src/**", "  - tests/**", "---", "", "Instruction body.",
  ].join("\n"));
  execFileSync("git", ["-C", source, "add", "."]);
  execFileSync("git", [
    "-C", source, "-c", "user.name=Catalog fixtures", "-c",
    "user.email=fixtures@example.invalid", "-c", "commit.gpgsign=false",
    "commit", "--quiet", "-m", "Add custom resource paths",
  ]);

  const configuration = validateSourceConfiguration({
    catalog_version: 1,
    sources: [{
      name: "custom",
      repository,
      mode: "custom",
      entries: [
        { kind: "skill", path: "custom-skills/workflow/review" },
        { kind: "agent", path: "specialists/release.agent.md" },
        { kind: "instruction", path: "policies/checklist.instructions.md" },
      ],
    }],
  })[0];
  assert.deepEqual(configuration.entries.map(({ kind, id }) => [kind, id]), [
    ["skill", undefined], ["agent", "release"], ["instruction", "checklist"],
  ]);
  const catalog = createSourceIndex(repository, "custom", source, configuration);
  assert.deepEqual(catalog.resources.map(({ kind, id }) => `${kind}:${id}`).sort(), [
    "agent:release", "instruction:checklist", "skill:review",
  ]);
  assert.equal(catalog.resources.find(({ kind }) => kind === "skill").source_path,
    "custom-skills/workflow/review");
  assert.deepEqual(catalog.resources.find(({ kind }) => kind === "instruction").apply_to,
    ["src/**", "tests/**"]);
  assert.equal(catalog.resources.some(({ id }) => id === "demo-skill"), false);
  const target = path.join(temporary, "target");
  fs.mkdirSync(target);
  const fileActions = [];
  const agentResource = catalog.resources.find(({ kind }) => kind === "agent");
  assert.deepEqual(installSourceFileResource({ ...agentResource, catalog: "custom" }, target, "both", {
    dryRun: true, onAction: (action) => fileActions.push(action),
  }), [".claude/agents/release.md", ".github/agents/release.agent.md"]);
  const instructionResource = catalog.resources.find(({ kind }) => kind === "instruction");
  assert.deepEqual(installSourceFileResource({
    ...instructionResource, catalog: "custom",
  }, target, "both", {
    dryRun: true, onAction: (action) => fileActions.push(action),
  }), [".claude/rules/checklist.md", ".github/instructions/checklist.instructions.md"]);
  assert.deepEqual(fileActions.map(({ path: relativePath }) => relativePath), [
    ".claude/agents/release.md", ".github/agents/release.agent.md",
    ".claude/rules/checklist.md", ".github/instructions/checklist.instructions.md",
  ]);

  const firstPath = path.join(target, ".claude/agents/release.md");
  const secondPath = path.join(target, ".github/agents/release.agent.md");
  fs.mkdirSync(path.dirname(firstPath), { recursive: true });
  fs.mkdirSync(path.dirname(secondPath), { recursive: true });
  fs.writeFileSync(firstPath, "existing claude agent\n");
  fs.writeFileSync(secondPath, "existing copilot agent\n");
  const originalRename = fs.renameSync;
  let renameCount = 0;
  fs.renameSync = (...args) => {
    renameCount += 1;
    if (renameCount === 3) throw new Error("injected third-file write failure");
    return originalRename(...args);
  };
  const thirdPath = path.join(target, ".claude/rules/checklist.md");
  fs.mkdirSync(path.dirname(thirdPath), { recursive: true });
  fs.writeFileSync(thirdPath, "existing instruction\n");
  try {
    const plan = new Map([
      [".claude/agents/release.md", { content: Buffer.from("new claude agent\n"), executable: false }],
      [".claude/rules/checklist.md", { content: Buffer.from("new instruction\n"), executable: false }],
      [".github/agents/release.agent.md", { content: Buffer.from("new copilot agent\n"), executable: false }],
    ]);
    assert.throws(() => writeInstallPlan(plan, target, { force: true }),
      /injected third-file write failure/);
  } finally {
    fs.renameSync = originalRename;
  }
  assert.equal(fs.readFileSync(firstPath, "utf8"), "existing claude agent\n");
  assert.equal(fs.readFileSync(secondPath, "utf8"), "existing copilot agent\n");
  assert.equal(fs.readFileSync(thirdPath, "utf8"), "existing instruction\n");
  assert.equal(fs.existsSync(path.join(target, ".agents/kitia-lock.json")), false);
  assert.throws(() => validateSourceConfiguration({
    catalog_version: 1,
    sources: [{
      name: "unsafe",
      repository: "https://github.com/example/unsafe",
      mode: "custom",
      entries: [{ kind: "agent", path: "../escape.agent.md" }],
    }],
  }), /safe repository-relative path/);
  fs.writeFileSync(instruction, "# Checklist without an explicit scope\n");
  const unscopedCatalog = createSourceIndex(repository, "custom", source, configuration);
  assert.deepEqual(unscopedCatalog.resources.find(({ kind }) => kind === "instruction").apply_to, ["**"]);
  fs.writeFileSync(instruction, "---\napply_to: []\n---\n\nInvalid policy.\n");
  assert.throws(() => createSourceIndex(repository, "custom", source, configuration),
    /example\/custom:policies\/checklist\.instructions\.md must define a non-empty/);
});

test("inventory labels custom catalogs from the most specific configured source folders", () => {
  const resource = (kind, id, source_path, catalog = "MattPucock") => ({
    catalog, kind, id, source_path, source_repository: "example/resources", managed: true,
  });
  const resources = [
    resource("skill", "review", "skills/engineering/review"),
    resource("skill", "review-special", "skills/engineering/review"),
    resource("skill", "writing", "skills/productivity/writing"),
    resource("agent", "release-bot", "agents/release.agent.md"),
    resource("instruction", "policy", "policies/checklist.instructions.md"),
    resource("agent", "first-release", "one/engineering/release.agent.md"),
    resource("agent", "second-release", "two/engineering/release.agent.md"),
    resource("skill", "basic", "skills/basic", "BasicCatalog"),
    resource("skill", "unmapped", "elsewhere/unmapped"),
    { ...resource("skill", "unmanaged", "skills/engineering/unmanaged"), managed: false },
  ];
  const catalogs = [
    {
      name: "MattPucock",
      mode: "custom",
      entries: [
        { kind: "skill", path: "skills" },
        { kind: "skill", id: "review-special", path: "skills/engineering/review/SKILL.md" },
        { kind: "skill", path: "skills/productivity" },
        { kind: "agent", id: "release-bot", path: "agents/release.agent.md" },
        { kind: "instruction", path: "policies/checklist.instructions.md" },
        { kind: "agent", path: "one/engineering" },
        { kind: "agent", path: "two/engineering" },
      ],
    },
    { name: "BasicCatalog", mode: "basic", entries: [] },
  ];

  const labels = resources.map((entry) => inventoryCatalogLabel(entry, catalogs, resources));
  assert.deepEqual(labels, [
    "MattPucock[engineering]",
    "MattPucock[engineering]",
    "MattPucock[productivity]",
    "MattPucock[agents]",
    "MattPucock[policies]",
    "MattPucock[one/engineering]",
    "MattPucock[two/engineering]",
    "BasicCatalog",
    "MattPucock",
    "-",
  ]);
  assert.deepEqual(filterInventory(resources, "", "MattPucock[engineering]", "all", catalogs)
    .map(({ id }) => id), ["review", "review-special"]);
  assert.equal(cycleFilter("all", resources.filter((entry) => entry.managed !== false),
    "catalog", "kind", "all", catalogs), "BasicCatalog");
});

test("custom catalog directory mappings discover nested skills, agents, and instructions", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-custom-directories-"));
  const repository = "https://github.com/example/custom-directories";
  const source = createSource("custom-directories", repository);
  const writeMarkdown = (relativePath, lines) => {
    const file = path.join(source, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, lines.join("\n"));
  };
  writeMarkdown("custom/skills/review/SKILL.md", [
    "---", "name: review", "description: Review changes.", "---", "", "Review skill.",
  ]);
  writeMarkdown("custom/skills/testing/SKILL.md", [
    "---", "name: testing", "description: Test changes.", "---", "", "Testing skill.",
  ]);
  writeMarkdown("custom/agents/release.agent.md", [
    "---", "name: release", "description: Release agent.", "---", "", "Release agent.",
  ]);
  writeMarkdown("custom/agents/security/security-review.agent.md", [
    "---", "name: security-review", "description: Security review agent.", "---", "", "Review agent.",
  ]);
  writeMarkdown("custom/instructions/security.instructions.md", [
    "---", "description: Security policy.", "apply_to: src/**", "---", "", "Security instructions.",
  ]);
  writeMarkdown("custom/instructions/testing/note.md", [
    "---", "description: Test policy.", "apply_to: tests/**", "---", "", "Test instructions.",
  ]);
  execFileSync("git", ["-C", source, "add", "."]);
  execFileSync("git", [
    "-C", source, "-c", "user.name=Catalog fixtures", "-c",
    "user.email=fixtures@example.invalid", "-c", "commit.gpgsign=false",
    "commit", "--quiet", "-m", "Add custom resource directories",
  ]);
  const configuration = validateSourceConfiguration({
    catalog_version: 1,
    sources: [{
      name: "custom-directories",
      repository,
      mode: "custom",
      entries: [
        { kind: "skill", path: "custom/skills/" },
        { kind: "agent", path: "custom/agents" },
        { kind: "instruction", path: "custom/instructions" },
      ],
    }],
  })[0];
  assert.deepEqual(configuration.entries.map(({ path: sourcePath }) => sourcePath), [
    "custom/skills", "custom/agents", "custom/instructions",
  ]);
  const catalog = createSourceIndex(repository, "custom-directories", source, configuration);
  assert.deepEqual(catalog.resources.map(({ kind, id }) => `${kind}:${id}`).sort(), [
    "agent:release", "agent:security-review", "instruction:note", "instruction:security",
    "skill:review", "skill:testing",
  ]);
  assert.equal(catalog.resources.find(({ id }) => id === "testing").source_path,
    "custom/skills/testing");
});



test("user source configuration rejects duplicate names and non-GitHub repositories", () => {
  assert.throws(() => validateSourceConfiguration({
    catalog_version: 1,
    sources: [
      { name: "duplicate", repository: "https://github.com/example/one" },
      { name: "Duplicate", repository: "https://github.com/example/two" },
    ],
  }), /Duplicate catalog source name/);
  assert.deepEqual(validateSourceConfiguration({
    catalog_version: 1,
    sources: [
      { name: "Test", repository: "https://github.com/example/test" },
      { name: "AI Kit", repository: "https://github.com/example/ai-kit" },
      { name: "skills_catalog.v2", repository: "https://github.com/example/skills" },
    ],
  }).map(({ name }) => name), ["Test", "AI Kit", "skills_catalog.v2"]);
  assert.throws(() => validateSourceConfiguration({
    catalog_version: 1,
    sources: [{ name: "unsupported", repository: "https://example.com/team/repo" }],
  }), /Invalid GitHub source repository URL/);
});

test("user registries load metadata for multiple independently named catalogs", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-user-catalogs-"));
  const indexDirectory = path.join(temporary, "source-catalogs");
  fs.mkdirSync(indexDirectory, { recursive: true });
  const sources = [
    { name: "team-alpha", repository: "https://github.com/example/team-alpha" },
    { name: "team-beta", repository: "https://github.com/example/team-beta" },
  ];
  const manifest = { catalog_version: 1, sources };
  fs.writeFileSync(path.join(temporary, "catalogSources.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(indexDirectory, "catalogSources.json"), JSON.stringify(manifest));
  for (const [index, source] of sources.entries()) {
    fs.writeFileSync(path.join(indexDirectory, `${source.name}.json`), JSON.stringify({
      catalog_version: 1,
      catalog_name: source.name,
      source_repository: `example/${source.name}`,
      source_ref: String(index + 1).repeat(40),
      resources: [{
        id: `demo-${source.name}`,
        kind: "skill",
        description: `${source.name} skill.`,
        source_path: `skills/category-${index}/demo-${source.name}`,
        license_status: "MIT",
      }],
    }));
  }

  const originalConfig = process.env.KITIA_CONFIG_DIR;
  process.env.KITIA_CONFIG_DIR = temporary;
  try {
    const loaded = loadCommandCatalogs({ command: "list" });
    assert.deepEqual(loaded.sourceResources.map(({ catalog, id }) => `${catalog}:${id}`).sort(), [
      "team-alpha:demo-team-alpha",
      "team-beta:demo-team-beta",
    ]);
  } finally {
    if (originalConfig === undefined) delete process.env.KITIA_CONFIG_DIR;
    else process.env.KITIA_CONFIG_DIR = originalConfig;
  }
});

test("source catalogs load from the user registry without repository manifests", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-user-catalogs-"));
  const indexDirectory = path.join(temporary, "source-catalogs");
  fs.mkdirSync(indexDirectory, { recursive: true });
  const sources = [
    { name: "team-alpha", repository: "https://github.com/example/team-alpha" },
    { name: "team-beta", repository: "https://github.com/example/team-beta" },
  ];
  const manifest = { catalog_version: 1, sources };
  writeJson(path.join(temporary, "catalogSources.json"), manifest);
  writeJson(path.join(indexDirectory, "catalogSources.json"), manifest);
  for (const [index, source] of sources.entries()) {
    writeJson(path.join(indexDirectory, `${source.name}.json`), {
      catalog_version: 1,
      catalog_name: source.name,
      source_repository: `example/${source.name}`,
      source_ref: String(index + 1).repeat(40),
      resources: [{
        id: `demo-${source.name}`,
        kind: "skill",
        description: `${source.name} skill.`,
        source_path: `skills/category-${index}/demo-${source.name}`,
        license_status: "MIT",
      }],
    });
  }
  const originalConfig = process.env.KITIA_CONFIG_DIR;
  process.env.KITIA_CONFIG_DIR = temporary;
  try {
    const loaded = loadCommandCatalogs({ command: "list" });
    assert.deepEqual(loaded.sourceResources.map(({ catalog, id }) => `${catalog}:${id}`).sort(), [
      "team-alpha:demo-team-alpha",
      "team-beta:demo-team-beta",
    ]);
  } finally {
    if (originalConfig === undefined) delete process.env.KITIA_CONFIG_DIR;
    else process.env.KITIA_CONFIG_DIR = originalConfig;
  }
});


test("source skills can be uninstalled from inventory after their catalog is removed", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-removed-source-"));
  const target = path.join(temporary, "target");
  const relativePath = ".agents/skills/retired-skill/SKILL.md";
  const skillFile = path.join(target, relativePath);
  fs.mkdirSync(path.dirname(skillFile), { recursive: true });
  fs.writeFileSync(skillFile, [
    "---",
    "name: retired-skill",
    "description: An installed skill from a removed source.",
    "metadata:",
    '  github-repo: "https://github.com/example/retired"',
    '  github-path: "skills/retired-skill"',
    `  github-ref: "${"a".repeat(40)}"`,
    "---",
    "",
    "Tracked skill body.",
    "",
  ].join("\n"));
  const record = {
    source_repository: "example/retired",
    source_path: "skills/retired-skill",
    source_ref: "a".repeat(40),
    files: { [relativePath]: installedFingerprint(target, relativePath) },
  };
  fs.mkdirSync(path.join(target, ".agents"), { recursive: true });
  fs.writeFileSync(path.join(target, ".agents/kitia-lock.json"), JSON.stringify({
    lock_version: 1,
    catalog: "grasdouble/Kitia",
    sources: { retired: { skills: { "retired-skill": record } } },
  }));

  const loaded = loadCommandCatalogs({
    command: "uninstall", kind: "skill", target,
  }, () => assert.fail("uninstall must not need source discovery"));
  assert.deepEqual(loaded.sourceResources.map(({ catalog, id }) => `${catalog}:${id}`), [
    "retired:retired-skill",
  ]);
  uninstallSourceResource(loaded.sourceResources[0], target);
  assert.equal(fs.existsSync(skillFile), false);
  assert.equal(fs.existsSync(path.dirname(skillFile)), false);
});

test("identical skill IDs from different sources cannot collide in one installation target", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-source-id-collision-"));
  const target = path.join(temporary, "target");
  const relativePath = ".agents/skills/demo-skill/SKILL.md";
  const skillFile = path.join(target, relativePath);
  fs.mkdirSync(path.dirname(skillFile), { recursive: true });
  fs.writeFileSync(skillFile, "Tracked by another source.\n");
  const record = {
    source_repository: "example/team-beta",
    source_path: "skills/demo-skill",
    source_ref: "b".repeat(40),
    files: { [relativePath]: installedFingerprint(target, relativePath) },
  };
  fs.mkdirSync(path.join(target, ".agents"), { recursive: true });
  fs.writeFileSync(path.join(target, ".agents/kitia-lock.json"), JSON.stringify({
    lock_version: 1,
    catalog: "grasdouble/Kitia",
    sources: { "team-beta": { skills: { "demo-skill": record } } },
  }));

  assert.throws(() => runSourceCommand({
    action: "install",
    catalog: "team-alpha",
    id: "demo-skill",
    target,
    tool: "copilot",
    scope: "project",
    sourceResources: [{
      catalog: "team-alpha", id: "demo-skill", kind: "skill",
      description: "A source skill.", source_repository: "example/team-alpha",
      source_path: "skills/demo-skill", source_ref: "a".repeat(40),
      license_status: "MIT",
    }],
  }, () => assert.fail("a colliding install must not invoke gh")), /already tracked from another catalog/);
});

test("skill freshness compares the latest SKILL.md revision at installed and catalog pins", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-skill-freshness-"));
  const target = path.join(temporary, "target");
  fs.mkdirSync(target);
  const skillCommit = "26d8943616ffc1be09e121a3a666c284c526a761";
  const previousRepositoryHead = "6f86fd3c8aeda1edebd04ec66261e36ec1d06b7c";
  const resource = {
    catalog: "AI-Kit",
    id: "conventional-commits",
    kind: "skill",
    description: "Conventional commits guidance.",
    source_repository: "grasdouble/AI-Kit",
    source_path: "skills/conventional-commits",
    source_ref: previousRepositoryHead,
    license_status: "MIT",
  };
  const relativePath = ".agents/skills/conventional-commits/SKILL.md";
  let installedRef = skillCommit;
  let skill = [
    "---",
    "name: conventional-commits",
    "description: Conventional commits guidance.",
    "metadata:",
    `  github-repo: "https://github.com/${resource.source_repository}"`,
    `  github-path: "${resource.source_path}"`,
    `  github-ref: "${installedRef}"`,
    `  github-pinned: "${installedRef}"`,
    "---",
    "",
    "Synthetic body.",
    "",
  ].join("\n");
  const skillFile = path.join(target, relativePath);
  fs.mkdirSync(path.dirname(skillFile), { recursive: true });
  fs.writeFileSync(skillFile, skill);
  const lockFile = path.join(target, ".agents/kitia-lock.json");
  writeJson(lockFile, {
    lock_version: 1,
    catalog: "grasdouble/Kitia",
    sources: {
      "AI-Kit": {
        skills: {
          "conventional-commits": {
            source_repository: resource.source_repository,
            source_path: resource.source_path,
            source_ref: installedRef,
            files: { [relativePath]: installedFingerprint(target, relativePath) },
          },
        },
      },
    },
  });
  const writeInstalledRef = (ref) => {
    skill = skill.replaceAll(installedRef, ref);
    installedRef = ref;
    fs.writeFileSync(skillFile, skill);
    const state = readInstallState(target);
    const record = state.sources["AI-Kit"].skills["conventional-commits"];
    record.source_ref = installedRef;
    record.files[relativePath] = installedFingerprint(target, relativePath);
    writeJson(lockFile, state);
  };
  const history = (revisions) => {
    let calls = 0;
    const run = (program, args) => {
      calls += 1;
      assert.equal(program, "gh");
      assert.equal(args[0], "api");
      assert.equal(args[1], "-X");
      assert.equal(args[2], "GET");
      assert.equal(args[3], "repos/grasdouble/AI-Kit/commits");
      assert.ok(args.includes("-f"));
      assert.ok(args.includes(`path=${resource.source_path}/SKILL.md`));
      assert.ok(args.includes("-F"));
      assert.ok(args.includes("per_page=1"));
      const ref = args.find((arg) => arg.startsWith("sha="))?.slice(4);
      assert.ok(ref && Object.hasOwn(revisions, ref), `unexpected history lookup for ${ref}`);
      return JSON.stringify([{ sha: revisions[ref] }]);
    };
    return { run, calls: () => calls, revisions };
  };

  const initialHistory = history({
    [skillCommit]: skillCommit,
    [previousRepositoryHead]: skillCommit,
  });
  const initial = checkInstalledResources(target, [resource], { run: initialHistory.run });
  assert.equal(initialHistory.calls(), 2, "both installed and catalog pins need path-history lookups");
  assert.equal(initial.updateAvailable, false);
  assert.equal(initial.resources[0].status, "current");
  assert.equal(dashboardStatus(initial.resources[0]), "current");
  const dashboardHistory = history({
    [skillCommit]: skillCommit,
    [previousRepositoryHead]: skillCommit,
  });
  const initialInventory = collectInstalledScopes(
    { project: target, user: target }, [resource], { run: dashboardHistory.run },
  );
  assert.deepEqual(initialInventory.errors, []);
  assert.equal(dashboardHistory.calls(), 2, "inventory scopes share both path-history lookups");
  assert.equal(initialInventory.resources[0].status, "current");
  assert.equal(dashboardStatus(initialInventory.resources[0]), "current");

  writeInstalledRef(previousRepositoryHead);
  const newerRepositoryHead = "7".repeat(40);
  resource.source_ref = newerRepositoryHead;
  const unrelatedRepositoryHistory = history({
    [previousRepositoryHead]: skillCommit,
    [newerRepositoryHead]: skillCommit,
  });
  assert.notEqual(previousRepositoryHead, newerRepositoryHead);
  assert.equal(
    unrelatedRepositoryHistory.revisions[previousRepositoryHead],
    unrelatedRepositoryHistory.revisions[newerRepositoryHead],
    "different repository commits with the same SKILL.md path commit must be current",
  );
  const unchangedAtNewerRepositoryHead = checkInstalledResources(
    target, [resource], { run: unrelatedRepositoryHistory.run },
  );
  assert.equal(unrelatedRepositoryHistory.calls(), 2);
  assert.equal(unchangedAtNewerRepositoryHead.updateAvailable, false);
  assert.equal(unchangedAtNewerRepositoryHead.resources[0].status, "current");
  assert.equal(dashboardStatus(unchangedAtNewerRepositoryHead.resources[0]), "current");

  const changedCatalogHead = "8".repeat(40);
  resource.source_ref = changedCatalogHead;
  const changedHistory = history({
    [previousRepositoryHead]: skillCommit,
    [changedCatalogHead]: "c".repeat(40),
  });
  const changed = checkInstalledResources(target, [resource], { run: changedHistory.run });
  assert.equal(changedHistory.calls(), 2);
  assert.equal(changed.updateAvailable, true);
  assert.equal(changed.resources[0].issues[0].code, "UPDATE_AVAILABLE");
  assert.equal(dashboardStatus(changed.resources[0]), "update");
  assert.throws(
    () => checkInstalledResources(target, [resource], {
      run: () => { throw new Error("offline"); },
    }),
    /Cannot check GitHub source history/,
  );
  const unavailableHistory = collectInstalledScopes(
    { project: target }, [resource], { run: () => { throw new Error("offline"); } },
  );
  assert.equal(unavailableHistory.resources.length, 0);
  assert.match(unavailableHistory.errors[0].message, /Cannot check GitHub source history/);
});

for (const { kind, id, sourcePath, installPath } of [
  {
    kind: "agent",
    id: "release-helper",
    sourcePath: "agents/release-helper.agent.md",
    installPath: ".copilot/agents/release-helper.agent.md",
  },
  {
    kind: "instruction",
    id: "review-policy",
    sourcePath: "instructions/review-policy.instructions.md",
    installPath: ".github/instructions/review-policy.instructions.md",
  },
]) {
  test(`${kind} freshness tracks its exact source file at both repository pins`, () => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), `kitia-${kind}-freshness-`));
    const target = path.join(temporary, "target");
    fs.mkdirSync(target);
    const installedRef = "a".repeat(40);
    const catalogRef = "b".repeat(40);
    const sourceRevision = "c".repeat(40);
    const updatedCatalogRef = "d".repeat(40);
    const updatedSourceRevision = "e".repeat(40);
    const resource = {
      catalog: "AI-Kit",
      id,
      kind,
      description: `${kind} fixture.`,
      source_repository: "grasdouble/AI-Kit",
      source_path: sourcePath,
      source_ref: catalogRef,
      license_status: "MIT",
    };
    const installedText = `Managed ${kind} fixture.\n`;
    const installedFile = path.join(target, installPath);
    fs.mkdirSync(path.dirname(installedFile), { recursive: true });
    fs.writeFileSync(installedFile, installedText);
    const lockFile = path.join(target, ".agents/kitia-lock.json");
    writeJson(lockFile, {
      lock_version: 1,
      catalog: "grasdouble/Kitia",
      sources: {
        "AI-Kit": {
          [`${kind}s`]: {
            [id]: {
              source_repository: resource.source_repository,
              source_path: resource.source_path,
              source_ref: installedRef,
              files: { [installPath]: installedFingerprint(target, installPath) },
            },
          },
        },
      },
    });
    const history = (revisions) => {
      let calls = 0;
      const run = (program, args) => {
        calls += 1;
        assert.equal(program, "gh");
        assert.equal(args[0], "api");
        assert.equal(args[1], "-X");
        assert.equal(args[2], "GET");
        assert.equal(args[3], "repos/grasdouble/AI-Kit/commits");
        assert.ok(args.includes(`path=${sourcePath}`), `${kind} history must query its exact source file`);
        const ref = args.find((arg) => arg.startsWith("sha="))?.slice(4);
        assert.ok(ref && Object.hasOwn(revisions, ref), `unexpected ${kind} history lookup for ${ref}`);
        return JSON.stringify([{ sha: revisions[ref] }]);
      };
      return { run, calls: () => calls };
    };

    const sameFileHistory = history({
      [installedRef]: sourceRevision,
      [catalogRef]: sourceRevision,
    });
    const current = checkInstalledResources(target, [resource], { run: sameFileHistory.run });
    assert.equal(sameFileHistory.calls(), 2);
    assert.equal(current.updateAvailable, false);
    assert.equal(current.resources[0].status, "current");
    assert.equal(dashboardStatus(current.resources[0]), "current");

    resource.source_ref = updatedCatalogRef;
    const changedFileHistory = history({
      [installedRef]: sourceRevision,
      [updatedCatalogRef]: updatedSourceRevision,
    });
    const changed = checkInstalledResources(target, [resource], { run: changedFileHistory.run });
    assert.equal(changedFileHistory.calls(), 2);
    assert.equal(changed.updateAvailable, true);
    assert.equal(changed.resources[0].issues[0].code, "UPDATE_AVAILABLE");
    assert.equal(dashboardStatus(changed.resources[0]), "update");

    const unavailable = collectInstalledScopes(
      { project: target }, [resource], { run: () => { throw new Error("offline"); } },
    );
    assert.equal(unavailable.resources.length, 0);
    assert.match(unavailable.errors[0].message, /Cannot check GitHub source history/);
    assert.equal(
      latestSourceVersionAtRef(
        { ...resource, source_repository: "https://gitlab.com/example/AI-Kit" },
        installedRef,
        () => assert.fail("non-GitHub resources must retain exact-pin comparison"),
      ),
      null,
    );
    const unsupported = { source_path: sourcePath.slice(0, sourcePath.lastIndexOf("/")) };
    const state = readInstallState(target);
    const record = state.sources["AI-Kit"][`${kind}s`][id];
    Object.assign(record, unsupported);
    writeJson(lockFile, state);
    const fallback = checkInstalledResources(
      target, [{ ...resource, ...unsupported }],
      { run: () => assert.fail("uninterpretable paths must retain exact-pin comparison") },
    );
    assert.equal(fallback.updateAvailable, true);
    assert.equal(fallback.resources[0].issues[0].code, "UPDATE_AVAILABLE");
  });
}

test("configured source skills use the same pinned install, check, update and uninstall lifecycle", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-source-lifecycle-"));
  const target = path.join(temporary, "target");
  fs.mkdirSync(target);
  const sourceResource = {
    catalog: "team-alpha",
    id: "demo-skill",
    kind: "skill",
    description: "A generated source skill.",
    source_repository: "example/team-alpha",
    source_path: "skills/demo-skill",
    source_ref: "a".repeat(40),
    license_status: "MIT",
  };
  let installedRef = sourceResource.source_ref;
  let updateArgs;
  const invoke = (args) => {
    if (args[args.indexOf("--pin") + 1] !== sourceResource.source_ref) updateArgs = args;
    assert.deepEqual(args.slice(0, 4), [
      "skill", "install", sourceResource.source_repository, sourceResource.source_path,
    ]);
    installedRef = args[args.indexOf("--pin") + 1];
    const skillFile = path.join(target, ".agents/skills/demo-skill/SKILL.md");
    fs.mkdirSync(path.dirname(skillFile), { recursive: true });
    fs.writeFileSync(skillFile, [
      "---",
      "name: demo-skill",
      "description: A generated source skill.",
      "metadata:",
      `  github-repo: "https://github.com/${sourceResource.source_repository}"`,
      `  github-path: "${sourceResource.source_path}"`,
      `  github-ref: "${installedRef}"`,
      `  github-pinned: "${installedRef}"`,
      "---",
      "",
      "Synthetic body.",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(path.dirname(skillFile), "reference.md"), "Supporting file.");
    return 0;
  };

  assert.equal(runSourceCommand({
    action: "install", id: sourceResource.id, catalog: sourceResource.catalog,
    resource: sourceResource, target, tool: "copilot",
  }, invoke), 0);
  const state = readInstallState(target);
  assert.equal(state.sources["team-alpha"].skills["demo-skill"].source_ref, sourceResource.source_ref);
  assert.equal(state.source_skills, undefined);
  assert.equal(readInstalledSourceSkills(target, [sourceResource]).length, 1);
  const checked = checkInstalledResources(target, [sourceResource], { catalog: "team-alpha" });
  assert.equal(checked.updateAvailable, false);
  assert.equal(
    checked.resources.find((resource) => resource.id === sourceResource.id).version,
    installedRef.slice(0, 7),
  );

  const updatedResource = { ...sourceResource, source_ref: "c".repeat(40) };
  const installed = readInstalledSourceSkills(target, [updatedResource]);
  assert.match(updateSourceResources(installed, target, {}, invoke).join("\n"), /Updated team-alpha catalog skill/);
  assert.equal(updateArgs.includes("--force"), false, "the first managed update attempt must not force GH overwrite");
  assert.equal(installedRef, updatedResource.source_ref);
  const failedResource = { ...updatedResource, source_ref: "d".repeat(40) };
  let plannedUpdate;
  updateSourceResources(
    readInstalledSourceSkills(target, [failedResource]),
    target,
    { dryRun: true, onAction: (action) => { plannedUpdate = action; } },
    () => assert.fail("a dry-run update must not invoke gh"),
  );
  assert.equal(plannedUpdate.command.args.includes("--force"), false, "dry-run plans must not force GH overwrite by default");
  const skillFile = path.join(target, ".agents/skills/demo-skill/SKILL.md");
  const installedSkill = fs.readFileSync(skillFile, "utf8");
  fs.writeFileSync(skillFile, "Locally modified managed skill.\n");
  let guardedGhCalls = 0;
  assert.throws(() => updateSourceResources(
    readInstalledSourceSkills(target, [failedResource]),
    target,
    {},
    () => {
      guardedGhCalls++;
      return 0;
    },
  ), (error) => {
    assert.equal(error.code, "LOCAL_CONFLICT");
    assert.equal(error.category, "tracked-modification");
    assert.deepEqual(error.paths, [".agents/skills/demo-skill/SKILL.md"]);
    assert.equal(error.recoverable, true);
    return true;
  });
  assert.equal(guardedGhCalls, 0, "local modifications must be rejected before invoking gh");
  assert.throws(() => updateSourceResources(
    readInstalledSourceSkills(target, [failedResource]),
    target,
    { ghForce: true, ghForceAgent: "github-copilot" },
    () => {
      guardedGhCalls++;
      return 0;
    },
  ), (error) => error.code === "LOCAL_CONFLICT");
  assert.equal(guardedGhCalls, 0, "GH-only force retry must not bypass Kitia's tracked-file guard");
  let forcedArgs;
  assert.throws(() => updateSourceResources(
    readInstalledSourceSkills(target, [failedResource]),
    target,
    { force: true },
    (args) => {
      forcedArgs = args;
      return 1;
    },
  ), /gh exited with status 1/);
  assert.ok(forcedArgs.includes("--force"), "explicit --force must still reach gh");
  fs.writeFileSync(skillFile, installedSkill);
  fs.writeFileSync(path.join(path.dirname(skillFile), "local-notes.txt"), "Keep this file.");
  guardedGhCalls = 0;
  assert.throws(() => updateSourceResources(
    readInstalledSourceSkills(target, [failedResource]),
    target,
    {},
    () => {
      guardedGhCalls++;
      return 0;
    },
  ), (error) => {
    assert.equal(error.code, "LOCAL_CONFLICT");
    assert.equal(error.category, "untracked-skill-content");
    assert.deepEqual(error.paths, [".agents/skills/demo-skill/local-notes.txt"]);
    assert.equal(error.recoverable, true);
    return true;
  });
  assert.equal(guardedGhCalls, 0, "untracked files must be protected before invoking gh");
  assert.throws(() => updateSourceResources(
    readInstalledSourceSkills(target, [failedResource]),
    target,
    { ghForce: true, ghForceAgent: "github-copilot" },
    () => {
      guardedGhCalls++;
      return 0;
    },
  ), (error) => error.code === "LOCAL_CONFLICT");
  assert.equal(guardedGhCalls, 0, "GH-only force retry must not bypass Kitia's untracked-file guard");
  let untrackedForcedArgs;
  assert.throws(() => updateSourceResources(
    readInstalledSourceSkills(target, [failedResource]),
    target,
    { force: true },
    (args) => {
      untrackedForcedArgs = args;
      return 1;
    },
  ), /gh exited with status 1/);
  assert.ok(untrackedForcedArgs.includes("--force"), "explicit --force may replace untracked content");
  fs.unlinkSync(path.join(path.dirname(skillFile), "local-notes.txt"));
  let ghFailure;
  assert.throws(() => updateSourceResources(
    readInstalledSourceSkills(target, [failedResource]),
    target,
    { nonInteractive: true },
    () => ({
      status: 1,
      stderr: "\u001b[31mGitHub API rate limit exceeded; retry later\u001b[0m token ghp_abcdefghijklmnopqrstuvwxyz123456 GH_TOKEN=super-secret-value\n",
      stdout: "ignored stdout",
    }),
  ), (error) => {
    ghFailure = error;
    return true;
  });
  assert.equal(
    ghFailure.message,
    "Could not update team-alpha catalog skill demo-skill for github-copilot: gh exited with status 1. GitHub reports an API rate limit; wait for the limit to reset, then retry. No agents were confirmed updated before this failure. gh diagnostic: GitHub API rate limit exceeded; retry later token [REDACTED] GH_TOKEN=[REDACTED]",
  );
  assert.doesNotMatch(ghFailure.message, /\u001b|\bghp_abcdefghijklmnopqrstuvwxyz123456\b|super-secret-value|ignored stdout/);
  let truncatedFailure;
  assert.throws(() => updateSourceResources(
    readInstalledSourceSkills(target, [failedResource]),
    target,
    { nonInteractive: true },
    () => ({ status: 1, stderr: "x".repeat(401) }),
  ), (error) => {
    truncatedFailure = error;
    return true;
  });
  assert.match(truncatedFailure.message, /x{400}… \[diagnostic truncated\]$/);
  assert.equal(ghFailure.code, "GH_UPDATE_FAILED", "unrelated GH failures must remain ordinary failures");
  const forceRequiredResource = { ...updatedResource, source_ref: "f".repeat(40) };
  let firstAttemptArgs;
  assert.throws(() => updateSourceResources(
    readInstalledSourceSkills(target, [forceRequiredResource]),
    target,
    {},
    (args) => {
      firstAttemptArgs = args;
      return { status: 1, stderr: "skills already installed: demo-skill (Use --force to overwrite)" };
    },
  ), (error) => {
    assert.equal(error.code, "GH_FORCE_REQUIRED");
    assert.equal(error.category, "github-force-required");
    assert.equal(error.recoverable, true);
    assert.equal(error.agent, "github-copilot");
    assert.match(error.userMessage, /already installed and requires --force/);
    assert.doesNotMatch(error.userMessage, /Skills already installed/);
    return true;
  });
  assert.equal(firstAttemptArgs.includes("--force"), false);
  for (const diagnostic of [
    "skills already installed: demo-skill (Use --force to overwrite!)",
    "Skills already installed: demo-skill (Use --force to overwrite!)",
    "Skills already installed:\ndemo-skill (Use --force to overwrite)",
    "prefix Skills already installed: demo-skill (Use --force to overwrite)",
  ]) {
    let nearMatchArgs;
    assert.throws(() => updateSourceResources(
      readInstalledSourceSkills(target, [forceRequiredResource]),
      target,
      {},
      (args) => {
        nearMatchArgs = args;
        return { status: 1, stderr: diagnostic };
      },
    ), (error) => error.code === "GH_UPDATE_FAILED");
    assert.equal(nearMatchArgs.includes("--force"), false);
  }
  updateSourceResources(
    readInstalledSourceSkills(target, [forceRequiredResource]),
    target,
    { ghForce: true, ghForceAgent: "github-copilot" },
    invoke,
  );
  assert.ok(updateArgs.includes("--force"));
  assert.equal(installedRef, forceRequiredResource.source_ref);
  assert.equal(
    readInstallState(target).sources["team-alpha"].skills["demo-skill"].source_ref,
    forceRequiredResource.source_ref,
  );

  let spawnOptions;
  const captured = runGhSkill(["skill", "install"], target, (_program, _args, options) => {
    spawnOptions = options;
    return { status: 1, stdout: "out", stderr: "actionable error" };
  }, { nonInteractive: true, captureOutput: true });
  assert.deepEqual(spawnOptions.stdio, ["ignore", "pipe", "pipe"]);
  assert.equal(spawnOptions.env.GH_PROMPT_DISABLED, "1");
  assert.deepEqual(captured, { status: 1, stdout: "out", stderr: "actionable error" });
  assert.throws(() => runGhSkill(
    ["skill", "install", "https://example.invalid/?token=secret"],
    target,
    () => { throw Object.assign(new Error("secret process details"), { code: "EACCES" }); },
  ), (error) => {
    assert.equal(error.code, "GH_SPAWN_FAILED");
    assert.match(error.message, /EACCES/);
    assert.doesNotMatch(error.message, /example\.invalid|token=secret|secret process details/);
    return true;
  });
  assert.equal(checkInstalledResources(
    target, [forceRequiredResource], { catalog: "team-alpha" },
  ).updateAvailable, false);
  const partialResource = { ...updatedResource, source_ref: "e".repeat(40) };
  const partialInstalled = readInstalledSourceSkills(target, [partialResource]);
  partialInstalled[0].installations.push({
    ...partialInstalled[0].installations[0],
    agent: "claude-code",
    path: ".claude/skills/demo-skill/SKILL.md",
  });
  let partialCalls = 0;
  assert.throws(() => updateSourceResources(
    partialInstalled,
    target,
    { nonInteractive: true },
    (args) => {
      partialCalls += 1;
      return partialCalls === 1 ? invoke(args) : { status: 1, stderr: "unexpected failure" };
    },
  ), (error) => {
    assert.equal(error.code, "GH_UPDATE_FAILED");
    assert.match(error.userMessage, /for claude-code: gh exited with status 1/);
    assert.match(error.userMessage, /did not provide a recognized cause/);
    assert.match(error.userMessage, /github-copilot/);
    assert.doesNotMatch(error.userMessage, /unexpected failure/);
    return true;
  });
  assert.equal(partialCalls, 2);

  assert.match(uninstallSourceResource(updatedResource, target).join("\n"), /Removed team-alpha catalog skill entry point/);
  assert.equal(fs.existsSync(path.join(target, ".agents/skills/demo-skill")), false);
  assert.equal(readInstalledSourceSkills(target, []).length, 0);
});


test("dashboard manages user catalogs and refreshes one or all catalogs", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const { addCatalogModal, catalogTransferModal, refreshCatalogModal, removeCatalogModal } =
    await import("../dist/dashboard/modals.mjs");
  const repository = "https://github.com/example/test";
  const catalogModal = removeCatalogModal({
    catalogs: [{ name: "Test", repository }],
    state: { step: "select", index: 0, name: "Test", message: "", failed: false },
    columns: 100,
  });
  assert.ok(catalogModal.lines.some(({ text }) => text.includes(`Test (${repository})`)));
  const refreshModal = refreshCatalogModal({
    catalogs: [{ name: "Test", repository }],
    state: { step: "scope", scope: "one", index: 0, name: "", message: "", failed: false },
    columns: 100,
  });
  assert.ok(refreshModal.lines.some(({ text }) => text.includes("ONE CATALOG")));
  assert.ok(refreshModal.lines.some(({ text }) => text.includes("ALL CATALOGS")));
  const setupModal = addCatalogModal({
    step: "mode", name: "Test", repository, mode: "basic", kind: "skill",
    path: "", entries: [], message: "", columns: 100,
  });
  assert.ok(setupModal.lines.some(({ text }) => text.includes("skills, agents, and instructions")));
  const skillPathModal = addCatalogModal({
    step: "path", name: "Test", repository, mode: "custom", kind: "skill",
    path: "custom/skills", entries: [], message: "", columns: 100,
  });
  assert.ok(skillPathModal.lines.map(({ bodyText, text }) => bodyText || text).join(" ").includes("parent folder containing multiple skills"));
  const agentPathModal = addCatalogModal({
    step: "path", name: "Test", repository, mode: "custom", kind: "agent",
    path: "custom/agents", entries: [], message: "", columns: 100,
  });
  assert.ok(agentPathModal.lines.map(({ bodyText, text }) => bodyText || text).join(" ").includes("folder containing multiple artifacts"));
  const drive = async (keys, removeCatalog) => {
    const input = new PassThrough();
    input.isTTY = true;
    input.setRawMode = () => {};
    input.ref = () => {};
    input.unref = () => {};
    const output = new PassThrough();
    output.isTTY = true;
    output.columns = 100;
    output.rows = 40;
    output.on("data", () => {});
    const done = runDashboard([], input, output, [], {
      userCatalogs: [{ name: "Test", repository }],
      removeCatalog,
    });
    for (const key of keys) {
      input.write(key);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const result = await done;
    input.destroy();
    output.destroy();
    return result;
  };
  const driveRefresh = async (keys, refreshCatalog, extraActions = {}) => {
    const input = new PassThrough();
    input.isTTY = true;
    input.setRawMode = () => {};
    input.ref = () => {};
    input.unref = () => {};
    const output = new PassThrough();
    output.isTTY = true;
    output.columns = 100;
    output.rows = 40;
    let renderedOutput = "";
    output.on("data", (chunk) => { renderedOutput += chunk.toString(); });
    const done = runDashboard([], input, output, [], {
      userCatalogs: [{ name: "Test", repository }],
      refreshCatalog,
      removeCatalog: async () => ({ catalogs: [{ name: "Test", repository }], resources: [] }),
      ...extraActions,
    });
    const waitForOutput = async (pattern) => {
      const deadline = Date.now() + 5_000;
      while (!pattern.test(renderedOutput)) {
        if (Date.now() >= deadline) {
          throw new Error(`Dashboard did not render ${pattern}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };
    for (const entry of keys) {
      const [key, expectedOutput] = Array.isArray(entry) ? entry : [entry];
      input.write(key);
      if (expectedOutput) await waitForOutput(expectedOutput);
      else await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const result = await done;
    input.destroy();
    output.destroy();
    return { result, renderedOutput };
  };
  const removed = [];
  assert.equal(await drive(
    ["m", "\x1b[3~", "\r", "y", "\r", "q"],
    async (name) => {
      removed.push(name);
      return { catalogs: [], resources: [] };
    },
  ), true);
  assert.deepEqual(removed, ["Test"]);
  assert.equal(await drive(
    ["m", "\x1b[3~", "\x1b", "q"],
    async (name) => {
      removed.push(name);
      return { catalogs: [], resources: [] };
    },
  ), true);
  assert.deepEqual(removed, ["Test"]);
  const refreshed = [];
  const refresh = async (name) => {
    refreshed.push(name);
    return {
      catalogs: [{ name: "Test", repository }], resources: [],
      refreshed: [{ name: name || "Test", count: 2 }], failures: [],
    };
  };
  const management = await driveRefresh(["m", "q"], refresh, {
    addCatalog: async () => ({ catalog: "New", count: 0 }),
    updateCatalog: async () => ({ catalog: "Test", count: 0 }),
  });
  assert.equal(management.result, true);
  assert.match(management.renderedOutput, /USER CATALOGS/);
  assert.match(management.renderedOutput, /A add/);
  assert.match(management.renderedOutput, /Delete remove/);
  assert.match(management.renderedOutput, /R refresh/);
  assert.match(management.renderedOutput, /SHORTCUTS/);
  const presetRequests = [];
  const presetManager = await driveRefresh(["m", "p", "\x1b[B", "\r", "\r", "q"], refresh, {
    addCatalog: async (request) => {
      presetRequests.push(request);
      return { catalog: request.name, count: 3, catalogs: [request], resources: [] };
    },
  });
  assert.equal(presetManager.result, true);
  assert.deepEqual(presetRequests, [{
    name: "matt-pocock",
    repository: "https://github.com/mattpocock/skills",
    mode: "basic",
    entries: [],
  }]);
  const anthropicRequests = [];
  const anthropicManager = await driveRefresh(["m", "p", "\r", "\r", "q"], refresh, {
    addCatalog: async (request) => {
      anthropicRequests.push(request);
      return { catalog: request.name, count: 6, catalogs: [request], resources: [] };
    },
  });
  assert.equal(anthropicManager.result, true);
  assert.match(anthropicManager.renderedOutput, /anthropics\/skills/);
  assert.deepEqual(anthropicRequests, [{
    name: "Anthropics",
    repository: "https://github.com/anthropics/skills",
    mode: "basic",
    entries: [],
  }]);
  const githubPresetRequests = [];
  const githubPresetManager = await driveRefresh(["m", "p", "\x1b[B", "\x1b[B", "\r", "\r", "q"], refresh, {
    addCatalog: async (request) => {
      githubPresetRequests.push(request);
      return { catalog: request.name, count: 3, catalogs: [request], resources: [] };
    },
  });
  assert.equal(githubPresetManager.result, true);
  assert.deepEqual(githubPresetRequests, [{
    name: "github-awesome-copilot",
    repository: "https://github.com/github/awesome-copilot",
    mode: "basic",
    entries: [],
  }]);
  let cancelledPresetAdded = false;
  const cancelledPreset = await driveRefresh(["m", "p", "\x1b", "q"], refresh, {
    addCatalog: async () => {
      cancelledPresetAdded = true;
      return { catalog: "unexpected", count: 0 };
    },
  });
  assert.equal(cancelledPreset.result, true);
  assert.ok(cancelledPreset.renderedOutput.indexOf("Anthropics") < cancelledPreset.renderedOutput.indexOf("Matt Pocock"));
  assert.equal(cancelledPresetAdded, false);
  const transfers = [];
  const pastedConfiguration = JSON.stringify({
    catalog_version: 1,
    sources: [
      { name: "Catalog One", repository: "https://github.com/example/one", mode: "basic", entries: [] },
      { name: "Catalog Two", repository: "https://github.com/example/two", mode: "basic", entries: [] },
    ],
  });
  const importSummary = {
    added: ["Imported"],
    ignored: [{ name: "Existing", reason: "Catalog name already exists." }],
    refreshed: [{ name: "Imported", count: 4 }],
    refreshFailures: [{ name: "Other", message: "offline" }],
  };
  const transferManager = await driveRefresh([
    ["m", /USER CATALOGS/],
    ["i", /IMPORT CATALOGS/],
    pastedConfiguration,
    ["\x13", /SPACE\/ENTER TOGGLE/],
    "\x1b[B",
    "\r",
    ["\x13", /Added \(1\): Imported/],
    "\r",
    "q",
  ], refresh, {
    transferCatalogs: async (action, content) => {
      transfers.push({ action, content });
      return {
        catalogs: [{ name: "Imported", repository }],
        resources: [],
        importSummary,
      };
    },
  });
  assert.equal(transferManager.result, true);
  const transferResult = catalogTransferModal({
    action: "import",
    step: "result",
    content: "",
    message: "Imported 1, ignored 1, refreshed 1, refresh failed 1.",
    summary: importSummary,
    working: false,
    columns: 100,
  }).lines.map(({ bodyText, text }) => bodyText || text).join("\n");
  assert.match(transferResult, /Added \(1\): Imported/);
  assert.match(transferResult, /Existing: Catalog name already exists/);
  assert.match(transferResult, /Refreshed \(1\): Imported · 4/);
  assert.match(transferResult, /Other: offline/);
  assert.equal(transfers.length, 1);
  assert.equal(transfers[0].action, "import");
  assert.deepEqual(JSON.parse(transfers[0].content).sources, [
    { name: "Catalog One", repository: "https://github.com/example/one", mode: "basic", entries: [] },
  ]);
  assert.match(transferManager.renderedOutput, /Catalog One/);
  assert.match(transferManager.renderedOutput, /Catalog Two/);
  let cancelledImport = false;
  const cancelImportManager = await driveRefresh(["m", "i", pastedConfiguration, "\x13", "\x1b", "\x1b", "q"], refresh, {
    transferCatalogs: async () => {
      cancelledImport = true;
      return {};
    },
  });
  assert.equal(cancelImportManager.result, true);
  assert.equal(cancelledImport, false);
  assert.match(cancelImportManager.renderedOutput, /Catalog Two/);
  const exportTransfers = [];
  const exportManager = await driveRefresh(["m", "x", "\r", "\r", "q"], refresh, {
    transferCatalogs: async (action, content) => {
      exportTransfers.push({ action, content });
      return { catalogs: [{ name: "Test", repository }], resources: [] };
    },
  });
  assert.equal(exportManager.result, true);
  assert.deepEqual(exportTransfers, [{ action: "export", content: "" }]);
  assert.match(exportManager.renderedOutput, /EXPORT CATALOGS/);
  assert.match(management.renderedOutput, /FRESHNESS[^\n]*\n[^\n]*UNKNOWN/);
  const currentManager = await driveRefresh(["m", "q"], refresh, {
    checkCatalogFreshness: async () => [{ name: "Test", status: "current" }],
  });
  assert.match(currentManager.renderedOutput, /UP TO DATE/);
  const outdatedManager = await driveRefresh(["m", "q"], refresh, {
    checkCatalogFreshness: async () => [{ name: "Test", status: "outdated" }],
  });
  assert.match(outdatedManager.renderedOutput, /OUTDATED/);
  const addFromManager = await driveRefresh(["m", "a", "\x1b", "q"], refresh, {
    addCatalog: async () => ({ catalog: "New", count: 0 }),
  });
  assert.equal(addFromManager.result, true);
  assert.match(addFromManager.renderedOutput, /ADD CATALOG/);
  const submittedDirectoryCatalogs = [];
  const directoryWizard = await driveRefresh([
    "m", "a", "DirectoryCatalog", "\r", repository, "\r", "\x1b[C", "\r", "\r",
    "custom/skills/", "\r", "\r", "\r", "q",
  ], refresh, {
    addCatalog: async (request) => {
      submittedDirectoryCatalogs.push(request);
      return { catalog: "DirectoryCatalog", count: 2 };
    },
  });
  assert.equal(directoryWizard.result, true);
  assert.deepEqual(submittedDirectoryCatalogs[0], {
    name: "DirectoryCatalog",
    repository,
    mode: "custom",
    entries: [{ kind: "skill", path: "custom/skills" }],
  });
  assert.match(directoryWizard.renderedOutput, /Catalog added: DirectoryCatalog · 2 resources indexed/);
  const submittedEdits = [];
  const editedCatalog = await driveRefresh([
    "m", "e", "\r", "\r", "\r", "\x1b[3~", "a", "\r", "custom/skills/",
    "\r", "\r", "\r", "q",
  ], refresh, {
    userCatalogs: [{
      name: "Test",
      repository,
      mode: "custom",
      entries: [{ kind: "skill", path: "custom/skills/old" }],
    }],
    updateCatalog: async (originalName, request) => {
      submittedEdits.push({ originalName, request });
      return {
        catalog: request.name,
        count: 1,
        catalogs: [{ ...request }],
        resources: [],
      };
    },
  });
  assert.equal(editedCatalog.result, true);
  assert.deepEqual(submittedEdits, [{
    originalName: "Test",
    request: {
      name: "Test",
      repository,
      mode: "custom",
      entries: [{ kind: "skill", path: "custom/skills" }],
    },
  }]);
  assert.match(editedCatalog.renderedOutput, /EDIT CATALOG/);
  assert.match(editedCatalog.renderedOutput, /Catalog updated: Test · 1 resource indexed/);
  const managerRemoved = [];
  const removedInManager = await driveRefresh(["m", "\x1b[3~", "\r", "y", "\r", "q"], refresh, {
    removeCatalog: async (name) => {
      managerRemoved.push(name);
      return { catalogs: [], resources: [] };
    },
  });
  assert.equal(removedInManager.result, true);
  assert.deepEqual(managerRemoved, ["Test"]);
  const managerRefreshed = [];
  const refreshedInManager = await driveRefresh(["m", "r", "\r", "\r", "\r", "q"], async (name) => {
    managerRefreshed.push(name);
    return {
      catalogs: [{ name: "Test", repository }], resources: [],
      refreshed: [{ name, count: 1 }], failures: [],
    };
  });
  assert.equal(refreshedInManager.result, true);
  assert.deepEqual(managerRefreshed, ["Test"]);
  const freshnessChecks = [];
  const targetedFreshness = await driveRefresh(
    ["m", "r", "\r", "\x1b[B", "\r", "\r", "q"],
    async (name) => ({
      catalogs: [
        { name: "Alpha", repository: "https://github.com/example/alpha" },
        { name: "Beta", repository: "https://github.com/example/beta" },
      ],
      resources: [],
      refreshed: [{ name, count: 1 }],
      failures: [],
    }),
    {
      userCatalogs: [
        { name: "Alpha", repository: "https://github.com/example/alpha" },
        { name: "Beta", repository: "https://github.com/example/beta" },
      ],
      checkCatalogFreshness: async (names) => {
        freshnessChecks.push(names);
        return (names || []).map((name) => ({ name, status: "current" }));
      },
    },
  );
  assert.equal(targetedFreshness.result, true);
  assert.deepEqual(freshnessChecks, [["Alpha", "Beta"], ["Beta"]]);
  const initialDashboard = await driveRefresh(["q"], refresh);
  assert.equal(initialDashboard.result, true);
  assert.doesNotMatch(initialDashboard.renderedOutput, /A add catalog|Delete remove selected|R refresh/);
  assert.doesNotMatch(initialDashboard.renderedOutput, /G refresh/);
  assert.match(initialDashboard.renderedOutput, /SHORTCUTS/);
  assert.match(initialDashboard.renderedOutput, /F filter/);
  assert.match(initialDashboard.renderedOutput, /↑↓ navigate/);
  const ignoredInventoryRefresh = await driveRefresh(["g", "q"], refresh);
  assert.equal(ignoredInventoryRefresh.result, true);
  assert.deepEqual(refreshed, []);
  const refreshedOne = await driveRefresh(["m", "r", "\r", "\r", "\r", "q"], refresh);
  assert.equal(refreshedOne.result, true);
  assert.deepEqual(refreshed, ["Test"]);
  const refreshedAll = await driveRefresh(["m", "r", "\u001b[C", "\r", "\r", "q"], refresh);
  assert.equal(refreshedAll.result, true);
  assert.deepEqual(refreshed, ["Test", undefined]);
  const failedRefresh = await driveRefresh(
    ["m", "r", "\r", "\r", "s", "\r", "\r", "q"],
    async () => ({
      catalogs: [{ name: "Test", repository }], resources: [], refreshed: [],
      failures: [{ name: "Test", message: "Repository not found." }],
    }),
  );
  assert.equal(failedRefresh.result, false);
  assert.ok(failedRefresh.renderedOutput.includes("Catalog Test was not refreshed."));
  assert.ok(failedRefresh.renderedOutput.includes("S SHOW DETAILS"));
  assert.ok(failedRefresh.renderedOutput.includes("CATALOG REFRESH ERRORS"));
  assert.ok(failedRefresh.renderedOutput.includes("Test: Repository not found."));
  assert.equal(failedRefresh.renderedOutput.includes("Refreshed Test · 0 resources indexed."), false);
});
test("catalog browser renders custom source folders in SOURCE and detail labels", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const candidates = [
    { catalog: "MattPucock", kind: "skill", id: "engineering-skill", source_repository: "matt/skills", source_path: "engineering/engineering-skill", managed: true },
    { catalog: "MattPucock", kind: "skill", id: "productivity-skill", source_repository: "matt/skills", source_path: "productivity/productivity-skill", managed: true },
    { catalog: "Basic", kind: "skill", id: "basic-skill", source_repository: "basic/skills", source_path: "skills/basic-skill", managed: true },
    { catalog: "MattPucock", kind: "skill", id: "unmapped-skill", source_repository: "matt/skills", source_path: "misc/unmapped-skill", managed: true },
  ];
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 140;
  output.rows = 50;
  let renderedOutput = "";
  output.on("data", (chunk) => { renderedOutput += chunk.toString(); });
  const done = runDashboard([], input, output, [], {
    catalogResources: candidates,
    userCatalogs: [{
      name: "MattPucock",
      repository: "matt/skills",
      mode: "custom",
      entries: [
        { kind: "skill", path: "engineering" },
        { kind: "skill", path: "productivity" },
      ],
    }, { name: "Basic", repository: "basic/skills", mode: "basic", entries: [] }],
  });
  input.write("a");
  await new Promise((resolve) => setTimeout(resolve, 100));
  input.write("q");
  assert.equal(await done, true);
  input.destroy();
  output.destroy();
  assert.match(renderedOutput, /MattPucock\[engineering\]/);
  assert.match(renderedOutput, /MattPucock\[productivity\]/);
  assert.match(renderedOutput, /Basic/);
  assert.match(renderedOutput, /unmapped-skill/);
  assert.doesNotMatch(renderedOutput, /MattPucock\[misc\]/);
});
test("catalog browser renders mapped source folders and keeps repository-less names", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const candidates = [
    {
      catalog: "MattPucock", kind: "skill", id: "grill-me",
      source_repository: "matt/skills", source_path: "skills/productivity/grill-me",
      description: "Interview practice", managed: true,
    },
    {
      catalog: "BasicCatalog", kind: "skill", id: "basic-skill",
      source_path: "skills/basic-skill", managed: true,
    },
  ];
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 160;
  output.rows = 40;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const done = runDashboard([], input, output, [], {
    catalogResources: candidates,
    userCatalogs: [{
      name: "MattPucock",
      repository: "matt/skills",
      mode: "custom",
      entries: [{ kind: "skill", path: "skills/productivity" }],
    }],
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  input.write("a");
  await new Promise((resolve) => setTimeout(resolve, 150));
  const plain = () => rendered.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  assert.ok(plain().split(/\r?\n/).some((line) =>
    line.includes("MattPucock[productivity]") && line.includes("grill-me")));
  assert.ok(plain().split(/\r?\n/).some((line) => line.includes("basic-skill") && line.includes("BasicCatalog")));
  assert.match(plain(), /CATALOG[^\n]*\n[^\n]*MattPucock\[productivity\]/);

  input.write("f");
  await new Promise((resolve) => setTimeout(resolve, 50));
  for (const character of "MattPucock[productivity]") input.write(character);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.match(plain(), /AVAILABLE\s+1\/2/);
  assert.ok(plain().split(/\r?\n/).some((line) =>
    line.includes("MattPucock[productivity]") && line.includes("grill-me")));
  input.write("\x1b");
  await new Promise((resolve) => setTimeout(resolve, 50));
  input.write("q");
  assert.equal(await done, true);
  input.destroy();
  output.destroy();
});

test("dashboard refreshes its source catalog set before rebuilding installed skills", async () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-dashboard-source-refresh-"));
  const configDirectory = path.join(temporary, "config");
  const catalogDirectory = path.join(configDirectory, "source-catalogs");
  const target = path.join(temporary, "project");
  const repository = "https://github.com/example/dashboard-skill";
  const source = createSource("upstream", repository);
  const registry = { catalog_version: 1, sources: [{ name: "Test", repository }] };
  const previousConfigDirectory = process.env.KITIA_CONFIG_DIR;
  process.env.KITIA_CONFIG_DIR = configDirectory;
  try {
    const userTarget = path.join(temporary, "user");
    fs.mkdirSync(userTarget, { recursive: true });
    fs.mkdirSync(target, { recursive: true });
    writeJson(path.join(configDirectory, "catalogSources.json"), registry);
    writeJson(path.join(catalogDirectory, "catalogSources.json"), registry);
    writeJson(path.join(catalogDirectory, "Test.json"), createSourceIndex(repository, "Test", source));
    const resource = loadCommandCatalogs({ command: "list" }, () => {})
      .sourceResources.find(({ id }) => id === "demo-skill");
    assert.ok(resource);

    const execute = createDashboardActionHandler(async (options) => {
      const relativePath = ".agents/skills/demo-skill/SKILL.md";
      const skillFile = path.join(options.target, relativePath);
      fs.mkdirSync(path.dirname(skillFile), { recursive: true });
      fs.writeFileSync(skillFile, [
        "---",
        "name: demo-skill",
        "description: Installed from a source catalog.",
        "metadata:",
        `  github-repo: "${resource.source_repository}"`,
        `  github-path: "${resource.source_path}"`,
        `  github-pinned: "${resource.source_ref}"`,
        "---",
        "",
        "Installed skill body.",
        "",
      ].join("\n"));
      recordSourceInstallation(resource, options.target, "github-copilot");
      return 0;
    });
    const result = await execute(
      "install",
      resource,
      { target, userTarget },
      { sourceResources: [resource] },
      { scope: "project", tool: "copilot" },
    );

    assert.equal(result.code, 0);
    assert.ok(result.resources.some((entry) =>
      entry.catalog === "Test" && entry.kind === "skill" && entry.id === "demo-skill"),
    JSON.stringify(result));
  } finally {
    if (previousConfigDirectory === undefined) delete process.env.KITIA_CONFIG_DIR;
    else process.env.KITIA_CONFIG_DIR = previousConfigDirectory;
  }
});
test("dashboard lists unmanaged skills, agents, and instructions without a catalog", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-unmanaged-inventory-"));
  const target = path.join(temporary, "project");
  fs.mkdirSync(target, { recursive: true });
  const externalRepository = "https://github.com/example/external-skills";
  const sourceIndex = createSourceIndex(
    externalRepository, "External", createSource("external-upstream", externalRepository),
  );
  const externalResource = {
    ...sourceIndex.resources[0],
    catalog: "External",
    source_repository: sourceIndex.source_repository,
    source_ref: sourceIndex.source_ref,
  };
  const writeArtifact = (relativePath, content) => {
    const file = path.join(target, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  const sourceSkillPath = ".agents/skills/demo-skill/SKILL.md";
  writeArtifact(sourceSkillPath, [
    "---",
    "name: demo-skill",
    "description: Installed outside Kitia.",
    "metadata:",
    `  github-repo: "${externalResource.source_repository}"`,
    `  github-path: "${externalResource.source_path}"`,
    `  github-pinned: "${externalResource.source_ref}"`,
    "---",
    "",
    "External skill.",
    "",
  ].join("\n"));
  writeArtifact(".claude/skills/category/local-skill/SKILL.md", "Local skill.");
  writeArtifact(".claude/agents/review-helper.md", [
    "---",
    "name: review-helper",
    "description: Reviews code changes.",
    "---",
    "",
  ].join("\n"));
  writeArtifact(".github/instructions/repo-rules.instructions.md", [
    "---",
    "description: Repository-specific guidance.",
    "---",
    "",
  ].join("\n"));
  assert.ok(findUnmanagedArtifacts(target).some((artifact) =>
    artifact.kind === "instruction" && artifact.id === "repo-rules"),
  JSON.stringify(findUnmanagedArtifacts(target)));
  const trackedPath = ".agents/skills/kitia-tracked/SKILL.md";
  writeArtifact(trackedPath, "Tracked through Kitia.");
  const state = readInstallState(target);
  state.sources.Tracked = { skills: { "kitia-tracked": {
    source_repository: "example/tracked",
    source_path: "skills/kitia-tracked",
    source_ref: "a".repeat(40),
    files: { [trackedPath]: installedFingerprint(target, trackedPath) },
  } } };
  writeJson(path.join(target, ".agents/kitia-lock.json"), state);

  const result = collectInstalledScopes({ project: target }, [externalResource]);
  const unmanaged = result.resources.filter((resource) => resource.managed === false);
  assert.deepEqual(
    unmanaged.map(({ kind, id, catalog }) => `${catalog}:${kind}:${id}`).sort(),
    [
      "-:agent:review-helper",
      "-:instruction:repo-rules",
      "-:skill:category/local-skill",
      "-:skill:demo-skill",
    ],
    JSON.stringify(result),
  );
  assert.ok(unmanaged.every((resource) => resource.status === "unmanaged" && resource.scope === "project"));
  const resource = (id) => unmanaged.find((entry) => entry.id === id);
  assert.equal(resource("demo-skill").description, "Installed outside Kitia.");
  assert.equal(resource("review-helper").description, "Reviews code changes.");
  assert.equal(resource("repo-rules").description, "Repository-specific guidance.");
  assert.equal(
    resource("category/local-skill").description,
    ".claude/skills/category/local-skill/SKILL.md",
  );
  const rendered = renderInstalledResources(formatDashboardRows(result.resources, []), {
    columns: 120, isTTY: false,
  });
  assert.match(rendered, /project\s+-\s+skill\s+demo-skill\s+unmanaged/);
  assert.match(rendered, /Installed outside Kitia\./);
  assert.deepEqual(result.errors, []);
  assert.ok(result.resources.some((resource) =>
    resource.catalog === "Tracked" && resource.id === "kitia-tracked" && resource.managed !== false));
});

test("inventory TUI labels a tracked user skill with its custom source folder", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-inventory-source-label-"));
  const target = path.join(temporary, "project");
  fs.mkdirSync(target, { recursive: true });
  const sourceResource = {
    catalog: "MattPucock",
    id: "grill-me",
    kind: "skill",
    description: "A relentless interview to sharpen a plan or design.",
    source_repository: "mattpocock/skills",
    source_path: "skills/productivity/grill-me",
    source_ref: "a".repeat(40),
    license_status: "MIT",
  };
  const writeArtifact = (relativePath, lines) => {
    const file = path.join(target, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, lines.join("\n"));
  };
  const sourceMetadata = [
    `  github-repo: "https://github.com/${sourceResource.source_repository}"`,
    `  github-path: "${sourceResource.source_path}"`,
    `  github-ref: "${sourceResource.source_ref}"`,
    `  github-pinned: "${sourceResource.source_ref}"`,
  ];
  const invokeInstall = (args) => {
    assert.deepEqual(args.slice(0, 4), [
      "skill", "install", sourceResource.source_repository, sourceResource.source_path,
    ]);
    writeArtifact(`.agents/skills/${sourceResource.id}/SKILL.md`, [
      "---", `name: ${sourceResource.id}`, `description: ${sourceResource.description}`, "metadata:",
      ...sourceMetadata, "---", "", "Tracked source content.", "",
    ]);
    return 0;
  };
  assert.equal(runSourceCommand({
    action: "install", id: sourceResource.id, catalog: sourceResource.catalog,
    resource: sourceResource, target, tool: "copilot",
  }, invokeInstall), 0);
  writeArtifact(".agents/skills/manual-skill/SKILL.md", [
    "---", "name: manual-skill", "description: Installed outside Kitia.", "metadata:",
    ...sourceMetadata, "---", "", "Untracked source content.", "",
  ]);

  const result = collectInstalledScopes({ user: target }, [sourceResource]);
  const tracked = result.resources.find((resource) => resource.id === "grill-me");
  assert.equal(tracked.catalog, "MattPucock");
  assert.equal(tracked.source_repository, sourceResource.source_repository);
  assert.equal(tracked.source_path, sourceResource.source_path);
  const untracked = result.resources.find((resource) => resource.id === "manual-skill");
  assert.equal(untracked.managed, false);
  assert.equal(untracked.catalog, "-");

  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 120;
  output.rows = 40;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const done = runDashboard(formatDashboardRows(result.resources, [sourceResource]), input, output, [], {
    userCatalogs: [{
      name: "MattPucock",
      mode: "custom",
      entries: [
        { kind: "skill", path: "skills/productivity" },
        { kind: "skill", path: "skills/engineering" },
        { kind: "skill", path: "skills/misc" },
        { kind: "skill", path: "skills/in-progress" },
      ],
    }],
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  input.write("q");
  assert.equal(await done, true);
  input.destroy();
  output.destroy();
  const plain = rendered.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  assert.match(plain, /grill-me\s+MattPucock\[productivity\]/);
  assert.match(plain, /UNMANAGED\s+USER\s+skill\s+manual-skill\s+-/);
});

test("inventory TUI renders multiple configured custom folders and preserves other catalog labels", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const resource = (catalog, id, source_path, managed = true) => ({
    catalog,
    id,
    kind: "skill",
    description: id,
    managed,
    scope: "project",
    status: managed ? "current" : "unmanaged",
    source_repository: catalog === "-" ? undefined : `example/${catalog.toLowerCase()}`,
    source_path,
  });
  const resources = [
    resource("MattPucock", "engineering-skill", "custom/engineering/engineering-skill"),
    resource("MattPucock", "productivity-skill", "custom/productivity/productivity-skill"),
    resource("BasicCatalog", "basic-skill", "skills/basic-skill"),
    resource("MattPucock", "unmapped-skill", "other/unmapped-skill"),
    resource("-", "manual-skill", "", false),
  ];
  const userCatalogs = [
    {
      name: "MattPucock",
      repository: "https://github.com/example/mattpucock",
      mode: "custom",
      entries: [
        { kind: "skill", path: "custom/engineering" },
        { kind: "skill", path: "custom/productivity" },
      ],
    },
    { name: "BasicCatalog", repository: "https://github.com/example/basic", mode: "basic", entries: [] },
  ];
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 160;
  output.rows = 40;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const done = runDashboard(resources, input, output, [], { userCatalogs });
  await new Promise((resolve) => setTimeout(resolve, 100));
  input.write("q");
  assert.equal(await done, true);
  input.destroy();
  output.destroy();
  const plain = rendered.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  assert.match(plain, /engineering-skill\s+MattPucock\[engineering\]/);
  assert.match(plain, /productivity-skill\s+MattPucock\[productivity\]/);
  assert.match(plain, /basic-skill\s+BasicCatalog/);
  assert.match(plain, /unmapped-skill\s+MattPucock/);
  assert.match(plain, /UNMANAGED\s+PROJECT\s+skill\s+manual-skill\s+-/);
});

test("unmanaged dashboard artifacts can be removed only after confirmation", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 100;
  output.rows = 40;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const actions = [];
  const done = runDashboard([{
    catalog: "-",
    kind: "skill",
    id: "manual-skill",
    scope: "project",
    status: "unmanaged",
    managed: false,
    description: ".agents/skills/manual-skill/SKILL.md",
  }], input, output, [], {
    execute: async (...args) => {
      actions.push(args);
      return { code: 0 };
    },
  });
  for (const key of ["u", "\x1b[3~", "y", "y", "q"]) {
    input.write(key);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(await done, true);
  assert.equal(actions.length, 1);
  assert.equal(actions[0][0], "remove-unmanaged");
  assert.equal(actions[0][1].id, "manual-skill");
  assert.match(rendered, /CONFIRM PERMANENT REMOVAL/);
  assert.match(rendered, /irreversible/);
  assert.match(rendered, /permanently lost/);
  input.destroy();
  output.destroy();
});

test("removing an unmanaged skill deletes its entire detected folder", async () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-dashboard-unmanaged-remove-"));
  const target = path.join(temporary, "project");
  const userTarget = path.join(temporary, "user");
  const skillDirectory = path.join(target, ".agents/skills/manual-skill");
  fs.mkdirSync(skillDirectory, { recursive: true });
  fs.mkdirSync(userTarget, { recursive: true });
  const entryFile = path.join(skillDirectory, "SKILL.md");
  const extraFile = path.join(skillDirectory, "reference.txt");
  fs.writeFileSync(entryFile, "Unmanaged skill entry point.");
  fs.writeFileSync(extraFile, "User-owned supporting file.");

  const execute = createDashboardActionHandler(async () => {
    throw new Error("Unmanaged removal must not invoke the tracked-resource CLI.");
  });
  const result = await execute(
    "remove-unmanaged",
    { catalog: "-", kind: "skill", id: "manual-skill", scope: "project", managed: false },
    { target, userTarget },
    { sourceResources: [] },
  );
  assert.equal(result.code, 0);
  assert.equal(fs.existsSync(skillDirectory), false);
  assert.equal(fs.existsSync(entryFile), false);
  assert.equal(fs.existsSync(extraFile), false);
  assert.ok(!result.resources.some((resource) => resource.id === "manual-skill"));
});

test("dashboard update dispatch reaches the CLI update command for the selected catalog resource", async () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-dashboard-update-dispatch-"));
  const configDirectory = path.join(temporary, "config");
  const sourceIndexDirectory = path.join(configDirectory, "source-catalogs");
  const target = path.join(temporary, "project");
  const userTarget = path.join(temporary, "user");
  const repository = "https://github.com/example/dashboard-update";
  const previousConfigDirectory = process.env.KITIA_CONFIG_DIR;
  process.env.KITIA_CONFIG_DIR = configDirectory;
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(userTarget, { recursive: true });
  const source = createSource("dashboard-update-upstream", repository);
  const configuration = { catalog_version: 1, sources: [{ name: "Test", repository }] };
  writeJson(path.join(configDirectory, "catalogSources.json"), configuration);
  writeJson(path.join(sourceIndexDirectory, "catalogSources.json"), configuration);
  writeJson(
    path.join(sourceIndexDirectory, "Test.json"),
    createSourceIndex(repository, "Test", source),
  );
  const resource = {
    ...createSourceIndex(repository, "Test", source).resources[0],
    catalog: "Test",
    scope: "project",
    status: "attention",
    managed: true,
  };
  let dispatched;
  try {
    const execute = createDashboardActionHandler(async (options) => {
      dispatched = options;
      return 0;
    });
    const result = await execute(
      "update",
      resource,
      { target, userTarget },
      { sourceResources: [resource] },
    );

    assert.equal(result.code, 0);
    assert.equal(dispatched.command, "update");
    assert.equal(dispatched.catalog, "Test");
    assert.equal(dispatched.kind, "skill");
    assert.equal(dispatched.id, resource.id);
    assert.equal(dispatched.target, target);
    assert.equal(dispatched.nonInteractive, true);
    assert.deepEqual(dispatched.sourceResources, [resource]);
    assert.equal(dispatched.ghForce, undefined, "the initial dashboard update must not request GH force");
    await execute(
      "update",
      resource,
      { target, userTarget },
      { sourceResources: [resource] },
      { ghForce: true, ghForceAgent: "github-copilot" },
    );
    assert.equal(dispatched.ghForce, true, "the explicit retry carries GH-only force state");
    assert.equal(dispatched.ghForceAgent, "github-copilot", "the GH retry identifies the failed agent");
    assert.equal(dispatched.force, false, "a GH retry must not activate Kitia's local-force override");
  } finally {
    if (previousConfigDirectory === undefined) delete process.env.KITIA_CONFIG_DIR;
    else process.env.KITIA_CONFIG_DIR = previousConfigDirectory;
  }
});
test("dashboard update reaches the production CLI and reports a safe local-conflict failure", async () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-dashboard-update-cli-"));
  const configDirectory = path.join(temporary, "config");
  const sourceIndexDirectory = path.join(configDirectory, "source-catalogs");
  const target = path.join(temporary, "project");
  const repository = "https://github.com/example/dashboard-update";
  const previousConfigDirectory = process.env.KITIA_CONFIG_DIR;
  process.env.KITIA_CONFIG_DIR = configDirectory;
  fs.mkdirSync(target, { recursive: true });
  const source = createSource("dashboard-update-cli-upstream", repository);
  const configuration = { catalog_version: 1, sources: [{ name: "Test", repository }] };
  writeJson(path.join(configDirectory, "catalogSources.json"), configuration);
  writeJson(path.join(sourceIndexDirectory, "catalogSources.json"), configuration);
  const index = createSourceIndex(repository, "Test", source);
  writeJson(path.join(sourceIndexDirectory, "Test.json"), index);
  const resource = {
    ...index.resources[0],
    catalog: "Test",
    source_repository: index.source_repository,
    source_ref: index.source_ref,
    scope: "project",
    managed: true,
  };
  const skillFile = path.join(target, ".agents/skills/demo-skill/SKILL.md");
  fs.mkdirSync(path.dirname(skillFile), { recursive: true });
  fs.writeFileSync(skillFile, [
    "---",
    "name: demo-skill",
    "description: A generated source skill.",
    "metadata:",
    `  github-repo: "https://github.com/${resource.source_repository}"`,
    `  github-path: "${resource.source_path}"`,
    `  github-ref: "${resource.source_ref}"`,
    `  github-pinned: "${resource.source_ref}"`,
    "---",
    "",
    "Synthetic installed skill.",
    "",
  ].join("\n"));

  try {
    recordSourceInstallation(resource, target, "github-copilot");
    fs.writeFileSync(skillFile, "Locally modified content that the updater must protect.\n");
    const execute = createDashboardActionHandler(executeCommand);
    await assert.rejects(
      execute("update", resource, { target }, { sourceResources: [resource] }),
      /Refusing to overwrite locally modified .*demo-skill.*SKILL\.md.*--force/,
    );
    const originalLog = console.log;
    const output = [];
    console.log = (line) => output.push(line);
    try {
      assert.equal(await runCliMain([
        "update", "skill", "demo-skill", "--target", target, "--dry-run", "--json",
      ]), 1);
    } finally {
      console.log = originalLog;
    }
    const report = JSON.parse(output.join("\n"));
    assert.equal(report.errors[0].code, "LOCAL_CONFLICT");
    assert.match(report.errors[0].message, /locally modified/);
    assert.equal(fs.readFileSync(skillFile, "utf8"), "Locally modified content that the updater must protect.\n");
  } finally {
    if (previousConfigDirectory === undefined) delete process.env.KITIA_CONFIG_DIR;
    else process.env.KITIA_CONFIG_DIR = previousConfigDirectory;
  }
});


test("dashboard renders the resource list and selection panel at wide and narrow widths", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  for (const columns of [160, 100]) {
    const input = new PassThrough();
    input.isTTY = true;
    input.setRawMode = () => {};
    input.ref = () => {};
    input.unref = () => {};
    const output = new PassThrough();
    output.isTTY = true;
    output.columns = columns;
    output.rows = 40;
    let rendered = "";
    output.on("data", (chunk) => { rendered += chunk.toString(); });
    const done = runDashboard([{
      catalog: "a-very-long-external-catalog-name-for-layout-smoke-testing",
      kind: "skill",
      id: "manual-skill",
      scope: "project",
      status: "current",
      managed: true,
      description: "A manually maintained skill.",
      source_repository: "example/manual-skill",
      source_path: "skills/manual-skill",
      source_ref: "abcdef0123456789abcdef0123456789abcdef01",
    }], input, output);
    await new Promise((resolve) => setTimeout(resolve, 100));
    input.write("q");
    assert.equal(await done, true);
    assert.match(rendered, /RESOURCES/);
    assert.match(rendered, /SKILL - manual-skill/);
    assert.match(rendered, /VERSION/);
    const inventoryRow = rendered.split(/\r?\n/).find((line) => line.includes("manual-skill"));
    assert.ok(inventoryRow, "inventory row is rendered");
    assert.doesNotMatch(inventoryRow, /A manually maintained skill/);
    assert.doesNotMatch(rendered, /DESC\s/);
    assert.match(rendered, /STATUS[\s\S]*SCOPE[\s\S]*KIND[\s\S]*ID[\s\S]*CATALOG/);
    const header = rendered.split(/\r?\n/).find((line) => /STATUS/.test(line) && /CATALOG/.test(line));
    assert.ok(header, "inventory header is rendered");
    const column = (label) => header.indexOf(label);
    assert.ok(column("STATUS") < column("SCOPE") && column("SCOPE") < column("KIND") &&
      column("KIND") < column("ID") && column("ID") < column("CATALOG"));
    assert.ok(column("CATALOG") - column("ID") > 12, "catalog receives flexible width after the ID column");
    const selectedPanel = rendered.slice(rendered.lastIndexOf("SKILL - manual-skill"));
    const catalogLabel = selectedPanel.indexOf("CATALOG");
    const catalogValue = selectedPanel.indexOf("a-very-long-external-catalog-name");
    assert.ok(selectedPanel.slice(catalogLabel, catalogValue).includes("\n"));
    assert.match(selectedPanel, /a-very-long-external-catalog-name-for-layout(?:\.\.\.|-smoke-testing)/);
    assert.match(selectedPanel, /abcdef0/);
    assert.match(selectedPanel, /https:\/\/github\.com\/example\/manual-skill/);
    assert.match(selectedPanel, /A manually maintained skill\./);
    if (columns >= 112) {
      assert.match(rendered, /LOCATIONS/);
      assert.match(rendered, /DESCRIPTION/);
      assert.match(rendered, /STATUS/);
    }
    input.destroy();
    output.destroy();
  }
});
test("catalog browser renders ordered columns without list descriptions at wide and narrow widths", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  for (const columns of [160, 100]) {
    const input = new PassThrough();
    input.isTTY = true;
    input.setRawMode = () => {};
    input.ref = () => {};
    input.unref = () => {};
    const output = new PassThrough();
    output.isTTY = true;
    output.columns = columns;
    output.rows = 40;
    let rendered = "";
    output.on("data", (chunk) => { rendered += chunk.toString(); });
    const sourceName = "MattPucock";
    const kind = "instruction";
    const done = runDashboard([], input, output, [], { catalogResources: [{
      catalog: sourceName,
      kind,
      id: "catalog-skill",
      description: "Catalog panel toggle behavior.",
    }] });
    await new Promise((resolve) => setTimeout(resolve, 100));
    input.write("a");
    await new Promise((resolve) => setTimeout(resolve, 200));
    const plainRendered = rendered.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
    const header = plainRendered.split(/\r?\n/).find((line) => /INSTALLED/.test(line) && /SOURCE/.test(line));
    assert.ok(header, "catalog header is rendered");
    assert.ok(header.indexOf("INSTALLED") < header.indexOf("SOURCE") &&
      header.indexOf("SOURCE") < header.indexOf("KIND") && header.indexOf("KIND") < header.indexOf("ID"));
    assert.ok(header.indexOf("KIND") - header.indexOf("SOURCE") >= 12, "Source allocation fits MattPucock");
    assert.ok(header.indexOf("ID") - header.indexOf("KIND") >= 12, "ID column remains usable");
    const row = plainRendered.split(/\r?\n/).find((line) =>
      line.includes(sourceName) && line.includes("catalog-skill"));
    assert.ok(row, "catalog row is rendered");
    const sourcePosition = row.indexOf(sourceName);
    const kindPosition = row.indexOf("instruction");
    const idPosition = row.indexOf("catalog-skill");
    assert.ok(sourcePosition >= 0 && kindPosition > sourcePosition && idPosition > kindPosition,
      `source, kind, and ID values render in order: ${JSON.stringify({ sourcePosition, kindPosition, idPosition, row })}`);
    const listRow = row.split("│ │", 1)[0];
    assert.doesNotMatch(listRow, /Catalog panel toggle behavior\./);
    const listHeader = header.split("│ │", 1)[0];
    assert.doesNotMatch(listHeader, /DESC/);
    assert.match(rendered, /DESCRIPTION[^\n]*\n[^\n]*Catalog panel toggle behavior\./);
    input.write("q");
    assert.equal(await done, true);
    input.destroy();
    output.destroy();
  }
});
test("inspection modal bounds wrapped preview content to the terminal height", async () => {
  const { inspectionModal } = await import("../dist/dashboard/modals.mjs");
  const rows = 30;
  const modal = inspectionModal({
    action: "preview",
    resource: { catalog: "AI-Kit", kind: "skill", id: "conventional-commits" },
    content: Array.from({ length: 24 }, (_, index) =>
      `Preview paragraph ${index}: ${"conventional commit guidance ".repeat(5)}`).join("\n"),
    columns: 100,
    rows,
  });
  const modalHeight = modal.lines.length + modal.shortcuts.length + 1;
  assert.ok(modalHeight <= rows - 2, `modal height ${modalHeight} must fit inside ${rows} terminal rows`);
  assert.ok(modal.lines.some(({ text }) => text.includes("output truncated in dashboard")));
});
test("catalog browser previews source text and reports audits from keyboard actions", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 120;
  output.rows = 40;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const calls = [];
  const done = runDashboard([], input, output, [], {
    catalogResources: [{ catalog: "sample", kind: "agent", id: "reviewer", source_repository: "org/repo" }],
    execute: async (action) => {
      calls.push(action);
      return { code: 0, messages: [action === "preview" ? "# Source body" : "Audit coverage: 1/1 files analyzed."], resources: [], errors: [] };
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  input.write("a");
  await new Promise((resolve) => setTimeout(resolve, 80));
  input.write("p");
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.match(rendered, /SOURCE PREVIEW/);
  assert.match(rendered, /# Source body/);
  input.write("\r");
  await new Promise((resolve) => setTimeout(resolve, 50));
  input.write("a");
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.match(rendered, /RESOURCE AUDIT/);
  assert.match(rendered, /Audit coverage: 1\/1 files analyzed/);
  assert.deepEqual(calls, ["preview", "audit"]);
  input.write("\r");
  await new Promise((resolve) => setTimeout(resolve, 80));
  input.write("q");
  assert.equal(await done, true);
  input.destroy();
  output.destroy();
});
test("dashboard toggles the selection panel with D", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 160;
  output.rows = 40;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const done = runDashboard([{
    catalog: "sample-catalog",
    kind: "skill",
    id: "manual-skill",
    scope: "project",
    status: "current",
    managed: true,
    description: "Description toggle behavior.",
  }], input, output);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.match(rendered, /SKILL - manual-skill/);
  const beforeHide = rendered.length;
  input.write("d");
  await new Promise((resolve) => setTimeout(resolve, 100));
  const hiddenFrame = rendered.slice(beforeHide);
  assert.doesNotMatch(hiddenFrame, /SKILL - manual-skill/);
  const beforeShow = rendered.length;
  input.write("d");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.match(rendered.slice(beforeShow), /SKILL - manual-skill/);
  input.write("q");
  assert.equal(await done, true);
  input.destroy();
  output.destroy();
});

test("dashboard toggles the catalog entry panel with D", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 160;
  output.rows = 40;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const candidates = [{
    catalog: "sample-catalog",
    kind: "skill",
    id: "catalog-skill",
    description: "Catalog panel toggle behavior.",
  }];
  const done = runDashboard([], input, output, [], { catalogResources: candidates });
  await new Promise((resolve) => setTimeout(resolve, 100));
  input.write("a");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.match(rendered, /SKILL - catalog-skill/);
  const resourcesTitle = rendered.indexOf("CATALOG RESOURCES");
  const entryTitle = rendered.indexOf("SKILL - catalog-skill");
  assert.equal(
    rendered.lastIndexOf("\n", resourcesTitle),
    rendered.lastIndexOf("\n", entryTitle),
  );
  const entryPanel = rendered.slice(entryTitle);
  assert.match(entryPanel, /CATALOG[^\n]*\n[^\n]*sample-catalog/);
  assert.match(entryPanel, /DESCRIPTION[^\n]*\n[^\n]*Catalog panel toggle behavior\./);
  const beforeHide = rendered.length;
  input.write("d");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.doesNotMatch(rendered.slice(beforeHide), /SKILL - catalog-skill/);
  const beforeShow = rendered.length;
  input.write("d");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.match(rendered.slice(beforeShow), /SKILL - catalog-skill/);
  input.write("q");
  assert.equal(await done, true);
  input.destroy();
  output.destroy();
});

test("dashboard toggles catalog management details with D", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 160;
  output.rows = 24;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const done = runDashboard([], input, output, [], {
    userCatalogs: [{ name: "Sample", repository: "example/sample" }],
    checkCatalogFreshness: async () => [{ name: "Sample", status: "current" }],
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  input.write("m");
  await new Promise((resolve) => setTimeout(resolve, 100));
  const managementHeader = rendered.indexOf("USER CATALOGS 1");
  const panelTop = rendered.indexOf("┌", managementHeader);
  const panelTopEnd = rendered.indexOf("\n", panelTop);
  assert.ok((rendered.slice(panelTop, panelTopEnd).match(/┌/g) || []).length >= 2);
  const detailsPanel = rendered.slice(rendered.indexOf("CATALOG - Sample"));
  assert.match(detailsPanel, /REPOSITORY example\/sample/);
  assert.match(detailsPanel, /FRESHNESS UP TO DATE/);
  assert.match(rendered, /Updates catalog metadata only/);
  const beforeHide = rendered.length;
  input.write("d");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.doesNotMatch(rendered.slice(beforeHide), /Updates catalog metadata only/);
  const beforeShow = rendered.length;
  input.write("d");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.match(rendered.slice(beforeShow), /Updates catalog metadata only/);
  input.write("q");
  assert.equal(await done, true);
  input.destroy();
  output.destroy();
});


test("inventory columns reserve usable ID space and expose custom Catalog suffixes at 120 columns", async () => {
  const { detailPanelLayout, tableColumns } = await import("../dist/dashboard/helpers.mjs");
  const listWidth = detailPanelLayout(120).listWidth;
  const columns = tableColumns(listWidth);
  const wide = tableColumns(160);
  const narrower = tableColumns(100);
  assert.equal(columns.id >= 12, true);
  assert.equal(columns.catalog >= "MattPucock[productivity]".length, true);
  assert.equal(wide.id >= 12, true);
  assert.equal(narrower.id >= 12, true);
  assert.equal(wide.catalog > narrower.catalog, true);
  assert.equal(tableColumns(60).catalog, 0);
});

test("dashboard uses a shared list/details split at wide terminal widths", async () => {
  const { detailPanelLayout } = await import("../dist/dashboard/helpers.mjs");
  assert.deepEqual(detailPanelLayout(160), {
    sideBySide: true, listWidth: 106, detailsWidth: 51,
  });
  assert.deepEqual(detailPanelLayout(100), {
    sideBySide: false, listWidth: undefined, detailsWidth: undefined,
  });
});


test("versions parser selects a skill and installs accept full SHAs or strict hexadecimal prefixes", () => {
  const sha = "c".repeat(40);
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-versions-args-"));
  const previous = process.env.KITIA_CONFIG_DIR;
  process.env.KITIA_CONFIG_DIR = temporary;
  writeJson(path.join(temporary, "catalogSources.json"), {
    catalog_version: 1, sources: [{ name: "Test", repository: "https://github.com/example/skills" }],
  });
  try {
    assert.deepEqual(parseArguments(["versions", "skill", "demo-skill", "--catalog", "Test"]), {
      command: "versions", kind: "skill", id: "demo-skill", catalog: "Test",
    });
  } finally {
    if (previous === undefined) delete process.env.KITIA_CONFIG_DIR;
    else process.env.KITIA_CONFIG_DIR = previous;
  }
  assert.equal(parseArguments(["install", "skill", "demo-skill", "--ref", sha]).ref, sha);
  assert.equal(parseArguments(["update", "skill", "demo-skill", "--ref", sha.slice(0, 7)]).ref, sha.slice(0, 7));
  assert.throws(() => parseArguments(["install", "skill", "demo-skill", "--ref", "abc"]), /7- to 40-character hexadecimal/);
  assert.throws(() => parseArguments(["install", "skill", "demo-skill", "--ref", "g".repeat(7)]), /7- to 40-character hexadecimal/);
  assert.throws(() => parseArguments(["update", "--ref", sha]), /specific skill install or update/);
});

test("skill history displays unique, aligned prefixes when seven-character SHAs collide", () => {
  const versions = [
    { sha: `abcdef0${"0".repeat(33)}`, date: "2025-04-03T12:13:14Z", subject: "first" },
    { sha: `abcdef0${"1".repeat(33)}`, date: "2025-04-03T12:13:14Z", subject: "second" },
  ];
  const prefixes = uniqueSkillVersionPrefixes(versions);
  assert.deepEqual(prefixes, ["abcdef00", "abcdef01"]);
  for (const [index, prefix] of prefixes.entries()) {
    assert.equal(resolveSkillVersionPrefix(versions, prefix), versions[index].sha);
  }
  const [header, , ...rows] = formatSkillVersionTable(versions);
  const dateColumn = header.indexOf("DATE");
  assert.equal(rows[0].indexOf(versions[0].date), dateColumn);
  assert.equal(rows[1].indexOf(versions[1].date), dateColumn);
});

test("skill history resolves only unique listed SHA prefixes", () => {
  const versions = [{ sha: "abcdef0".padEnd(40, "0") }, { sha: "abcdef1".padEnd(40, "1") }];
  assert.equal(resolveSkillVersionPrefix(versions, "ABCDEF0"), versions[0].sha);
  assert.throws(() => resolveSkillVersionPrefix(versions, "abcdef"), /ambiguous/);
  assert.throws(() => resolveSkillVersionPrefix(versions, "1234567"), /not found/);
});

test("skill versions query GitHub API pages and expose SHA, committer date and commit subject", () => {
  const resource = {
    kind: "skill", id: "demo-skill", source_repository: "example/skills",
    source_path: "skills/demo-skill",
  };
  const calls = [];
  const versions = listSkillVersions(resource, (program, args) => {
    calls.push([program, args]);
    return JSON.stringify([{
      sha: "d".repeat(40),
      commit: {
        committer: { date: "2025-04-03T12:13:14Z" },
        message: "Improve demo skill\n\nDetails",
      },
    }]);
  });
  assert.deepEqual(versions, [{
    sha: "d".repeat(40), date: "2025-04-03T12:13:14Z", subject: "Improve demo skill",
  }]);
  assert.deepEqual(calls, [[
    "gh",
    [
      "api", "-X", "GET", "repos/example/skills/commits", "-f", "path=skills/demo-skill/SKILL.md",
      "-F", "per_page=100", "-F", "page=1",
    ],
  ]]);
});
test("async skill history keeps GitHub queries off the dashboard event loop", async () => {
  const resource = {
    kind: "skill", id: "demo-skill", source_repository: "example/skills",
    source_path: "skills/demo-skill",
  };
  const calls = [];
  const versions = await listSkillVersionsAsync(resource, async (program, args) => {
    calls.push([program, args]);
    await new Promise((resolve) => setImmediate(resolve));
    return JSON.stringify([{
      sha: "e".repeat(40),
      commit: { committer: { date: "2025-04-03T12:13:14Z" }, message: "Async history" },
    }]);
  });
  assert.equal(versions[0].subject, "Async history");
  assert.equal(calls[0][0], "gh");
  assert.ok(calls[0][1].includes("-F") && calls[0][1].includes("page=1"));
});

test("skill version history caps API pagination and reports authentication/network failures", () => {
  const resource = {
    kind: "skill", id: "demo-skill", source_repository: "example/skills",
    source_path: "skills/demo-skill",
  };
  let pages = 0;
  assert.equal(listSkillVersions(resource, (_program, args) => {
    pages += 1;
    assert.equal(args[args.indexOf("-F") + 1], "per_page=100");
    return JSON.stringify(Array.from({ length: 100 }, (_, index) => ({
      sha: index.toString(16).padStart(40, "0"),
      commit: { committer: { date: "2025-04-03T12:13:14Z" }, message: `change ${index}` },
    })));
  }).length, 500);
  assert.equal(pages, 5);
  assert.throws(() => listSkillVersions(resource, () => {
    const error = new Error("gh failed");
    error.stderr = Buffer.from("HTTP 401: authentication required");
    throw error;
  }), /HTTP 401: authentication required/);
  assert.throws(() => listSkillVersions(resource, () => { throw new Error("network unavailable"); }), /network unavailable/);
  assert.throws(() => listSkillVersions({ ...resource, kind: "agent" }, () => assert.fail()), /GitHub source skills/);
});

test("an explicit skill ref is installed and recorded without changing the catalog resource pin", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-explicit-ref-"));
  const target = path.join(temporary, "target");
  fs.mkdirSync(target);
  const catalogResource = {
    catalog: "team-alpha", id: "demo-skill", kind: "skill",
    description: "A source skill.", source_repository: "example/team-alpha",
    source_path: "skills/demo-skill", source_ref: "a".repeat(40), license_status: "MIT",
  };
  const requestedRef = "b".repeat(40);
  let installedRef;
  const invoke = (args) => {
    installedRef = args[args.indexOf("--pin") + 1];
    const skillFile = path.join(target, ".agents/skills/demo-skill/SKILL.md");
    fs.mkdirSync(path.dirname(skillFile), { recursive: true });
    fs.writeFileSync(skillFile, [
      "---", "name: demo-skill", "description: A source skill.", "metadata:",
      `  github-repo: "https://github.com/${catalogResource.source_repository}"`,
      `  github-path: "${catalogResource.source_path}"`,
      `  github-ref: "${installedRef}"`, `  github-pinned: "${installedRef}"`,
      "---", "", "Pinned test revision.", "",
    ].join("\n"));
    return 0;
  };
  assert.equal(runSourceCommand({
    action: "install", id: catalogResource.id, catalog: catalogResource.catalog,
    resource: { ...catalogResource, source_ref: requestedRef }, target, tool: "copilot",
  }, invoke), 0);
  assert.equal(installedRef, requestedRef);
  assert.equal(catalogResource.source_ref, "a".repeat(40));
  assert.equal(readInstallState(target).sources["team-alpha"].skills["demo-skill"].source_ref, requestedRef);
  assert.deepEqual(updateSourceResources(
    readInstalledSourceSkills(target, [catalogResource]), target, {},
    invoke,
  ), [`Updated ${catalogResource.catalog} catalog skill: ${catalogResource.id}`]);
  assert.equal(installedRef, catalogResource.source_ref);
  assert.equal(readInstallState(target).sources["team-alpha"].skills["demo-skill"].source_ref, catalogResource.source_ref);
  assert.equal(catalogResource.source_ref, "a".repeat(40));
  assert.equal(buildSourceSkillArgs("install", { ...catalogResource, source_ref: requestedRef }, "github-copilot")
    .at(-1), requestedRef);
});
