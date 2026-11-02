"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { afterEach, beforeEach, test } = require("node:test");
const { acquireOperationLock, inspectOperationLock, OPERATION_LOCK } = require("../dist/catalog/operation.js");
const { runGhSkill } = require("../dist/catalog/sources/skills.js");
const { CLI_REPORT_SCHEMA_VERSION } = require("../dist/cli/schema-versions.js");

const root = path.resolve(__dirname, "..");
const cli = path.join(root, "dist/cli/main.js");
let temporary;
let fixture;
let target;

beforeEach(() => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-technical-"));
  fixture = path.join(temporary, "catalog");
  target = path.join(temporary, "target");
  fs.mkdirSync(path.join(fixture, "dist"), { recursive: true });
  fs.mkdirSync(target);
  fs.cpSync(path.join(root, "catalogs"), path.join(fixture, "catalogs"), { recursive: true });
  fs.mkdirSync(path.join(fixture, "skills/create-readme"), { recursive: true });
  fs.writeFileSync(path.join(fixture, "skills/create-readme/SKILL.md"), [
    "---",
    "name: create-readme",
    "description: Synthetic README skill.",
    "---",
    "",
    "Test fixture body.",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(fixture, "catalogs/catalog.json"), JSON.stringify({
    catalog_version: 2,
    resources: [{
      id: "create-readme",
      kind: "skill",
      owner: "Test fixtures",
      category: "documentation",
      tags: ["test"],
      status: "stable",
      compatibility: { claude: { status: "compatible" }, copilot: { status: "compatible" } },
      use_when: "Testing source installation lifecycle.",
      example: "Install the fixture skill.",
      expected_output: "A managed skill file.",
      prerequisites: ["A temporary target."],
      limitations: ["Synthetic test content."],
      group: "general",
      description: "Synthetic README skill.",
    }],
  }, null, 2));
  fs.writeFileSync(path.join(fixture, "dist/catalog-build.json"), JSON.stringify({
    catalog: "grasdouble/Kitia", commit: "a".repeat(40), package_version: "test", dirty: false,
  }));
});

afterEach(() => fs.rmSync(temporary, { recursive: true, force: true }));

function run(args, expectedStatus) {
  const result = spawnSync(process.execPath, [
    "-e",
    `require(${JSON.stringify(cli)}).main(JSON.parse(process.argv[1]), process.argv[2]).then(code => { process.exitCode = code; });`,
    JSON.stringify(args),
    fixture,
  ], { encoding: "utf8", cwd: fixture, env: {
    ...process.env, HOME: temporary, USERPROFILE: temporary,
    KITIA_CONFIG_DIR: path.join(temporary, "kitia-config"), KITIA_SOURCE_CATALOGS: "", NO_COLOR: "1",
  } });
  if (result.error) throw result.error;
  if (expectedStatus !== undefined) {
    assert.equal(result.status, expectedStatus, result.stderr + result.stdout);
  }
  return result;
}
test("bare CLI invocation defaults to dashboard while explicit help stays help", () => {
  const result = run([], 0);
  assert.match(result.stdout, /No catalog-managed resources found in project or user scope\./);
  assert.doesNotMatch(result.stdout, /Usage:/);

  const help = run(["--help"], 0);
  assert.match(help.stdout, /Kitia \[dashboard\].*default command/);
});

test("JSON installation previews are structured and strictly read-only", () => {
  const result = run([
    "install", "skill", "create-readme", "--catalog", "internal", "--target", target,
    "--dry-run", "--json",
  ], 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schema_version, CLI_REPORT_SCHEMA_VERSION);
  assert.equal(report.command, "install");
  assert.equal(report.status, "ok");
  assert.equal(report.dry_run, true);
  assert.deepEqual(report.resources, [
    { catalog: "internal", kind: "skill", id: "create-readme", status: "planned" },
  ]);
  assert.ok(report.actions.some((action) => action.path === ".agents/skills/create-readme/SKILL.md"));
  assert.deepEqual(fs.readdirSync(target), []);
});

test("checks report local modifications without changing human-readable exit behavior", () => {
  run(["install", "create-readme", "--catalog", "internal", "--target", target], 0);
  const installed = path.join(target, ".agents/skills/create-readme/SKILL.md");
  const clean = run(["check", "--catalog", "internal", "--target", target, "--json"], 0);
  assert.equal(JSON.parse(clean.stdout).resources[0].status, "current");

  fs.appendFileSync(installed, "\nLocal customization.\n");
  const changed = run(["check", "--catalog", "internal", "--target", target, "--json"], 2);
  assert.equal(JSON.parse(changed.stdout).status, "attention");
  assert.equal(JSON.parse(changed.stdout).resources[0].issues[0].code, "LOCAL_MODIFICATIONS");
  run(["check", "--catalog", "internal", "--target", target], 1);

  const preview = run([
    "update", "--catalog", "internal", "--target", target, "--dry-run", "--json",
  ], 1);
  assert.equal(JSON.parse(preview.stdout).errors[0].code, "LOCAL_CONFLICT");
});

test("target operation locks prevent concurrent lifecycle mutations", () => {
  const release = acquireOperationLock(target);
  try {
    assert.equal(inspectOperationLock(target).status, "active");
    const result = run([
      "install", "create-readme", "--catalog", "internal", "--target", target, "--force",
    ], 1);
    assert.match(result.stderr, /Target operation is locked/);
    assert.deepEqual(fs.readdirSync(target), [OPERATION_LOCK]);
  } finally {
    release();
  }
  assert.equal(inspectOperationLock(target).status, "absent");
});

test("delegated GitHub CLI calls are non-interactive and preserve command arguments", () => {
  let invocation;
  const status = runGhSkill(
    ["skill", "preview", "example/repository", "skills/demo@abc"],
    target,
    (program, args, options) => {
      invocation = { program, args, options };
      return { status: 0 };
    },
    { nonInteractive: true },
  );
  assert.equal(status, 0);
  assert.equal(invocation.program, "gh");
  assert.deepEqual(invocation.args, ["skill", "preview", "example/repository", "skills/demo@abc"]);
  assert.equal(invocation.options.env.GH_PROMPT_DISABLED, "1");
});
