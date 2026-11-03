"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { beforeEach, afterEach, test } = require("node:test");
const Ajv = require("ajv");
const { readInstallState } = require("../dist/catalog/inventory/index.js");
const { CatalogError } = require("../dist/catalog/resources/index.js");
const { acquireOperationLock, OPERATION_LOCK } = require("../dist/catalog/operation.js");
const {
  CLI_DISCOVERY_SCHEMA_VERSION, CLI_REPORT_SCHEMA_VERSION,
} = require("../dist/cli/schema-versions.js");

const root = path.resolve(__dirname, "..");
const fixtureDirectory = path.join(__dirname, "fixtures");
const readFixture = (name) => JSON.parse(fs.readFileSync(path.join(fixtureDirectory, name), "utf8"));
const expectations = readFixture("cli-contract-v1.json");
const ajv = new Ajv({ allErrors: true, strict: true });
const schemaFiles = {
  "cli-report": `cli-report-v${CLI_REPORT_SCHEMA_VERSION}.schema.json`,
  "cli-discovery": `cli-discovery-v${CLI_DISCOVERY_SCHEMA_VERSION}.schema.json`,
};
const validators = Object.fromEntries(Object.entries(schemaFiles).map(([name, file]) => [
  name, ajv.compile(JSON.parse(fs.readFileSync(path.join(root, "schemas", file), "utf8"))),
]));
validators["catalog-lock"] = ajv.compile(JSON.parse(fs.readFileSync(
  path.join(root, "schemas/catalog-lock-v1.schema.json"), "utf8",
)));
let temporary;
let catalog;
let sourceData;
let target;
let home;

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function addAgent() {
  const manifestPath = path.join(catalog, "catalogs/catalog.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.resources.push({ ...manifest.resources[0], id: "contract-agent", kind: "agent" });
  writeJson(manifestPath, manifest);
  const source = path.join(catalog, "catalogs/fixture/agents/contract-agent.md");
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, "---\nname: contract-agent\ndescription: Contract fixture.\n---\n\nAgent body.\n");
  return source;
}

beforeEach(() => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-contract-"));
  catalog = path.join(temporary, "catalog");
  sourceData = path.join(temporary, "kitia-config", "source-catalogs");
  target = path.join(temporary, "target");
  home = path.join(temporary, "User profile");
  fs.mkdirSync(target);
  fs.mkdirSync(home);
  fs.cpSync(path.join(root, "dist"), path.join(catalog, "dist"), { recursive: true });
  fs.cpSync(path.join(root, "bin"), path.join(catalog, "bin"), { recursive: true });
  fs.mkdirSync(path.join(catalog, "catalogs"), { recursive: true });
  writeJson(path.join(catalog, "dist/catalog-build.json"), {
    catalog: "grasdouble/Kitia", commit: "a".repeat(40), package_version: "0.2.0", dirty: false,
  });
  writeJson(path.join(catalog, "catalogs/catalog.json"), {
    catalog_version: 2,
    resources: [{
      id: "contract-skill", kind: "skill", group: "fixture", description: "Contract fixture.",
      owner: "Contract fixtures", category: "testing", tags: ["contract"], status: "stable",
      use_when: "Exercise the public contract.", example: "Use the fixture.",
      expected_output: "A stable command result.", prerequisites: ["Synthetic repository."],
      limitations: ["Not a real resource."],
      compatibility: { claude: { status: "compatible" }, copilot: { status: "compatible" } },
    }],
  });
  const skill = path.join(catalog, "catalogs/fixture/skills/contract-skill/SKILL.md");
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.writeFileSync(skill, "---\nname: contract-skill\ndescription: Contract fixture.\n---\n\nSynthetic body.\n");
  writeJson(path.join(path.dirname(sourceData), "catalogSources.json"), {
    catalog_version: 1,
    sources: [{ name: "community", repository: "https://github.com/example/community-skills" }],
  });
  writeJson(path.join(sourceData, "catalogSources.json"), {
    catalog_version: 1,
    sources: [{ name: "community", repository: "https://github.com/example/community-skills" }],
  });
  writeJson(path.join(sourceData, "community.json"), {
    catalog_version: 1,
    catalog_name: "community",
    source_repository: "example/community-skills",
    source_ref: "b".repeat(40),
    resources: [{
      id: "upstream-skill", kind: "skill", description: "Upstream fixture.",
      source_path: "skills/upstream-skill", license_status: "not-declared",
    }],
  });
});

afterEach(() => fs.rmSync(temporary, { recursive: true, force: true }));

function run(args) {
  const result = spawnSync(process.execPath, [path.join(catalog, "bin/kitia.js"), ...args], {
    cwd: target, encoding: "utf8",
    env: { ...process.env, HOME: home, USERPROFILE: home,
      KITIA_CONFIG_DIR: path.dirname(sourceData),
      NODE_PATH: path.join(root, "node_modules"), PATH: "", NO_COLOR: "1" },
  });
  if (result.error) throw result.error;
  return result;
}

function validate(name, value) {
  assert.equal(validators[name](value), true, JSON.stringify(validators[name].errors, null, 2));
}

function report(args, exit = 0) {
  const result = run(args);
  assert.equal(result.status, exit, result.stderr + result.stdout);
  const parsed = JSON.parse(result.stdout);
  validate("cli-report", parsed);
  return parsed;
}

function sortKey(value) {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return [value.catalog, value.kind, value.id, value.path, value.action, value.code].join("|");
}

function assertCompatible(actual, expected) {
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual));
    assert.equal(actual.length, expected.length);
    const sorted = (values) => [...values].sort((left, right) => sortKey(left).localeCompare(sortKey(right)));
    sorted(expected).forEach((value, index) => assertCompatible(sorted(actual)[index], value));
  } else if (expected && typeof expected === "object") {
    assert.ok(actual && typeof actual === "object");
    for (const [key, value] of Object.entries(expected)) {
      assert.ok(Object.hasOwn(actual, key), `Missing contract field: ${key}`);
      assertCompatible(actual[key], value);
    }
  } else {
    assert.deepEqual(actual, expected);
  }
}

function snapshot(directory) {
  const result = {};
  function visit(current, relative = "") {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      const key = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) {
        result[`${key}/`] = "directory";
        visit(file, key);
      } else {
        result[key] = fs.readFileSync(file).toString("base64");
      }
    }
  }
  visit(directory);
  return result;
}

test("discovery keeps legacy arrays, source identity and metadata-free paths", () => {
  for (const args of [["list"], ["search", "fixture"]]) {
    const result = run([...args, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const data = JSON.parse(result.stdout);
    validate("cli-discovery", data);
    assertCompatible(data, expectations.discovery);
  }
  const empty = run(["search", "absent", "--json"]);
  assert.equal(empty.status, 0);
  assert.deepEqual(JSON.parse(empty.stdout), []);
  const community = JSON.parse(run(["list", "--catalog", "community", "--json"]).stdout);
  validate("cli-discovery", community);
  assert.ok(community.length > 0);
  assert.ok(community.every((entry) => entry.catalog === "community"));
  assert.equal(community[0].source_ref, "b".repeat(40));
  for (const args of [
    ["community", "search", "upstream"],
    ["community", "show", "upstream-skill"],
    ["community", "preview", "upstream-skill"],
    ["community", "install", "upstream-skill"],
    ["community", "uninstall", "upstream-skill"],
  ]) {
    assert.equal(run(args).status, 1, args.join(" "));
  }
});

test("current reports preserve defaults, attention codes and dry-run action shapes", () => {
  assertCompatible(report(["check", "--json"]), expectations.emptyCheck);
  for (const args of [["install", "contract-skill"], ["install", "skill", "contract-skill"]]) {
    const preview = report([...args, "--dry-run", "--json"]);
    assertCompatible(preview, expectations.installPreview);
    assert.deepEqual(fs.readdirSync(target), []);
  }
  assert.equal(run(["install", "contract-skill"]).status, 0);
  assert.equal(fs.existsSync(path.join(target, ".claude")), false);
  validate("catalog-lock", JSON.parse(fs.readFileSync(path.join(target, ".agents/kitia-lock.json"), "utf8")));
  assertCompatible(report(["check", "--json"]), expectations.currentCheck);
  assertCompatible(report(["uninstall", "contract-skill", "--dry-run", "--json"]), expectations.uninstallPreview);
  const installed = path.join(target, ".agents/skills/contract-skill/SKILL.md");
  fs.appendFileSync(installed, "\nLocal customization.\n");
  assertCompatible(report(["check", "--json"], 2), expectations.modifiedCheck);
  assert.equal(run(["check"]).status, 1);
  const before = snapshot(target);
  const conflict = report(["update", "--dry-run", "--json"], 1);
  assert.equal(conflict.errors[0].code, "LOCAL_CONFLICT");
  const forced = report(["update", "--dry-run", "--force", "--json"]);
  assert.ok(forced.actions.some((action) => action.action === "overwrite" && action.path.endsWith("/SKILL.md")));
  assert.deepEqual(snapshot(target), before);
  assertCompatible(report(["install", "contract-skill", "--json"], 1), expectations.invalidArguments);
  const invalidCascade = report(["install", "contract-skill", "--cascade", "--json"], 1);
  assert.equal(invalidCascade.errors[0].code, "INVALID_ARGUMENT");
});

test("community plans, diagnostics and partial discovery retain their public shapes", () => {
  const plan = report(["install", "skill", "upstream-skill", "--catalog", "community", "--dry-run", "--json"]);
  assert.equal(plan.command, "install");
  assert.deepEqual(plan.actions[0].command, {
    program: "gh", args: ["skill", "install", "example/community-skills", "skills/upstream-skill",
      "--agent", "github-copilot", "--scope", "project", "--pin", "b".repeat(40)],
  });
  const doctor = report(["doctor", "--json"], 2);
  assert.ok(doctor.checks.some((check) => check.id === "network" && check.status === "skipped"));
  fs.writeFileSync(path.join(sourceData, "community.json"), "invalid JSON");
  const partial = run(["list", "--json"]);
  assert.equal(partial.status, 1);
  validate("cli-discovery", JSON.parse(partial.stdout));
  const warning = JSON.parse(partial.stderr.trim());
  assert.equal(warning.code, "CATALOG_UNAVAILABLE");
  assert.equal(warning.catalog, "community");
  assert.deepEqual(fs.readdirSync(target), []);
});

test("user scope resolves a home with spaces and keeps project and personal lifecycles independent", () => {
  const install = ["install", "skill", "contract-skill"];
  const scoped = ["--scope", "user"];
  const preview = report([...install, ...scoped, "--tool", "both", "--dry-run", "--json"]);
  assert.equal(preview.scope, "user");
  assert.equal(preview.target, home);
  assert.deepEqual(preview.actions.filter((action) => action.path.endsWith("/SKILL.md"))
    .map((action) => action.path).sort(),
  [".agents/skills/contract-skill/SKILL.md", ".claude/skills/contract-skill/SKILL.md"]);
  assert.deepEqual(snapshot(home), {});
  assert.deepEqual(snapshot(target), {});

  assert.equal(run(install).status, 0);
  const projectBefore = snapshot(target);
  const installed = run([...install, ...scoped, "--tool", "both"]);
  assert.equal(installed.status, 0, installed.stderr);
  const inventory = JSON.parse(fs.readFileSync(path.join(home, ".agents/kitia-lock.json"), "utf8"));
  validate("catalog-lock", inventory);
  assert.equal(inventory.resources["skill:contract-skill"].tool, "both");
  assert.deepEqual(snapshot(target), projectBefore);
  assert.equal(report(["check", ...scoped, "--json"]).resources[0].status, "current");
  const personalBefore = snapshot(home);
  report(["update", ...scoped, "--dry-run", "--json"]);
  report(["uninstall", "contract-skill", ...scoped, "--dry-run", "--json"]);
  assert.deepEqual(snapshot(home), personalBefore);

  const skillFile = path.join(home, ".agents/skills/contract-skill/SKILL.md");
  const userFile = path.join(path.dirname(skillFile), "personal.txt");
  fs.writeFileSync(userFile, "Keep this file.");
  fs.appendFileSync(skillFile, "\nUser customization.\n");
  const changed = report(["check", ...scoped, "--json"], 2);
  assert.equal(changed.resources[0].issues[0].code, "LOCAL_MODIFICATIONS");
  const modifiedBefore = snapshot(home);
  assert.equal(run(["update", ...scoped]).status, 1);
  assert.equal(run(["uninstall", "contract-skill", ...scoped]).status, 1);
  assert.deepEqual(snapshot(home), modifiedBefore);
  assert.equal(run(["update", ...scoped, "--force"]).status, 0);
  assert.equal(readInstallState(home).resources["skill:contract-skill"].tool, "both");
  assert.equal(run(["uninstall", "contract-skill", ...scoped]).status, 0);
  assert.equal(fs.existsSync(path.dirname(skillFile)), false);
  const claudeSkillDirectory = path.join(home, ".claude/skills/contract-skill");
  assert.equal(fs.existsSync(claudeSkillDirectory), false);
  assert.equal(fs.existsSync(userFile), false);
  assert.deepEqual(snapshot(target), projectBefore);
});

test("scope validation rejects ambiguous targets, unsupported resources and unrelated commands without writes", () => {
  for (const args of [
    ["install", "contract-skill", "--scope", "global"],
    ["install", "contract-skill", "--scope"],
    ["install", "contract-skill", "--scope", "user", "--scope", "project"],
    ["install", "contract-skill", "--scope", "user", "--target", target],
    ["check", "--target", target, "--scope", "user"],
    ["doctor", "--scope", "user", "--target", target],
    ["install", "skill", "upstream-skill", "--catalog", "community", "--scope", "user", "--target", target],
    ["install", "instruction", "contract-skill", "--scope", "user"],
    ["update", "instruction", "contract-skill", "--scope", "user"],
    ["uninstall", "instruction", "contract-skill", "--scope", "user"],
    ["list", "--scope", "user"],
    ["show", "contract-skill", "--scope", "user"],
    ["preview", "contract-skill", "--scope", "user"],
  ]) {
    const failure = report([...args, "--json"], 1);
    assert.equal(failure.errors[0].code, "INVALID_ARGUMENT", args.join(" "));
    assert.deepEqual(snapshot(home), {});
    assert.deepEqual(snapshot(target), {});
  }
  const explicitProject = report(["install", "contract-skill", "--scope", "project",
    "--target", target, "--dry-run", "--json"]);
  assert.equal(explicitProject.target, target);
  assert.equal(explicitProject.scope, "project");
});

test("user-scope operations lock the home only and preserve unsupported inventories before delegation", () => {
  const release = acquireOperationLock(home);
  try {
    const failed = run(["install", "contract-skill", "--scope", "user", "--force"]);
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /Target operation is locked/);
    report(["install", "contract-skill", "--scope", "user", "--dry-run", "--json"]);
    assert.equal(run(["install", "contract-skill"]).status, 0);
    assert.deepEqual(fs.readdirSync(home), [OPERATION_LOCK]);
  } finally {
    release();
  }
  writeJson(path.join(home, ".agents/kitia-lock.json"), {
    lock_version: 2, catalog: "grasdouble/Kitia", resources: {},
  });
  const before = snapshot(home);
  for (const args of [
    ["install", "contract-skill"], ["update"], ["uninstall", "contract-skill"],
    ["install", "skill", "upstream-skill", "--catalog", "community"],
    ["uninstall", "skill", "upstream-skill", "--catalog", "community"],
  ]) {
    const result = run([...args, "--scope", "user", "--force"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /version 2 is not supported/);
    assert.deepEqual(snapshot(home), before);
  }
});

test("community plans pin explicit home destinations without invoking gh", () => {
  const plan = report([
    "install", "skill", "upstream-skill", "--catalog", "community",
    "--scope", "user", "--tool", "both", "--dry-run", "--json",
  ]);
  assert.equal(plan.scope, "user");
  assert.equal(plan.target, home);
  assert.equal(plan.actions.length, 2);
  for (const action of plan.actions) {
    const args = action.command.args;
    assert.equal(args[args.indexOf("--scope") + 1], "user");
    assert.equal(args[args.indexOf("--dir") + 1], path.join(home, path.dirname(path.dirname(action.path))));
    assert.equal(args[args.indexOf("--pin") + 1], "b".repeat(40));
    assert.equal(action.resource.catalog, "community");
  }
  assert.deepEqual(snapshot(home), {});
  assert.deepEqual(snapshot(target), {});
  const diagnostics = report(["doctor", "--scope", "user", "--json"], 2);
  assert.ok(diagnostics.checks.some((check) => check.id === "inventory" && check.status === "ok"));
  assert.deepEqual(snapshot(home), {});
});

test("user scope refuses destination symlinks escaping home before internal or community writes", () => {
  fs.symlinkSync(target, path.join(home, ".agents"), process.platform === "win32" ? "junction" : "dir");
  for (const args of [
    ["install", "contract-skill"],
    ["install", "skill", "upstream-skill", "--catalog", "community"],
  ]) {
    const result = run([...args, "--scope", "user", "--force"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /symlink escapes target/);
    assert.deepEqual(snapshot(target), {});
    assert.equal(fs.existsSync(path.join(home, OPERATION_LOCK)), false);
  }
});

test("user scope resolves untyped agents but leaves pre-existing project-style home agents untouched", () => {
  addAgent();
  const preview = report(["install", "contract-agent", "--scope", "user", "--dry-run", "--json"]);
  assert.equal(preview.resources[0].kind, "agent");
  assert.ok(preview.actions.some((action) => action.path === ".copilot/agents/contract-agent.agent.md" &&
    action.resource?.kind === "agent"));
  assert.deepEqual(snapshot(home), {});
  const agent = run(["install", "agent", "contract-agent", "--target", home, "--tool", "both"]);
  assert.equal(agent.status, 0, agent.stderr);
  const agentFile = path.join(home, ".github/agents/contract-agent.agent.md");
  const original = fs.readFileSync(agentFile, "utf8");
  const claudeAgentFile = path.join(home, ".claude/agents/contract-agent.md");
  const originalClaude = fs.readFileSync(claudeAgentFile, "utf8");
  assert.equal(run(["install", "contract-skill", "--scope", "user"]).status, 0);
  const checked = report(["check", "--scope", "user", "--json"]);
  assert.deepEqual(checked.resources.map((resource) => resource.kind), ["skill"]);
  const update = report(["update", "--scope", "user", "--dry-run", "--json"]);
  assert.deepEqual(update.resources.map((resource) => resource.kind), ["skill"]);
  assert.equal(run(["update", "--scope", "user"]).status, 0);
  assert.equal(run(["uninstall", "contract-agent", "--scope", "user"]).status, 1);
  const before = snapshot(home);
  const conflicting = run(["install", "contract-agent", "--scope", "user", "--force"]);
  assert.equal(conflicting.status, 1);
  assert.match(conflicting.stderr, /project-style installation/);
  assert.deepEqual(snapshot(home), before);
  assert.equal(fs.readFileSync(agentFile, "utf8"), original);
  assert.equal(fs.readFileSync(claudeAgentFile, "utf8"), originalClaude);
  assert.ok(readInstallState(home).resources["agent:contract-agent"]);
});

test("personal agents have portable per-runtime lifecycle and an independent project installation", () => {
  const source = addAgent();
  for (const tool of ["copilot", "claude", "both"]) {
    const projectBeforeInstall = snapshot(target);
    const install = ["install", "agent", "contract-agent", "--scope", "user", "--tool", tool];
    const expectedPaths = [
      ...(tool !== "claude" ? [".copilot/agents/contract-agent.agent.md"] : []),
      ...(tool !== "copilot" ? [".claude/agents/contract-agent.md"] : []),
    ].sort();
    const before = snapshot(home);
    const preview = report([...install, "--dry-run", "--json"]);
    assert.deepEqual(preview.actions.filter((action) => action.resource?.kind === "agent")
      .map((action) => action.path).sort(), expectedPaths);
    assert.deepEqual(snapshot(home), before);
    const installed = run(install);
    assert.equal(installed.status, 0, installed.stderr);
    let inventory = readInstallState(home);
    validate("catalog-lock", inventory);
    assert.equal(inventory.lock_version, 1);
    assert.deepEqual(Object.keys(inventory.resources["agent:contract-agent"].files).sort(), expectedPaths);
    assert.equal(fs.existsSync(path.join(home, ".github")), false);
    assert.deepEqual(snapshot(target), projectBeforeInstall);
    const project = run(["install", "agent", "contract-agent"]);
    assert.equal(project.status, 0, project.stderr);
    const projectBefore = snapshot(target);
    const clean = report(["check", "--scope", "user", "--json"]);
    assert.equal(clean.resources.find((entry) => entry.kind === "agent").status, "current");

    const agentFile = path.join(home, ...expectedPaths[0].split("/"));
    fs.appendFileSync(agentFile, "\nLocal edit.\n");
    const changed = report(["check", "--scope", "user", "--json"], 2);
    assert.ok(changed.resources[0].issues.some((issue) => issue.code === "LOCAL_MODIFICATIONS"));
    const customized = snapshot(home);
    assert.equal(run(["update", "contract-agent", "--scope", "user"]).status, 1);
    assert.equal(run(["uninstall", "contract-agent", "--scope", "user"]).status, 1);
    assert.deepEqual(snapshot(home), customized);
    report(["update", "--scope", "user", "--force", "--dry-run", "--json"]);
    assert.deepEqual(snapshot(home), customized);
    assert.equal(run(["update", "--scope", "user", "--force"]).status, 0);

    fs.appendFileSync(source, "\nCatalog change.\n");
    const stale = report(["check", "--scope", "user", "--json"], 2);
    assert.ok(stale.resources[0].issues.some((issue) => issue.code === "UPDATE_AVAILABLE"));
    assert.equal(run(["update", "agent", "contract-agent", "--scope", "user"]).status, 0);
    assert.equal(readInstallState(home).resources["agent:contract-agent"].tool, tool);
    fs.unlinkSync(agentFile);
    const missing = report(["check", "--scope", "user", "--json"], 2);
    assert.ok(missing.resources[0].issues.some((issue) => issue.code === "MISSING_FILES"));
    assert.equal(run(["update", "--scope", "user"]).status, 0);
    const repaired = snapshot(home);
    report(["uninstall", "agent", "contract-agent", "--scope", "user", "--dry-run", "--json"]);
    assert.deepEqual(snapshot(home), repaired);
    const sibling = path.join(path.dirname(agentFile), "my-custom-agent.md");
    fs.writeFileSync(sibling, "---\nname: my-custom-agent\ndescription: Mine.\n---\n\nKeep this.\n");
    assert.equal(run(["uninstall", "contract-agent", "--scope", "user"]).status, 0);
    assert.equal(fs.readFileSync(sibling, "utf8").includes("Keep this."), true);
    for (const relativePath of expectedPaths) assert.equal(fs.existsSync(path.join(home, relativePath)), false);
    inventory = readInstallState(home);
    assert.deepEqual(inventory.resources, {});
    assert.equal(inventory.lock_version, 1);
    assert.deepEqual(snapshot(target), projectBefore);
  }
});

test("personal agent conflicts, symlinks and operation locks fail before writes", () => {
  addAgent();
  const install = ["install", "agent", "contract-agent", "--scope", "user", "--tool", "both"];
  assert.equal(run(["install", "contract-skill", "--scope", "user"]).status, 0);
  const personal = path.join(home, ".copilot/agents/contract-agent.agent.md");
  fs.mkdirSync(path.dirname(personal), { recursive: true });
  fs.writeFileSync(personal, "Unmanaged agent.\n");
  const before = snapshot(home);
  assert.equal(run(install).status, 1);
  assert.deepEqual(snapshot(home), before);
  assert.equal(readInstallState(home).lock_version, 1);
  assert.equal(run([...install, "--force"]).status, 0);
  assert.equal(readInstallState(home).lock_version, 1);
  assert.equal(run(["uninstall", "contract-agent", "--scope", "user"]).status, 0);
  const alternate = path.join(home, ".copilot/agents/contract-agent.md");
  fs.writeFileSync(alternate, "Alternate unmanaged agent.\n");
  const alternateBefore = snapshot(home);
  assert.equal(run([...install, "--force"]).status, 1);
  assert.deepEqual(snapshot(home), alternateBefore);
  fs.unlinkSync(alternate);
  const release = acquireOperationLock(home);
  try {
    assert.equal(run([...install, "--force"]).status, 1);
    report([...install, "--dry-run", "--json"]);
    assert.equal(fs.existsSync(personal), false);
  } finally {
    release();
  }
  fs.rmdirSync(path.dirname(personal));
  fs.symlinkSync(target, path.dirname(personal), process.platform === "win32" ? "junction" : "dir");
  const failed = run([...install, "--force"]);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /symlink escapes target/);
  assert.equal(fs.existsSync(path.join(home, ".kitia-operation.lock")), false);
  assert.deepEqual(snapshot(target), {});
});

test("version-1 inventories support personal agent ownership without rewriting on reads", () => {
  const original = readFixture("inventory-v1-with-user-agent.json");
  writeJson(path.join(home, ".agents/kitia-lock.json"), original);
  const inventory = readInstallState(home);
  assert.equal(inventory.lock_version, 1);
  validate("catalog-lock", inventory);
  const before = snapshot(home);
  assert.deepEqual(readInstallState(home), inventory);
  report(["check", "--scope", "user", "--json"], 2);
  assert.deepEqual(snapshot(home), before);
  const invalidPaths = [
    ".copilot/agents/other.agent.md", ".copilot/skills/user-agent/SKILL.md",
    ".copilot" + String.fromCharCode(92) + "agents" + String.fromCharCode(92) + "user-agent.agent.md",
  ];
  for (const relativePath of invalidPaths) {
    const invalid = structuredClone(inventory);
    invalid.resources["agent:user-agent"].files = {
      [relativePath]: original.resources["agent:user-agent"].files[".copilot/agents/user-agent.agent.md"],
    };
    writeJson(path.join(home, ".agents/kitia-lock.json"), invalid);
    const snapshotBefore = snapshot(home);
    assert.throws(() => readInstallState(home), /Invalid installation state/);
    assert.deepEqual(snapshot(home), snapshotBefore);
  }
});

test("schemas allow additive fields and extensible identities, but reject breaking shapes", () => {
  const valid = report(["check", "--json"]);
  validate("cli-report", { ...valid, extra_advisory_field: true, resources: [{
    catalog: "future-catalog", kind: "future-kind", id: "sample", status: "current", extra: {},
  }] });
  for (const invalid of [
    { ...valid, schema_version: CLI_REPORT_SCHEMA_VERSION + 1 }, { ...valid, resources: {} }, { ...valid, dry_run: "false" },
    { ...valid, status: "success" }, { ...valid, actions: [{ action: "install", path: "file" }] },
    { ...valid, actions: [{ action: "delegate_install", path: "file", resource: null }] },
  ]) {
    assert.equal(validators["cli-report"](invalid), false);
  }
  const missing = { ...valid };
  delete missing.errors;
  assert.equal(validators["cli-report"](missing), false);
  assert.equal(validators["cli-discovery"]({ resources: [] }), false);
  assert.equal(validators["cli-discovery"]([{ id: "sample", kind: "skill", description: "Example.", source: "/machine/path" }]), false);
});

test("inventory schemas group source records by catalog and resource collection", () => {
  const sourceRecord = {
    source_repository: "example/community-skills",
    source_path: "skills/sample-skill",
    source_ref: "a".repeat(40),
    files: {
      ".agents/skills/sample-skill/SKILL.md": {
        sha256: "b".repeat(64),
        executable: false,
      },
    },
  };
  const base = {
    catalog: "grasdouble/Kitia",
    resources: {},
    sources: { community: { skills: { "sample-skill": sourceRecord } } },
    bundles: {},
    mcps: {},
  };
  assert.equal(validators["catalog-lock"]({ lock_version: 1, ...base }), true);
  assert.equal(validators["catalog-lock"]({
    lock_version: 1, ...base, community_skills: {},
  }), false);
});

test("future inventory versions and unsupported resource shapes refuse mutations", () => {
  const original = {
    lock_version: 1,
    catalog: "grasdouble/Kitia",
    resources: {},
    sources: {},
    bundles: {},
    mcps: {},
  };
  const installed = path.join(target, ".agents/skills/legacy-skill/SKILL.md");
  fs.mkdirSync(path.dirname(installed), { recursive: true });
  fs.writeFileSync(installed, "Legacy skill.");
  const unknownKind = structuredClone(original);
  unknownKind.resources["future-kind:future-resource"] = { standalone: true };
  for (const [inventory, code, message] of [
    [{ ...original, lock_version: 2 }, "UNSUPPORTED_INVENTORY_VERSION", /compatible CLI version/],
    [unknownKind, "UNSUPPORTED_RESOURCE_KIND", /compatible CLI version/],
  ]) {
    writeJson(path.join(target, ".agents/kitia-lock.json"), inventory);
    fs.writeFileSync(path.join(target, "user-file.txt"), "Preserve user content.");
    const before = snapshot(target);
    const checked = report(["check", "--json"], 1);
    assert.equal(checked.errors[0].code, code);
    assert.match(checked.errors[0].message, message);
    assert.doesNotMatch(checked.errors[0].message, /Invalid installation state|restore it from version control/);
    for (const args of [
      ["install", "contract-skill"],
      ["update"],
      ["uninstall", "legacy-skill"],
      ["install", "skill", "upstream-skill", "--catalog", "community"],
    ]) {
      const result = run([...args, "--force"]);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, message);
      assert.deepEqual(snapshot(target), before);
    }
  }
});

test("malformed current inventories remain errors, not supported-format migrations", () => {
  const original = {
    lock_version: 1,
    catalog: "grasdouble/Kitia",
    resources: {},
    sources: {},
    bundles: {},
    mcps: {},
  };
  for (const invalid of [{ ...original, lock_version: "1" }, { ...original, resources: [] }]) {
    writeJson(path.join(target, ".agents/kitia-lock.json"), invalid);
    const before = snapshot(target);
    assert.throws(() => readInstallState(target), /Invalid installation state/);
    assert.deepEqual(snapshot(target), before);
  }
});

test("malformed source inventory records fail with controlled invalid installation errors", () => {
  for (const record of [null, 7]) {
    writeJson(path.join(target, ".agents/kitia-lock.json"), {
      lock_version: 1,
      catalog: "grasdouble/Kitia",
      resources: {},
      sources: { community: { skills: { "upstream-skill": record } } },
      bundles: {},
      mcps: {},
    });
    assert.throws(() => readInstallState(target), (error) => {
      assert.ok(error instanceof CatalogError);
      assert.match(error.message, /Invalid installation state/);
      return true;
    });
  }
});

test("validation and discovery ignore repository manifests and inspect user catalogs only", () => {
  const sourceIndex = path.join(sourceData, "community.json");
  const originalSource = fs.readFileSync(sourceIndex, "utf8");
  const data = JSON.parse(originalSource);
  data.catalog_version = 2;
  writeJson(sourceIndex, data);
  const before = fs.readFileSync(sourceIndex, "utf8");
  const validation = run(["validate"]);
  assert.equal(validation.status, 1);
  assert.match(validation.stderr, /not supported by this CLI/);
  const unavailable = run(["list", "--catalog", "community", "--json"]);
  assert.equal(unavailable.status, 1);
  assert.deepEqual(JSON.parse(unavailable.stdout), []);
  assert.equal(JSON.parse(unavailable.stderr.trim()).code, "UNSUPPORTED_CATALOG_VERSION");
  assert.equal(fs.readFileSync(sourceIndex, "utf8"), before);
  fs.writeFileSync(sourceIndex, originalSource);

  const repositoryManifest = path.join(catalog, "catalogs/catalog.json");
  writeJson(repositoryManifest, { catalog_version: 3, resources: [] });
  const localValidation = run(["validate"]);
  assert.equal(localValidation.status, 0, localValidation.stderr);
  assert.match(localValidation.stdout, /Validated 1 resources across configured user catalogs/);
  const discovery = run(["list", "--json"]);
  assert.equal(discovery.status, 0, discovery.stderr);
  const resources = JSON.parse(discovery.stdout);
  assert.ok(resources.length > 0);
  assert.ok(resources.every((resource) => resource.catalog === "community"));
});
