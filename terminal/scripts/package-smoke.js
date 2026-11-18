'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-package-test-'));
const windows = process.platform === 'win32';
const npmCli = windows ? path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js') : 'npm';
const npm = (args, cwd, env = process.env) =>
  execFileSync(windows ? process.execPath : npmCli, windows ? [npmCli, ...args] : args, {
    cwd,
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

try {
  const [archive] = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], root));
  const packed = new Set(archive.files.map(({ path: file }) => file));
  for (const file of [
    'package.json',
    'LICENSE',
    'README.md',
    'terminal/dist/kitia.js',
    'terminal/dist/migrations/run.js',
    'terminal/dist/core/resources/model.js',
    'terminal/dist/core/catalogs/config.js',
    'terminal/dist/core/inventory/inventory.js',
    'terminal/dist/core/inventory/model.js',
    'terminal/dist/core/inventory/version.js',
    'terminal/dist/core/inventory/discovery.js',
    'terminal/dist/core/inventory/checks.js',
    'terminal/dist/core/diagnostics/doctor.js',
    'terminal/dist/core/installations/lifecycle.js',
    'terminal/dist/core/inspection/audit.js',
    'terminal/dist/core/collections/manifest.js',
    'docs/cli-contract.md',
    'terminal/schemas/catalog-lock-v1.schema.json',
  ]) {
    assert.ok(packed.has(file), `Missing package file: ${file}`);
  }
  assert.equal(
    [...packed].some((file) => file.startsWith('terminal/test/')),
    false,
  );
  assert.equal(
    [...packed].some((file) => file.startsWith('terminal/src/')),
    false,
  );
  assert.equal(
    [...packed].some((file) => file.startsWith('terminal/dist/catalog/')),
    false,
  );
  assert.equal(
    [...packed].some((file) => file.startsWith('terminal/dist/') && file.split('/').includes('__tests__')),
    false,
  );
  assert.equal(
    [...packed].some((file) => file.startsWith('catalogs/')),
    false,
  );
  for (const legacyDirectory of ['terminal/bin/', 'terminal/migrations/']) {
    assert.equal(
      [...packed].some((file) => file.startsWith(legacyDirectory)),
      false,
      `Unexpected legacy package directory: ${legacyDirectory}`,
    );
  }

  const consumer = path.join(temporary, 'consumer');
  fs.mkdirSync(consumer);
  const home = path.join(temporary, 'home');
  fs.mkdirSync(home);
  const consumerEnvironment = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    ...(windows
      ? {}
      : {
          // Keep active Node available with isolated HOME, avoiding version-manager shims.
          PATH: [path.dirname(process.execPath), process.env.PATH].filter(Boolean).join(path.delimiter),
        }),
    KITIA_CONFIG_DIR: path.join(temporary, 'config'),
  };
  fs.writeFileSync(path.join(consumer, 'package.json'), '{"private":true}\n');
  npm(['install', '--no-audit', '--no-fund', path.join(temporary, archive.filename)], consumer);
  const installedRoot = path.join(consumer, 'node_modules/@grasdouble/kitia');
  const manifest = JSON.parse(fs.readFileSync(path.join(installedRoot, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.bin, { kitia: 'terminal/dist/kitia.js' });
  const commandShim = path.join(consumer, 'node_modules/.bin', `kitia${windows ? '.cmd' : ''}`);
  assert.ok(fs.existsSync(commandShim), `Missing installed command shim: ${commandShim}`);
  const runKitia = (...args) =>
    npm(['exec', '--offline', '--no', '--', 'kitia', ...args], consumer, consumerEnvironment);

  runKitia('dashboard');
  const listed = JSON.parse(runKitia('list', '--json'));
  assert.deepEqual(listed, []);
  const migrationHelp = runKitia('migrate', '--help');
  assert.match(migrationHelp, /Usage: .* migrate \[--dry-run \| --apply\]/);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
