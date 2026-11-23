'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const packageRoot = path.resolve(__dirname, '..');
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
  const [archive] = JSON.parse(npm(['pack', '--json', '--pack-destination', temporary], packageRoot));
  const packed = new Set(archive.files.map(({ path: file }) => file));
  for (const file of [
    'package.json',
    'LICENSE',
    'README.md',
    'CHANGELOG.md',
    'CONTRIBUTING.md',
    'dist/kitia.js',
    'dist/migrations/run.js',
    'dist/core/resources/model.js',
    'dist/core/catalogs/config.js',
    'dist/core/inventory/inventory.js',
    'dist/core/inventory/model.js',
    'dist/core/inventory/version.js',
    'dist/core/inventory/discovery.js',
    'dist/core/inventory/checks.js',
    'dist/core/diagnostics/doctor.js',
    'dist/core/installations/lifecycle.js',
    'dist/core/inspection/audit.js',
    'dist/core/collections/manifest.js',
    'docs/cli-contract.md',
    'docs/inventory-migrations.md',
    'docs/resource-audit.md',
    'docs/resource-collections.md',
    'schemas/catalog-lock-v1.schema.json',
    'schemas/cli-discovery-v1.schema.json',
    'schemas/cli-report-v1.schema.json',
  ]) {
    assert.ok(packed.has(file), `Missing package file: ${file}`);
  }
  for (const excludedDirectory of ['terminal/', 'src/', 'test/', 'catalogs/', 'bin/', 'migrations/']) {
    assert.equal(
      [...packed].some((file) => file.startsWith(excludedDirectory)),
      false,
      `Unexpected package directory: ${excludedDirectory}`,
    );
  }
  assert.equal(
    [...packed].some((file) => file.startsWith('dist/catalog/')),
    false,
  );
  assert.equal(
    [...packed].some((file) => file.startsWith('dist/') && file.split('/').includes('__tests__')),
    false,
  );

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
  assert.deepEqual(manifest.bin, { kitia: 'dist/kitia.js' });
  const commandShim = path.join(consumer, 'node_modules/.bin', `kitia${windows ? '.cmd' : ''}`);
  assert.ok(fs.existsSync(commandShim), `Missing installed command shim: ${commandShim}`);

  for (const file of packed) {
    if (!file.endsWith('.md')) continue;
    const markdown = fs.readFileSync(path.join(installedRoot, file), 'utf8');
    for (const [, url] of markdown.matchAll(/\[[^\]\n]*\]\(([^\s)]+)\)/g)) {
      if (/^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith('//')) continue;
      const [target] = url.split('#');
      const linkedFile = path.posix.normalize(
        path.posix.join(path.posix.dirname(file), target || path.posix.basename(file)),
      );
      assert.ok(packed.has(linkedFile), `${file}: missing packaged Markdown link ${url}`);
    }
  }

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
