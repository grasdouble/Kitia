'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { CURRENT_VERSION, migrateTarget } = require('../dist/migrations/run.js');
const { readInstallState } = require('../dist/core/inventory/inventory.js');
const { OPERATION_LOCK, acquireOperationLock } = require('../dist/core/installations/lock.js');

const currentInventory = { lock_version: CURRENT_VERSION, catalog: 'grasdouble/Kitia', sources: {} };
const previousVersion = CURRENT_VERSION - 1;

function fixture(t, inventory = { lock_version: previousVersion, label: 'original' }) {
  const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-migration-lock-')));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  const directory = path.join(target, '.agents');
  fs.mkdirSync(directory);
  const inventoryFile = path.join(directory, 'kitia-lock.json');
  const lockFile = path.join(target, OPERATION_LOCK);
  const original = Buffer.from(`${JSON.stringify(inventory)}\n`);
  fs.writeFileSync(inventoryFile, original);
  return { target, directory, inventoryFile, lockFile, original };
}

test('apply rereads under the shared lock and excludes a competing writer until publication', (t) => {
  const { target, inventoryFile, lockFile } = fixture(t);
  const fresher = Buffer.from(`  ${JSON.stringify({ lock_version: previousVersion, label: 'fresher' })}\n\n`);
  const open = fs.openSync;
  t.mock.method(fs, 'openSync', (file, ...args) => {
    if (file === lockFile && args[0] === 'wx') fs.writeFileSync(inventoryFile, fresher);
    return open(file, ...args);
  });
  const lockModule = require.resolve('../dist/core/installations/lock.js');
  const competingWrite = `
    const { acquireOperationLock } = require(process.argv[1]);
    try {
      const release = acquireOperationLock(process.argv[2]);
      require('node:fs').writeFileSync(process.argv[3], 'competing write');
      release();
      console.log('writer entered');
    } catch (error) {
      console.log(error.code);
    }
  `;
  const transition = (inventory) => {
    assert.equal(inventory.label, 'fresher');
    assert.equal(fs.existsSync(lockFile), true);
    const writer = execFileSync(process.execPath, ['-e', competingWrite, lockModule, target, inventoryFile], {
      encoding: 'utf8',
    });
    assert.equal(writer.trim(), 'OPERATION_LOCKED');
    return currentInventory;
  };
  const transitions = new Map([[previousVersion, transition]]);
  const result = migrateTarget(target, { apply: true, transitions, log() {} });
  assert.deepEqual(result.migrations, [`${previousVersion}-to-${CURRENT_VERSION}`]);
  assert.deepEqual(readInstallState(target), currentInventory);
  assert.deepEqual(fs.readFileSync(result.backup), fresher);
  assert.equal(fs.existsSync(lockFile), false);
  t.mock.restoreAll();
  acquireOperationLock(target)();
});

test('dry runs and current inventories do not acquire or modify a target lock', (t) => {
  const { target, inventoryFile, lockFile, original, directory } = fixture(t);
  const release = acquireOperationLock(target);
  const lockBytes = fs.readFileSync(lockFile);
  try {
    const transitions = new Map([[previousVersion, () => currentInventory]]);
    const dry = migrateTarget(target, { transitions, log() {} });
    assert.deepEqual(dry.migrations, [`${previousVersion}-to-${CURRENT_VERSION}`]);
    assert.equal(dry.backup, null);
    assert.deepEqual(fs.readFileSync(inventoryFile), original);
    assert.throws(() => migrateTarget(target, { apply: true, transitions, log() {} }), { code: 'OPERATION_LOCKED' });
    fs.writeFileSync(inventoryFile, JSON.stringify(currentInventory));
    assert.deepEqual(migrateTarget(target, { apply: true, log() {} }).migrations, []);
    assert.deepEqual(fs.readFileSync(lockFile), lockBytes);
    assert.deepEqual(fs.readdirSync(directory), [path.basename(inventoryFile)]);
  } finally {
    release();
  }
});

test('failures release the lock and retain only a complete backup', (t) => {
  const { target, inventoryFile, lockFile, original, directory } = fixture(t);
  const invalid = new Map([[previousVersion, () => ({ ...currentInventory, catalog: 'invalid' })]]);
  assert.throws(
    () => migrateTarget(target, { apply: true, transitions: invalid, log() {} }),
    /Invalid installation state/,
  );
  assert.equal(fs.existsSync(lockFile), false);
  assert.deepEqual(fs.readdirSync(directory), [path.basename(inventoryFile)]);

  const transitions = new Map([[previousVersion, () => currentInventory]]);
  const sync = t.mock.method(fs, 'fsyncSync', () => {
    assert.equal(fs.existsSync(lockFile), true);
    throw new Error('injected backup failure');
  });
  assert.throws(() => migrateTarget(target, { apply: true, transitions, log() {} }), /injected backup failure/);
  sync.mock.restore();
  assert.equal(fs.existsSync(lockFile), false);
  assert.deepEqual(fs.readdirSync(directory), [path.basename(inventoryFile)]);
  assert.deepEqual(fs.readFileSync(inventoryFile), original);

  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (to === inventoryFile) {
      assert.equal(fs.existsSync(lockFile), true);
      throw new Error('injected publication failure');
    }
    return rename(from, to);
  });
  assert.throws(
    () => migrateTarget(target, { apply: true, transitions, log() {} }),
    /The original backup is at .*injected publication failure/,
  );
  const backup = fs.readdirSync(directory).find((file) => file.includes('.backup-'));
  assert.deepEqual(fs.readFileSync(path.join(directory, backup)), original);
  assert.deepEqual(fs.readFileSync(inventoryFile), original);
  assert.equal(fs.existsSync(lockFile), false);
});
