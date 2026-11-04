"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const Ajv = require("ajv");
const {
  CURRENT_VERSION, applyMigrationChain, installationTargets, migrateInstallations,
  migrateInventory, migrateTarget,
} = require("../migrations/run.js");
const root = path.resolve(__dirname, "..");
const schema = JSON.parse(fs.readFileSync(path.join(root, "schemas/catalog-lock-v1.schema.json"), "utf8"));
const validateSchema = new Ajv({ allErrors: true, strict: true }).compile(schema);
const fixturePath = path.join(__dirname, "fixtures", "inventory-v1-source-only.json");
let temporary;

afterEach(() => {
  if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
  temporary = null;
});

function createTarget(inventory) {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-inventory-migration-"));
  const target = path.join(temporary, "target");
  const metadata = path.join(target, ".agents");
  fs.mkdirSync(metadata, { recursive: true });
  const inventoryPath = path.join(metadata, "kitia-lock.json");
  fs.writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
  return { target, inventoryPath };
}

test("version 1 is the current source-only inventory format", () => {
  const inventory = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const result = migrateInventory(inventory);
  assert.equal(CURRENT_VERSION, 1);
  assert.equal(schema.properties.lock_version.const, CURRENT_VERSION);
  assert.equal(validateSchema(result.inventory), true, JSON.stringify(validateSchema.errors));
  assert.deepEqual(result, { inventory, migrations: [] });
  assert.deepEqual(Object.keys(inventory), ["lock_version", "catalog", "sources"]);
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

test("current v1 inventories are skipped without backup or rewrite", () => {
  const inventory = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const { target, inventoryPath } = createTarget(inventory);
  const original = fs.readFileSync(inventoryPath);
  const result = migrateTarget(target, { apply: true, log() {} });
  assert.deepEqual(result.migrations, []);
  assert.equal(result.backup, null);
  assert.deepEqual(fs.readFileSync(inventoryPath), original);
  const home = path.join(temporary, "home");
  fs.mkdirSync(home);

  const messages = [];
  const plans = migrateInstallations({
    workingDirectory: target,
    homeDirectory: path.join(temporary, "home"),
    apply: true,
    log: (message) => messages.push(message),
  });
  assert.match(messages.join("\n"), /project: already at version 1; skipped/);
  assert.match(messages.join("\n"), /home: no inventory; skipped/);
  assert.equal(plans.length, 2);
  assert.deepEqual(installationTargets(target, target).map(({ label }) => label), ["project and home"]);
  assert.deepEqual(fs.readFileSync(inventoryPath), original);
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
