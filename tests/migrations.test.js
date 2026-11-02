 "use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const Ajv = require("ajv");
const {
  CURRENT_VERSION, applyMigrationChain, installationTargets, migrateInstallations,
  migrateInventory, migrateTarget, parseArguments,
} = require("../migrations/run.js");
const root = path.resolve(__dirname, "..");
const schema = JSON.parse(fs.readFileSync(path.join(root, "schemas/catalog-lock-v1.schema.json"), "utf8"));
const validateSchema = new Ajv({ allErrors: true, strict: true }).compile(schema);
const fixturePath = path.join(__dirname, "fixtures", "inventory-v1-with-user-agent.json");
let temporary;

afterEach(() => {
  if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
  temporary = null;
});

function createTarget(inventory) {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kiti-inventory-migration-"));
  const target = path.join(temporary, "target");
  const metadata = path.join(target, ".agents");
  fs.mkdirSync(metadata, { recursive: true });
  const inventoryPath = path.join(metadata, "kiti-lock.json");
  fs.writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
  return { target, inventoryPath };
}

test("the sole inventory schema is the current version 1 format", () => {
  const inventory = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  assert.equal(CURRENT_VERSION, 1);
  assert.equal(schema.properties.lock_version.const, CURRENT_VERSION);
  assert.equal(validateSchema(inventory), true, JSON.stringify(validateSchema.errors));
  assert.equal(inventory.catalog, "grasdouble/Kiti");
});

test("the future migration chain applies only consecutive pure transformations", () => {
  const original = { lock_version: 1, values: ["kept"] };
  const migrations = new Map([
    [1, (inventory) => ({ ...inventory, lock_version: 2, values: [...inventory.values, "v2"] })],
    [2, (inventory) => ({ ...inventory, lock_version: 3, values: [...inventory.values, "v3"] })],
  ]);
  const result = applyMigrationChain(original, 3, migrations);

  assert.deepEqual(result, {
    inventory: { lock_version: 3, values: ["kept", "v2", "v3"] },
    migrations: ["1-to-2", "2-to-3"],
  });
  assert.deepEqual(original, { lock_version: 1, values: ["kept"] });
  assert.throws(() => applyMigrationChain(original, 3, new Map()), /No migration path/);
  assert.throws(() => applyMigrationChain(original, 3, new Map([
    [1, (inventory) => ({ ...inventory, lock_version: 3 })],
  ])), /returned an invalid version/);
});

test("current inventories are validated and skipped without rewriting or backup", () => {
  const original = fs.readFileSync(fixturePath);
  const inventory = JSON.parse(original.toString("utf8"));
  const current = migrateInventory(inventory);
  assert.deepEqual(current, { inventory, migrations: [] });

  const { target, inventoryPath } = createTarget(inventory);
  const preview = migrateTarget(target, { log() {} });
  const applied = migrateTarget(target, { apply: true, log() {} });
  assert.deepEqual(preview.migrations, []);
  assert.deepEqual(applied.migrations, []);
  assert.equal(applied.backup, null);
  assert.deepEqual(fs.readFileSync(inventoryPath), original);
  assert.deepEqual(fs.readdirSync(path.dirname(inventoryPath)), ["kiti-lock.json"]);
});

test("migration command independently skips current and missing project and home inventories", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kiti-inventory-migration-"));
  const project = path.join(temporary, "project");
  const home = path.join(temporary, "home");
  const inventory = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const projectInventory = path.join(project, ".agents/kiti-lock.json");
  fs.mkdirSync(path.dirname(projectInventory), { recursive: true });
  fs.mkdirSync(home);
  fs.writeFileSync(projectInventory, `${JSON.stringify(inventory, null, 2)}\n`);

  const messages = [];
  const plans = migrateInstallations({
    workingDirectory: project,
    homeDirectory: home,
    log: (message) => messages.push(message),
  });
  assert.match(messages.join("\n"), /project: already at version 1; skipped/);
  assert.match(messages.join("\n"), /home: no inventory; skipped/);
  assert.equal(plans.length, 2);
  assert.deepEqual(installationTargets(project, project).map(({ label }) => label), ["project and home"]);
  assert.throws(() => parseArguments(["--target", project]), /Unknown option/);
});

test("generic inventory files are ignored without being renamed or migrated", () => {
  const inventory = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const { target, inventoryPath } = createTarget(inventory);
  const genericFile = path.join(target, ".agents/other-lock.json");
  fs.renameSync(inventoryPath, genericFile);
  const original = fs.readFileSync(genericFile);

  for (const apply of [false, true]) {
    assert.equal(migrateTarget(target, { apply, log() {} }).skipped, true);
    assert.deepEqual(fs.readFileSync(genericFile), original);
    assert.equal(fs.existsSync(inventoryPath), false);
  }
});
