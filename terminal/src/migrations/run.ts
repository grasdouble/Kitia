#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import fs, { type Stats } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { acquireOperationLock } from '../core/installations/lock.js';
import { readInstallState } from '../core/inventory/inventory.js';
import { LOCK_PATH as INVENTORY_PATH } from '../core/inventory/model.js';
import { CURRENT_INVENTORY_VERSION } from '../core/inventory/version.js';

type HistoricalInventory = {
  lock_version?: unknown;
  [key: string]: unknown;
} | null;
type Migration = (inventory: HistoricalInventory) => HistoricalInventory;
type MigrationResult = { inventory: HistoricalInventory; migrations: string[] };
type TargetInventory =
  | { root: string; inventoryFile: null; fileStat: null }
  | {
      root: string;
      inventoryFile: string;
      fileStat: Stats;
      original: Buffer;
      inventory: HistoricalInventory;
    };
type MigrationTargetResult = {
  root: string;
  migrated: HistoricalInventory;
  migrations: string[];
  backup: string | null;
  skipped?: boolean;
};
type InstallationTarget = { root: string; labels: string[]; label: string };

const CURRENT_VERSION = CURRENT_INVENTORY_VERSION;
const MIGRATIONS = new Map<number, Migration>();

function applyMigrationChain(
  inventory: HistoricalInventory,
  targetVersion: number,
  migrations: Map<number, Migration>,
): MigrationResult {
  let current = structuredClone(inventory);
  const applied = [];
  while (current?.lock_version !== targetVersion) {
    const from = current?.lock_version;
    const migrate = migrations.get(from as number);
    if (!migrate) {
      throw new Error(`No migration path is available from inventory version ${from}.`);
    }
    const next = migrate(current);
    if (next?.lock_version !== (from as number) + 1) {
      throw new Error(`Migration ${from}-to-${(from as number) + 1} returned an invalid version.`);
    }
    applied.push(`${from}-to-${next?.lock_version}`);
    current = next;
  }
  return { inventory: current, migrations: applied };
}

function migrateInventory(
  inventory: HistoricalInventory,
  migrations: Map<number, Migration> = MIGRATIONS,
): MigrationResult {
  const result = applyMigrationChain(inventory, CURRENT_VERSION, migrations);
  validateCurrentInventory(result.inventory);
  return result;
}

function validateCurrentInventory(inventory: HistoricalInventory): void {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-inventory-migration-'));
  try {
    const metadataDirectory = path.join(temporary, '.agents');
    fs.mkdirSync(metadataDirectory);
    fs.writeFileSync(path.join(temporary, INVENTORY_PATH), `${JSON.stringify(inventory)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    readInstallState(temporary);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function parseArguments(args: string[]): { help: true } | { apply: boolean; help?: never } {
  let apply = false;
  let sawDryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--apply') {
      apply = true;
    } else if (argument === '--dry-run') {
      sawDryRun = true;
    } else if (argument === '--help' || argument === '-h') {
      return { help: true };
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (apply && sawDryRun) throw new Error('--apply and --dry-run cannot be combined.');
  return { apply };
}

function readTargetInventory(target: string): TargetInventory {
  const root = fs.realpathSync(target);
  if (!fs.statSync(root).isDirectory()) throw new Error(`Target must be a directory: ${target}`);
  const metadataDirectory = path.join(root, '.agents');
  let directoryStat: Stats;
  try {
    directoryStat = fs.lstatSync(metadataDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { root, inventoryFile: null, fileStat: null };
    }
    throw error;
  }
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    throw new Error(`Inventory directory must be a regular directory: ${metadataDirectory}`);
  }
  const inventoryFile = path.join(root, INVENTORY_PATH);
  let fileStat: Stats;
  try {
    fileStat = fs.lstatSync(inventoryFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { root, inventoryFile: null, fileStat: null };
    }
    throw error;
  }
  if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
    throw new Error(`Inventory must be a regular file: ${inventoryFile}`);
  }
  const original = fs.readFileSync(inventoryFile);
  let inventory: HistoricalInventory;
  try {
    inventory = JSON.parse(original.toString('utf8')) as HistoricalInventory;
  } catch (error) {
    throw new Error(`Cannot parse ${INVENTORY_PATH}: ${(error as Error).message}`);
  }
  return { root, inventoryFile, fileStat, original, inventory };
}

function backupFileName(inventoryFile: string, now: Date): string {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '');
  const base = `${inventoryFile}.backup-${stamp}`;
  for (let suffix = 0; ; suffix += 1) {
    const candidate = suffix ? `${base}-${suffix}` : base;
    if (!fs.existsSync(candidate)) return candidate;
  }
}

function writeExclusive(file: string, data: string | Buffer, mode: number): void {
  const descriptor = fs.openSync(file, 'wx', mode);
  let complete = false;
  try {
    fs.writeFileSync(descriptor, data);
    if (process.platform !== 'win32') fs.fchmodSync(descriptor, mode);
    fs.fsyncSync(descriptor);
    complete = true;
  } finally {
    try {
      fs.closeSync(descriptor);
    } finally {
      if (!complete) fs.unlinkSync(file);
    }
  }
}

function writeAtomic(inventoryFile: string, data: string, mode: number): void {
  const temporary = `${inventoryFile}.${process.pid}.${randomUUID()}.tmp`;
  writeExclusive(temporary, data, mode);
  try {
    fs.renameSync(temporary, inventoryFile);
  } catch (error) {
    try {
      fs.unlinkSync(temporary);
    } catch (cleanupError) {
      if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') throw cleanupError;
    }
    throw error;
  }
}

function migrateTarget(
  target: string,
  {
    apply = false,
    now = new Date(),
    log = console.log,
    transitions = MIGRATIONS,
  }: {
    apply?: boolean;
    now?: Date;
    log?: (message: string) => void;
    transitions?: Map<number, Migration>;
  } = {},
): MigrationTargetResult {
  let current = readTargetInventory(target);
  let release: (() => void) | undefined;
  try {
    if (apply && 'inventory' in current && current.inventory?.lock_version !== CURRENT_VERSION) {
      release = acquireOperationLock(current.root);
      current = readTargetInventory(current.root);
    }
    const { root } = current;
    if (!('inventory' in current)) {
      log(`No inventory at ${root}; skipped.`);
      return {
        root,
        migrated: null,
        migrations: [],
        backup: null,
        skipped: true,
      };
    }
    const { inventoryFile, fileStat, original, inventory } = current;
    const { inventory: migrated, migrations } = migrateInventory(inventory, transitions);
    if (!migrations.length) {
      log(`Inventory at ${root} is already version ${CURRENT_VERSION}; nothing to migrate.`);
      return { root, migrated, migrations, backup: null };
    }
    if (!apply) {
      log(
        `Would migrate inventory ${migrations.join(' -> ')} to version ${CURRENT_VERSION}. No files were changed; rerun with --apply to create a backup and apply it.`,
      );
      return { root, migrated, migrations, backup: null };
    }

    if (!fs.readFileSync(inventoryFile).equals(original)) {
      throw new Error(
        'The inventory changed during migration planning; no files were written. Retry after reviewing the current inventory.',
      );
    }
    const backup = backupFileName(inventoryFile, now);
    const mode = fileStat.mode & 0o777;
    writeExclusive(backup, original, mode);
    try {
      if (!fs.readFileSync(inventoryFile).equals(original)) {
        throw new Error('The inventory changed while creating its backup.');
      }
      writeAtomic(inventoryFile, `${JSON.stringify(migrated, null, 2)}\n`, mode);
    } catch (error) {
      throw new Error(
        `Migration did not replace the inventory. The original backup is at ${backup}: ${(error as Error).message}`,
      );
    }
    log(`Migrated inventory ${migrations.join(' -> ')} to version ${CURRENT_VERSION}. Backup: ${backup}`);
    return { root, migrated, migrations, backup };
  } finally {
    release?.();
  }
}

function installationTargets(workingDirectory = process.cwd(), homeDirectory = os.homedir()): InstallationTarget[] {
  const candidates = [
    { label: 'Project', directory: workingDirectory },
    { label: 'Home', directory: homeDirectory },
  ];
  const targets = new Map<string, { root: string; labels: string[] }>();
  for (const candidate of candidates) {
    const root = fs.realpathSync(candidate.directory);
    const existing = targets.get(root);
    if (existing) existing.labels.push(candidate.label);
    else targets.set(root, { root, labels: [candidate.label] });
  }
  return [...targets.values()].map((target) => ({
    ...target,
    label: target.labels.join(' and ').toLowerCase(),
  }));
}

function migrateInstallations({
  apply = false,
  workingDirectory = process.cwd(),
  homeDirectory = os.homedir(),
  log = console.log,
}: {
  apply?: boolean;
  workingDirectory?: string;
  homeDirectory?: string;
  log?: (message: string) => void;
} = {}): Array<InstallationTarget & { plan: MigrationTargetResult }> {
  const targets = installationTargets(workingDirectory, homeDirectory);
  const plans = targets.map((target) => ({
    ...target,
    plan: migrateTarget(target.root, { log: () => {} }),
  }));
  if (!apply) {
    for (const { label, plan } of plans) {
      if (plan.skipped) log(`${label}: no inventory; skipped.`);
      else if (!plan.migrations.length) log(`${label}: already at version ${CURRENT_VERSION}; skipped.`);
      else log(`${label}: would migrate ${plan.migrations.join(' -> ')} to version ${CURRENT_VERSION}.`);
    }
    log('No files were changed. Rerun with --apply to create backups and migrate.');
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

function printHelp(): void {
  console.log(`Usage: npx --yes @grasdouble/kitia migrate [--dry-run | --apply]

Inspect registered consecutive inventory migrations. The current source-only
format is version 1; no historical migrations are registered. --apply creates backups before writing.`);
}

function main(args: string[] = process.argv.slice(2)): number {
  try {
    const options = parseArguments(args);
    if ('apply' in options) {
      migrateInstallations(options);
      return 0;
    }
    printHelp();
    return 0;
  } catch (error) {
    console.error(`Migration failed: ${(error as Error).message}`);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

export {
  CURRENT_VERSION,
  applyMigrationChain,
  migrateInventory,
  validateCurrentInventory,
  parseArguments,
  installationTargets,
  migrateTarget,
  migrateInstallations,
  main,
};
