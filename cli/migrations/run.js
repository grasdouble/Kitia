#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");

const { CURRENT_INVENTORY_VERSION } = require("../dist/catalog/inventory/version.js");
const { LOCK_PATH: INVENTORY_PATH } = require("../dist/catalog/resources/index.js");
const { OPERATION_LOCK } = require("../dist/catalog/operation.js");
const CURRENT_VERSION = CURRENT_INVENTORY_VERSION;
const MIGRATIONS = new Map();

function applyMigrationChain(inventory, targetVersion, migrations) {
  let current = structuredClone(inventory);
  const applied = [];
  while (current?.lock_version !== targetVersion) {
    const from = current?.lock_version;
    const migrate = migrations.get(from);
    if (!migrate) {
      throw new Error(`No migration path is available from inventory version ${from}.`);
    }
    const next = migrate(current);
    if (next?.lock_version !== from + 1) {
      throw new Error(`Migration ${from}-to-${from + 1} returned an invalid version.`);
    }
    applied.push(`${from}-to-${next.lock_version}`);
    current = next;
  }
  return { inventory: current, migrations: applied };
}

function migrateInventory(inventory) {
  const result = applyMigrationChain(inventory, CURRENT_VERSION, MIGRATIONS);
  validateCurrentInventory(result.inventory);
  return result;
}

function validateCurrentInventory(inventory) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-inventory-migration-"));
  try {
    const metadataDirectory = path.join(temporary, ".agents");
    fs.mkdirSync(metadataDirectory);
    fs.writeFileSync(
      path.join(temporary, INVENTORY_PATH),
      `${JSON.stringify(inventory)}\n`,
      { flag: "wx", mode: 0o600 },
    );
    const { readInstallState } = require("../dist/catalog/inventory/index.js");
    readInstallState(temporary);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function parseArguments(args) {
  let apply = false;
  let sawDryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--apply") {
      apply = true;
    } else if (argument === "--dry-run") {
      sawDryRun = true;
    } else if (argument === "--help" || argument === "-h") {
      return { help: true };
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (apply && sawDryRun) throw new Error("--apply and --dry-run cannot be combined.");
  return { apply };
}

function resolveInventoryFile(target) {
  const root = fs.realpathSync(target);
  if (!fs.statSync(root).isDirectory()) throw new Error(`Target must be a directory: ${target}`);
  const metadataDirectory = path.join(root, ".agents");
  let directoryStat;
  try {
    directoryStat = fs.lstatSync(metadataDirectory);
  } catch (error) {
    if (error.code === "ENOENT") return { root, inventoryFile: null, fileStat: null };
    throw error;
  }
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    throw new Error(`Inventory directory must be a regular directory: ${metadataDirectory}`);
  }
  const inventoryFile = path.join(root, INVENTORY_PATH);
  let fileStat;
  try {
    fileStat = fs.lstatSync(inventoryFile);
  } catch (error) {
    if (error.code === "ENOENT") return { root, inventoryFile: null, fileStat: null };
    throw error;
  }
  if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
    throw new Error(`Inventory must be a regular file: ${inventoryFile}`);
  }
  if (fs.existsSync(path.join(root, OPERATION_LOCK))) {
    throw new Error(`A catalog operation lock exists in ${root}; wait for active work or recover the lock before migrating.`);
  }
  return { root, inventoryFile, fileStat };
}

function backupFileName(inventoryFile, now) {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, "");
  const base = `${inventoryFile}.backup-${stamp}`;
  for (let suffix = 0; ; suffix += 1) {
    const candidate = suffix ? `${base}-${suffix}` : base;
    if (!fs.existsSync(candidate)) return candidate;
  }
}

function writeAtomic(inventoryFile, data, mode) {
  const temporary = `${inventoryFile}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", mode);
    fs.writeFileSync(descriptor, data);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, inventoryFile);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try {
      fs.unlinkSync(temporary);
    } catch (cleanupError) {
      if (cleanupError.code !== "ENOENT") throw cleanupError;
    }
    throw error;
  }
}

function migrateTarget(target, { apply = false, now = new Date(), log = console.log } = {}) {
  const { root, inventoryFile, fileStat } = resolveInventoryFile(target);
  if (!inventoryFile) {
    log(`No inventory at ${root}; skipped.`);
    return { root, migrated: null, migrations: [], backup: null, skipped: true };
  }
  const original = fs.readFileSync(inventoryFile);
  let inventory;
  try {
    inventory = JSON.parse(original.toString("utf8"));
  } catch (error) {
    throw new Error(`Cannot parse ${INVENTORY_PATH}: ${error.message}`);
  }
  const { inventory: migrated, migrations } = migrateInventory(inventory);
  if (!migrations.length) {
    log(`Inventory at ${root} is already version ${CURRENT_VERSION}; nothing to migrate.`);
    return { root, migrated, migrations, backup: null };
  }
  if (!apply) {
    log(`Would migrate inventory ${migrations.join(" -> ")} to version ${CURRENT_VERSION}. No files were changed; rerun with --apply to create a backup and apply it.`);
    return { root, migrated, migrations, backup: null };
  }

  const latest = fs.readFileSync(inventoryFile);
  if (!latest.equals(original)) {
    throw new Error("The inventory changed during migration planning; no files were written. Retry after reviewing the current inventory.");
  }
  const backup = backupFileName(inventoryFile, now);
  fs.copyFileSync(inventoryFile, backup, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(backup, fileStat.mode & 0o777);
  try {
    const current = fs.readFileSync(inventoryFile);
    if (!current.equals(original)) {
      throw new Error("The inventory changed while creating its backup.");
    }
    writeAtomic(
      inventoryFile,
      `${JSON.stringify(migrated, null, 2)}\n`,
      fileStat.mode & 0o777,
    );
  } catch (error) {
    throw new Error(`Migration did not replace the inventory. The original backup is at ${backup}: ${error.message}`);
  }
  log(`Migrated inventory ${migrations.join(" -> ")} to version ${CURRENT_VERSION}. Backup: ${backup}`);
  return { root, migrated, migrations, backup };
}

function installationTargets(workingDirectory = process.cwd(), homeDirectory = os.homedir()) {
  const candidates = [
    { label: "Project", directory: workingDirectory },
    { label: "Home", directory: homeDirectory },
  ];
  const targets = new Map();
  for (const candidate of candidates) {
    const root = fs.realpathSync(candidate.directory);
    const existing = targets.get(root);
    if (existing) existing.labels.push(candidate.label);
    else targets.set(root, { root, labels: [candidate.label] });
  }
  return [...targets.values()].map((target) => ({
    ...target,
    label: target.labels.join(" and ").toLowerCase(),
  }));
}

function migrateInstallations({
  apply = false,
  workingDirectory = process.cwd(),
  homeDirectory = os.homedir(),
  log = console.log,
} = {}) {
  const targets = installationTargets(workingDirectory, homeDirectory);
  const plans = targets.map((target) => ({
    ...target,
    plan: migrateTarget(target.root, { log: () => {} }),
  }));
  if (!apply) {
    for (const { label, plan } of plans) {
      if (plan.skipped) log(`${label}: no inventory; skipped.`);
      else if (!plan.migrations.length) log(`${label}: already at version ${CURRENT_VERSION}; skipped.`);
      else log(`${label}: would migrate ${plan.migrations.join(" -> ")} to version ${CURRENT_VERSION}.`);
    }
    log("No files were changed. Rerun with --apply to create backups and migrate.");
    return plans;
  }

  for (const { label, plan, root } of plans) {
    if (plan.skipped) {
      log(`${label}: no inventory; skipped.`);
    } else if (!plan.migrations.length) {
      log(`${label}: already at version ${CURRENT_VERSION}; skipped.`);
    } else {
      migrateTarget(root, {
        apply: true,
        log: (message) => log(`${label}: ${message}`),
      });
    }
  }
  return plans;
}

function printHelp() {
  console.log(`Usage: npx --yes @grasdouble/kitia migrate [--dry-run | --apply]

Inspect registered consecutive inventory migrations. The current source-only
format is version 1; no historical migrations are registered. --apply creates backups before writing.`);
}

function main(args = process.argv.slice(2)) {
  try {
    const options = parseArguments(args);
    if (options.help) {
      printHelp();
      return 0;
    }
    migrateInstallations(options);
    return 0;
  } catch (error) {
    console.error(`Migration failed: ${error.message}`);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  CURRENT_VERSION, applyMigrationChain, migrateInventory, validateCurrentInventory, parseArguments,
  installationTargets, migrateTarget, migrateInstallations, main,
};
