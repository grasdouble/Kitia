"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { afterEach, test } = require("node:test");
const {
  checkCatalogFreshness, createSourceIndex, manageCatalogCommand, updateCatalog,
} = require("../dist/catalog/sources/manage.js");
const { installSourceFileResource } = require("../dist/catalog/sources/skills.js");
const { loadUserSourceConfiguration, validateSourceConfiguration } = require("../dist/catalog/sources/config.js");
const { createDashboardActionHandler } = require("../dist/cli/dashboard.js");
const { recordSourceInstallation } = require("../dist/catalog/sources/installed.js");
const { loadCommandCatalogs } = require("../dist/catalog/loading.js");
const { findUnmanagedArtifacts, installedFingerprint, readInstallState } = require("../dist/catalog/inventory/index.js");
const { collectInstalledScopes } = require("../dist/catalog/lifecycle.js");
const { formatDashboardRows } = require("../dist/cli/catalog.js");
const { renderInstalledResources } = require("../dist/dashboard/terminal.js");
const {
  checkInstalledResources, readInstalledSourceSkills, runSourceCommand,
  uninstallSourceResource, updateSourceResources,
} = require("../dist/cli/main.js");
const { uninstallResource } = require("../dist/catalog/lifecycle.js");
const { parseArguments } = require("../dist/cli/arguments.js");

let temporary;

afterEach(() => {
  if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
  temporary = null;
});
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

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


test("catalog freshness compares cached index with remote default branch", async () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-catalog-freshness-"));
  const previousConfig = process.env.KITIA_CONFIG_DIR;
  const previousPath = process.env.PATH;
  const configDirectory = path.join(temporary, "config");
  const repository = "https://github.com/example/test";
  const revision = "a".repeat(40);
  const remote = (ref) => async () => ({ stdout: `${ref}\tHEAD\n` });
  try {
    const fakeBin = path.join(temporary, "bin");
    fs.mkdirSync(fakeBin);
    const fakeGit = path.join(fakeBin, "git");
    fs.writeFileSync(fakeGit, `#!/bin/sh\nprintf '%s\\tHEAD\\n' '${revision}'\n`);
    fs.chmodSync(fakeGit, 0o755);
    process.env.PATH = [fakeBin, previousPath].filter(Boolean).join(path.delimiter);
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
    assert.deepEqual(await checkCatalogFreshness(), [
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
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
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
    const added = run(["add", "internal", repository]);
    assert.equal(added.code, 0, added.errors.join("\n"));
    assert.match(added.logs.join("\n"), /Added catalog internal/);
    assert.deepEqual(run(["list"]).logs, [`internal\t${repository}`]);
    assert.equal(fs.existsSync(path.join(configDirectory, "source-catalogs", "internal.json")), true);
    assert.equal(parseArguments(["list", "--catalog", "internal"]).catalog, "internal");
    const loaded = loadCommandCatalogs({ command: "list", catalog: "internal" }, process.cwd(), () => {});
    assert.ok(loaded.sourceResources.length > 0);
    assert.ok(loaded.sourceResources.every((resource) => resource.catalog === "internal"));
    assert.equal(run(["remove", "internal"]).code, 0);
    assert.deepEqual(loadUserSourceConfiguration(), []);
    assert.equal(fs.existsSync(path.join(configDirectory, "source-catalogs", "internal.json")), false);
  } finally {
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
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
  const instruction = path.join(source, ".github", "instructions", "checklist.instructions.md");
  fs.mkdirSync(path.dirname(agent), { recursive: true });
  fs.mkdirSync(path.dirname(instruction), { recursive: true });
  fs.writeFileSync(agent, [
    "---", "name: release", "description: Release agent.", "---", "", "Agent body.",
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
    "agent:release", "instruction:checklist", "instruction:global-guidance",
    "skill:demo-skill", "skill:research",
  ]);
  assert.equal(catalog.resources.find((entry) => entry.kind === "agent").source_path,
    "agents/engineering/release.agent.md");
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
    const loaded = loadCommandCatalogs({ command: "list" }, path.resolve(__dirname, ".."));
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
    const loaded = loadCommandCatalogs({ command: "list" }, path.resolve(__dirname, ".."));
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
    resources: {},
    bundles: {},
    mcps: {},
    sources: { retired: { skills: { "retired-skill": record } } },
  }));

  const loaded = loadCommandCatalogs({
    command: "uninstall", kind: "skill", target,
  }, process.cwd(), () => assert.fail("uninstall must not need source discovery"));
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
    resources: {},
    bundles: {},
    mcps: {},
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
  }, process.cwd(), () => assert.fail("a colliding install must not invoke gh")), /already tracked from another catalog/);
});

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
  const invoke = (args) => {
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
  }, temporary, invoke), 0);
  const state = readInstallState(target);
  assert.equal(state.sources["team-alpha"].skills["demo-skill"].source_ref, sourceResource.source_ref);
  assert.equal(state.source_skills, undefined);
  assert.equal(readInstalledSourceSkills(target, [sourceResource]).length, 1);
  const buildInfo = { commit: "b".repeat(40), package_version: "test", dirty: false };
  const checked = checkInstalledResources(
    target, [], temporary, buildInfo, [sourceResource], { catalog: "team-alpha" },
  );
  assert.equal(checked.updateAvailable, false);
  assert.equal(
    checked.resources.find((resource) => resource.id === sourceResource.id).version,
    installedRef.slice(0, 7),
  );

  const updatedResource = { ...sourceResource, source_ref: "c".repeat(40) };
  const installed = readInstalledSourceSkills(target, [updatedResource]);
  assert.match(updateSourceResources(installed, target, {}, invoke).join("\n"), /Updated team-alpha catalog skill/);
  assert.equal(installedRef, updatedResource.source_ref);
  assert.equal(checkInstalledResources(
    target, [], temporary, buildInfo, [updatedResource], { catalog: "team-alpha" },
  ).updateAvailable, false);
  assert.match(uninstallSourceResource(updatedResource, target).join("\n"), /Removed team-alpha catalog skill entry point/);
  assert.equal(fs.existsSync(path.join(target, ".agents/skills/demo-skill")), false);
  assert.equal(readInstalledSourceSkills(target, []).length, 0);
});
test("uninstalling a locally managed skill removes its entire directory", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-managed-skill-uninstall-"));
  const target = path.join(temporary, "project");
  const skillDirectory = path.join(target, ".agents/skills/managed-skill");
  fs.mkdirSync(skillDirectory, { recursive: true });
  const relativePath = ".agents/skills/managed-skill/SKILL.md";
  fs.writeFileSync(path.join(skillDirectory, "SKILL.md"), "Managed skill body.");
  fs.writeFileSync(path.join(skillDirectory, "local-note.txt"), "Additional file.");
  writeJson(path.join(target, ".agents/kitia-lock.json"), {
    lock_version: 1,
    catalog: "grasdouble/Kitia",
    resources: {
      "skill:managed-skill": {
        tool: "copilot",
        standalone: false,
        digest: "a".repeat(64),
        commit: "b".repeat(40),
        version: "1.0.0",
        files: { [relativePath]: installedFingerprint(target, relativePath) },
      },
    },
    sources: {},
    bundles: {},
    mcps: {},
  });

  const messages = uninstallResource("skill", "managed-skill", target);
  assert.equal(fs.existsSync(skillDirectory), false);
  assert.match(messages.join("\n"), /Removed skill directory: \.agents\/skills\/managed-skill/);
});

test("dashboard manages user catalogs and refreshes one or all catalogs", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const { addCatalogModal, refreshCatalogModal, removeCatalogModal } = await import("../dist/dashboard/modals.mjs");
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
    for (const key of keys) {
      input.write(key);
      await new Promise((resolve) => setTimeout(resolve, 100));
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
  assert.match(management.renderedOutput, /A add catalog/);
  assert.match(management.renderedOutput, /Delete remove selected/);
  assert.match(management.renderedOutput, /R refresh/);
  assert.match(management.renderedOutput, /A add catalog - Delete remove selected - E edit selected - R refresh \|/);
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
  const initialDashboard = await driveRefresh(["q"], refresh);
  assert.equal(initialDashboard.result, true);
  assert.doesNotMatch(initialDashboard.renderedOutput, /A add catalog|Delete remove selected|R refresh/);
  assert.doesNotMatch(initialDashboard.renderedOutput, /G refresh/);
  assert.match(initialDashboard.renderedOutput, /F filter.*\|.*navigate/);
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
    const resource = loadCommandCatalogs({ command: "list" }, process.cwd(), () => {})
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
      process.cwd(),
      { resources: [], sourceResources: [], allResources: [] },
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

  const result = collectInstalledScopes(
    { project: target }, [], process.cwd(), { dirty: false }, [externalResource],
  );
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
    process.cwd(),
    { resources: [], sourceResources: [], allResources: [] },
  );
  assert.equal(result.code, 0);
  assert.equal(fs.existsSync(skillDirectory), false);
  assert.equal(fs.existsSync(entryFile), false);
  assert.equal(fs.existsSync(extraFile), false);
  assert.ok(!result.resources.some((resource) => resource.id === "manual-skill"));
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
      catalog: "sample-catalog",
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
    const selectedPanel = rendered.slice(rendered.indexOf("SKILL - manual-skill"));
    const orderedLabels = ["CATALOG", "SCOPE", "STATUS", "VERSION", "LOCATIONS", "DESCRIPTION"];
    assert.ok(orderedLabels.every((label, index) =>
      index === 0 || selectedPanel.indexOf(label) > selectedPanel.indexOf(orderedLabels[index - 1])));
    const catalogLabel = selectedPanel.indexOf("CATALOG");
    const catalogValue = selectedPanel.indexOf("sample-catalog");
    assert.ok(selectedPanel.slice(catalogLabel, catalogValue).includes("\n"));
    assert.match(selectedPanel, /sample-catalog/);
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
  assert.match(detailsPanel, /REPOSITORY[^\n]*\n[^\n]*example\/sample/);
  assert.match(detailsPanel, /FRESHNESS[^\n]*\n[^\n]*UP TO DATE/);
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


test("dashboard uses a shared list/details split at wide terminal widths", async () => {
  const { detailPanelLayout } = await import("../dist/dashboard/helpers.mjs");
  assert.deepEqual(detailPanelLayout(160), {
    sideBySide: true, listWidth: 106, detailsWidth: 51,
  });
  assert.deepEqual(detailPanelLayout(100), {
    sideBySide: false, listWidth: undefined, detailsWidth: undefined,
  });
});


