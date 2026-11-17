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
const npm = (args, cwd) =>
  execFileSync(windows ? process.execPath : npmCli, windows ? [npmCli, ...args] : args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

try {
  const [archive] = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], root));
  const packed = new Set(archive.files.map(({ path: file }) => file));
  for (const file of [
    'package.json',
    'LICENSE',
    'README.md',
    'terminal/bin/kitia.js',
    'terminal/dist/cli/main.js',
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
    'terminal/migrations/run.js',
  ]) {
    assert.ok(packed.has(file), `Missing package file: ${file}`);
  }
  assert.equal(
    [...packed].some((file) => file.startsWith('terminal/test/')),
    false,
  );
  assert.equal(
    [...packed].some((file) => file.startsWith('terminal/dist/catalog/')),
    false,
  );
  assert.equal(
    [...packed].some((file) => file.startsWith('catalogs/')),
    false,
  );
  assert.deepEqual(
    [...packed].filter((file) => file.startsWith('terminal/bin/')),
    ['terminal/bin/kitia.js'],
  );

  const consumer = path.join(temporary, 'consumer');
  fs.mkdirSync(consumer);
  const home = path.join(temporary, 'home');
  fs.mkdirSync(home);
  const consumerEnvironment = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    KITIA_CONFIG_DIR: path.join(temporary, 'config'),
  };
  fs.writeFileSync(path.join(consumer, 'package.json'), '{"private":true}\n');
  npm(['install', '--no-audit', '--no-fund', path.join(temporary, archive.filename)], consumer);
  const installedRoot = path.join(consumer, 'node_modules/@grasdouble/kitia');
  const manifest = JSON.parse(fs.readFileSync(path.join(installedRoot, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.bin, { kitia: 'terminal/bin/kitia.js' });

  const cli = path.join(installedRoot, manifest.bin.kitia);
  execFileSync(process.execPath, [cli, 'dashboard'], {
    cwd: consumer,
    encoding: 'utf8',
    env: consumerEnvironment,
  });
  const listed = JSON.parse(
    execFileSync(process.execPath, [cli, 'list', '--json'], {
      cwd: consumer,
      encoding: 'utf8',
      env: consumerEnvironment,
    }),
  );
  assert.deepEqual(listed, []);
  const migrationHelp = execFileSync(
    process.execPath,
    [path.join(installedRoot, 'terminal/migrations/run.js'), '--help'],
    { cwd: consumer, encoding: 'utf8', env: consumerEnvironment },
  );
  assert.match(migrationHelp, /Usage: .* migrate \[--dry-run \| --apply\]/);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
