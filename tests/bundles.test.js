"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, test } = require("node:test");

const root = path.resolve(__dirname, "..");
const cli = path.join(root, "dist/cli/main.js");
let temporary;
let catalog;
let target;
let home;

const common = {
  owner: "Test maintainers",
  category: "testing",
  tags: ["synthetic", "test"],
  status: "experimental",
  compatibility: {
    claude: { status: "compatible" },
    copilot: { status: "compatible" },
  },
  use_when: "Testing safe bundle setup.",
  example: "Install the synthetic bundle.",
  expected_output: "The declared test resources are configured.",
  prerequisites: ["A temporary test directory."],
  limitations: ["Synthetic test data only."],
};

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

beforeEach(() => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-bundle-test-"));
  catalog = path.join(temporary, "catalog");
  target = path.join(temporary, "target");
  home = path.join(temporary, "home");
  fs.mkdirSync(path.join(catalog, "catalogs/test/skills/demo-skill"), { recursive: true });
  fs.mkdirSync(target);
  fs.mkdirSync(home);

  fs.writeFileSync(path.join(catalog, "catalogs/test/skills/demo-skill/SKILL.md"),
    "---\nname: demo-skill\ndescription: A synthetic skill for bundle tests.\n---\n\nRun a test workflow.\n");
  const skill = {
    id: "demo-skill",
    kind: "skill",
    group: "test",
    description: "A synthetic skill for bundle tests.",
    ...common,
  };
  writeJson(path.join(catalog, "catalogs/test/skills/demo-skill/catalog.json"), common);

  const mcp = {
    id: "demo-mcp",
    kind: "mcp",
    group: "test",
    description: "A synthetic MCP server for bundle tests.",
    ...common,
    url: "https://example.com/mcp",
    access: "Test endpoint only.",
    data_policy: "No real data is sent.",
    last_reviewed: "2026-10-01",
    mcp_config: {
      mcpServers: {
        "demo-server": {
          command: process.execPath,
          args: ["-e", "process.stdout.write('ready')"],
          env: { DEMO_TOKEN: "${DEMO_TOKEN}", DEMO_ENDPOINT: "${DEMO_ENDPOINT}" },
        },
      },
    },
    inputs: {
      token: { type: "string", required: true, secret: true, target_env: "DEMO_TOKEN" },
      endpoint: { type: "url", required: true, default: "https://api.example.com/mcp", target_env: "DEMO_ENDPOINT" },
    },
  };
  writeJson(path.join(catalog, "catalogs/test/mcps/demo-mcp.json"), Object.fromEntries(
    Object.entries(mcp).filter(([key]) => !["id", "kind", "group"].includes(key)),
  ));

  const bundle = {
    id: "demo-bundle",
    kind: "bundle",
    group: "test",
    description: "A synthetic bundle for lifecycle tests.",
    ...common,
    resources: [
      { catalog: "internal", kind: "skill", id: "demo-skill" },
      { catalog: "internal", kind: "mcp", id: "demo-mcp" },
    ],
  };
  writeJson(path.join(catalog, "catalogs/test/bundles/demo-bundle.json"), Object.fromEntries(
    Object.entries(bundle).filter(([key]) => !["id", "kind", "group"].includes(key)),
  ));

  writeJson(path.join(catalog, "catalogs/catalogSources.json"), { catalog_version: 1, sources: [] });
  writeJson(path.join(catalog, "catalogs/catalog.json"), {
    catalog_version: 2,
    resources: [skill, mcp, bundle],
  });
  writeJson(path.join(catalog, "dist/catalog-build.json"), {
    catalog: "grasdouble/Kitia",
    commit: "a".repeat(40),
    package_version: "test",
    dirty: false,
  });
});

afterEach(() => fs.rmSync(temporary, { recursive: true, force: true }));

function run(args, expectedStatus = 0, env = {}) {
  const result = spawnSync(process.execPath, [
    "-e",
    `require(${JSON.stringify(cli)}).main(JSON.parse(process.argv[1]), process.argv[2]).then(code => { process.exitCode = code; });`,
    JSON.stringify(args),
    catalog,
  ], {
    cwd: target,
    encoding: "utf8",
    env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: "1", ...env },
  });
  if (result.error) throw result.error;
  assert.equal(result.status, expectedStatus, `${result.stdout}\n${result.stderr}`);
  return result;
}

test("bundle dry-run is read-only and reports MCP configuration actions", () => {
  const result = run([
    "install", "bundle", "demo-bundle", "--target", target, "--dry-run", "--json",
  ]);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.status, "ok");
  assert.equal(plan.dry_run, true);
  assert.ok(plan.resources.some((resource) => resource.kind === "mcp" && resource.id === "demo-mcp"));
  assert.ok(plan.actions.some((action) => action.path === ".mcp.json"));
  assert.ok(plan.actions.some((action) => action.path === ".agents/skills/demo-skill/SKILL.md"));
  assert.deepEqual(fs.readdirSync(target), []);
});

test("bundle install tracks ownership, protects secrets, and retains promoted MCPs", () => {
  run([
    "install", "bundle", "demo-bundle", "--target", target, "--yes",
    "--input", "demo-mcp.endpoint=https://api.example.com/custom",
  ], 0, { DEMO_TOKEN: "synthetic-secret" });
  const lockPath = path.join(target, ".agents/kitia-lock.json");
  const installed = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  assert.equal(installed.bundles["demo-bundle"].scope, "project");
  assert.equal(installed.resources["skill:demo-skill"].standalone, false);
  assert.equal(installed.mcps["demo-mcp"].standalone, false);
  assert.equal(JSON.stringify(installed).includes("synthetic-secret"), false);
  assert.equal(fs.readFileSync(path.join(target, ".mcp.json"), "utf8").includes("synthetic-secret"), false);

  const cascadePlan = run([
    "uninstall", "mcp", "demo-mcp", "--target", target, "--dry-run", "--json",
  ]);
  assert.ok(JSON.parse(cascadePlan.stdout).messages.some((message) =>
    message.includes("Cascade uninstall") && message.includes("demo-bundle")));
  run(["uninstall", "mcp", "demo-mcp", "--target", target, "--non-interactive"], 1);
  run([
    "install", "mcp", "demo-mcp", "--target", target, "--yes",
  ], 0, { DEMO_TOKEN: "synthetic-secret" });
  const promoted = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  assert.equal(promoted.mcps["demo-mcp"].standalone, true);

  run(["uninstall", "bundle", "demo-bundle", "--target", target, "--non-interactive"]);
  const remaining = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  assert.equal(remaining.bundles["demo-bundle"], undefined);
  assert.equal(remaining.resources["skill:demo-skill"], undefined);
  assert.equal(remaining.mcps["demo-mcp"].standalone, true);
  assert.ok(fs.existsSync(path.join(target, ".mcp.json")));
  assert.equal(fs.existsSync(path.join(target, ".agents/skills/demo-skill/SKILL.md")), false);
});

test("pre-existing MCP entries are not overwritten by bundle installation", () => {
  fs.mkdirSync(path.join(target, ".agents"), { recursive: true });
  fs.writeFileSync(path.join(target, ".mcp.json"), JSON.stringify({
    mcpServers: { "demo-server": { command: "user-owned", args: [] } },
  }));
  run(["install", "bundle", "demo-bundle", "--target", target, "--yes"]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, ".mcp.json"), "utf8"))
    .mcpServers["demo-server"].command, "user-owned");
  assert.equal(fs.existsSync(path.join(target, ".agents/skills/demo-skill/SKILL.md")), true);
  assert.ok(JSON.parse(fs.readFileSync(path.join(target, ".agents/kitia-lock.json"), "utf8"))
    .bundles["demo-bundle"]);
});

test("project and user lifecycles preserve another catalog's inventory, launchers and MCP entries", () => {
  for (const [scope, directory] of [["project", target], ["user", home]]) {
    const inventoryFile = path.join(directory, ".agents/other-lock.json");
    const launcherFile = path.join(directory, ".agents/other-mcp/demo-mcp.cjs");
    const otherSkill = path.join(directory, ".agents/skills/another-skill/SKILL.md");
    fs.mkdirSync(path.dirname(launcherFile), { recursive: true });
    fs.mkdirSync(path.dirname(otherSkill), { recursive: true });
    const foreignInventory = Buffer.from('{"catalog":"example/another-catalog","lock_version":999}\n');
    const foreignLauncher = Buffer.from("process.stdout.write('another catalog');\n");
    const foreignSkill = Buffer.from("---\nname: another-skill\ndescription: A different resource.\n---\n");
    fs.writeFileSync(inventoryFile, foreignInventory);
    fs.writeFileSync(launcherFile, foreignLauncher);
    fs.writeFileSync(otherSkill, foreignSkill);
    const clientPaths = scope === "project"
      ? [".mcp.json", ".copilot/mcp-config.json"]
      : [".claude.json", ".copilot/mcp-config.json"];
    const preExisting = {
      setting: "preserved",
      mcpServers: {
        "demo-server": { command: "another-catalog-launcher", args: [launcherFile] },
        "another-server": { command: "user-owned", args: [] },
      },
    };
    for (const clientPath of clientPaths) writeJson(path.join(directory, clientPath), preExisting);
    const scopeArgs = scope === "project" ? ["--target", directory] : ["--scope", "user"];
    const args = ["bundle", "demo-bundle", ...scopeArgs];
    const preview = JSON.parse(run(["install", ...args, "--tool", "both", "--dry-run", "--json"]).stdout);
    assert.ok(preview.actions.some(({ path: file }) => file === ".agents/kitia-lock.json"));
    assert.ok(preview.actions.every(({ path: file }) => file !== ".agents/other-lock.json" &&
      !file?.startsWith(".agents/other-mcp/")));
    assert.equal(fs.existsSync(path.join(directory, ".agents/kitia-lock.json")), false);

    run(["install", ...args, "--tool", "both", "--yes"]);
    const inventory = JSON.parse(fs.readFileSync(path.join(directory, ".agents/kitia-lock.json"), "utf8"));
    for (const config of Object.values(inventory.mcps["demo-mcp"].configurations)) {
      assert.equal(config.managed, false);
    }
    assert.equal(fs.existsSync(path.join(directory, ".agents/kitia-mcp")), false);
    run(["check", ...scopeArgs, "--catalog", "internal", "--json"]);
    run(["update", ...scopeArgs, "--catalog", "internal", "--yes"]);
    run(["uninstall", ...args, "--non-interactive"]);

    assert.deepEqual(fs.readFileSync(inventoryFile), foreignInventory);
    assert.deepEqual(fs.readFileSync(launcherFile), foreignLauncher);
    assert.deepEqual(fs.readFileSync(otherSkill), foreignSkill);
    for (const clientPath of clientPaths) {
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, clientPath), "utf8")), preExisting);
    }
    assert.equal(fs.existsSync(path.join(directory, ".agents/skills/demo-skill/SKILL.md")), false);
  }
});

test("historical MCP launcher paths are confined to this catalog's directory", () => {
  const { readInstallState, resourceOwnsPath } = require("../dist/catalog/inventory/index.js");
  const { LOCK_PATH, MCP_DIRECTORY } = require("../dist/catalog/resources/index.js");
  const { installedFingerprint } = require("../dist/catalog/inventory/files.js");
  assert.equal(LOCK_PATH, ".agents/kitia-lock.json");
  assert.equal(MCP_DIRECTORY, ".agents/kitia-mcp");
  assert.equal(resourceOwnsPath("mcp:demo-mcp", `${MCP_DIRECTORY}/demo-mcp.cjs`), true);
  assert.equal(resourceOwnsPath("mcp:demo-mcp", ".agents/other-mcp/demo-mcp.cjs"), false);
  run(["install", "mcp", "demo-mcp", "--target", target, "--yes"]);
  const inventoryFile = path.join(target, LOCK_PATH);
  const inventory = JSON.parse(fs.readFileSync(inventoryFile, "utf8"));
  const launcher = `${MCP_DIRECTORY}/demo-mcp.cjs`;
  fs.mkdirSync(path.dirname(path.join(target, launcher)), { recursive: true });
  fs.writeFileSync(path.join(target, launcher), "process.stdout.write('legacy');\n");
  inventory.mcps["demo-mcp"].files[launcher] = installedFingerprint(target, launcher);
  writeJson(inventoryFile, inventory);
  assert.deepEqual(Object.keys(readInstallState(target).mcps["demo-mcp"].files), [launcher]);
  inventory.mcps["demo-mcp"].files[".agents/other-mcp/demo-mcp.cjs"] =
    inventory.mcps["demo-mcp"].files[launcher];
  writeJson(inventoryFile, inventory);
  assert.throws(() => readInstallState(target), /Invalid installation state/);
  const original = fs.readFileSync(inventoryFile);
  run(["uninstall", "mcp", "demo-mcp", "--target", target, "--force"], 1);
  assert.deepEqual(fs.readFileSync(inventoryFile), original);
  assert.equal(fs.existsSync(path.join(target, launcher)), true);
  delete inventory.mcps["demo-mcp"].files[".agents/other-mcp/demo-mcp.cjs"];
  writeJson(inventoryFile, inventory);
  const genericLauncher = path.join(target, ".agents/other-mcp/demo-mcp.cjs");
  fs.mkdirSync(path.dirname(genericLauncher), { recursive: true });
  fs.writeFileSync(genericLauncher, "Another catalog's launcher.\n");
  run(["update", "mcp", "demo-mcp", "--target", target, "--yes"]);
  assert.equal(fs.existsSync(path.join(target, launcher)), false);
  assert.equal(fs.readFileSync(genericLauncher, "utf8"), "Another catalog's launcher.\n");
  assert.deepEqual(readInstallState(target).mcps["demo-mcp"].files, {});
});
