'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Ajv = require('ajv');
const { test } = require('node:test');

const root = path.resolve(__dirname, '../..');
const executable = path.join(root, 'dist/kitia.js');
const { catalogIndexFileName } = require(path.join(root, 'dist/core/catalogs/config.js'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-contract-'));
const config = path.join(temporary, 'config');
const indexDirectory = path.join(config, 'source-catalogs');
const environment = {
  ...process.env,
  KITIA_CONFIG_DIR: config,
  KITIA_INSTALLED_VERSION: '2.0.0',
};
const schemaDirectory = path.join(root, 'schemas');
const validateDiscovery = new Ajv({ allErrors: true }).compile(
  JSON.parse(fs.readFileSync(path.join(schemaDirectory, 'cli-discovery-v1.schema.json'), 'utf8')),
);
const validateReport = new Ajv({ allErrors: true }).compile(
  JSON.parse(fs.readFileSync(path.join(schemaDirectory, 'cli-report-v1.schema.json'), 'utf8')),
);
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/cli-contract-v1.json'), 'utf8'));
function writeCatalog(name, repository, resources, sourceRef = 'b'.repeat(40)) {
  const registry = {
    catalog_version: 1,
    sources: [{ name, repository: `https://github.com/${repository}` }],
  };
  const index = {
    catalog_version: 1,
    catalog_name: name,
    source_repository: repository,
    source_ref: sourceRef,
    resources,
  };
  fs.rmSync(indexDirectory, { recursive: true, force: true });
  fs.mkdirSync(indexDirectory, { recursive: true });
  fs.writeFileSync(path.join(config, 'catalogSources.json'), `${JSON.stringify(registry)}\n`);
  fs.writeFileSync(path.join(indexDirectory, 'catalogSources.json'), `${JSON.stringify(registry)}\n`);
  const indexPath = path.join(indexDirectory, catalogIndexFileName(name));
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, `${JSON.stringify(index)}\n`);
}
const fixtureResource = {
  id: 'demo',
  kind: 'skill',
  source_path: 'skills/demo',
  description: 'Fixture skill.',
  license_status: 'not-declared',
};

function invoke(args, { cwd = temporary, env = {}, preload = false, parseJson = true } = {}) {
  const preloadArgs = preload ? ['--require', path.join(root, 'test/gh-process-preload.cjs')] : [];
  const result = spawnSync(process.execPath, [...preloadArgs, executable, ...args], {
    cwd,
    env: { ...environment, ...env },
    encoding: 'utf8',
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  return { ...result, json: parseJson && result.stdout ? JSON.parse(result.stdout) : undefined };
}

function assertSchema(validate, value) {
  assert.equal(validate(value), true, JSON.stringify(validate.errors));
}

function writeInventory(target, contents) {
  fs.mkdirSync(path.join(target, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(target, '.agents/kitia-lock.json'), contents);
}

test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

test('packaged CLI discovery returns a versioned resource array', () => {
  writeCatalog('Fixture', 'example/catalog', [fixtureResource]);
  const result = invoke(['list', '--json']);
  assert.equal(result.status, 0, result.stderr);
  assertSchema(validateDiscovery, result.json);
  assert.deepEqual(
    result.json.map(({ catalog: name, kind, id }) => ({ catalog: name, kind, id })),
    [baseline.discovery.resource],
  );
});

test('packaged CLI check report matches the version-1 baseline', () => {
  writeCatalog('Fixture', 'example/catalog', [fixtureResource]);
  const result = invoke(['check', '--target', temporary, '--json']);
  assert.equal(result.status, 0, result.stderr);
  assertSchema(validateReport, result.json);
  assert.deepEqual(
    {
      command: result.json.command,
      status: result.json.status,
      dry_run: result.json.dry_run,
      resource_count: result.json.resources.length,
      action_count: result.json.actions.length,
      warning_count: result.json.warnings.length,
      error_count: result.json.errors.length,
    },
    baseline.check,
  );
});

test('packaged CLI reports missing-resource errors with the promised exit code', () => {
  writeCatalog('Fixture', 'example/catalog', [fixtureResource]);
  const result = invoke([
    'install',
    'skill',
    'missing-contract-resource',
    '--catalog',
    'Fixture',
    '--target',
    temporary,
    '--dry-run',
    '--json',
  ]);
  assert.equal(result.status, baseline.missing_resource.exit_code);
  assertSchema(validateReport, result.json);
  assert.equal(result.json.status, baseline.missing_resource.status);
  assert.equal(result.json.errors[0]?.code, baseline.missing_resource.error_code);
});

test('packaged CLI check resolves a committed historical inventory fixture', () => {
  writeCatalog('team-alpha', 'example/skills', [
    {
      id: 'upstream-skill',
      kind: 'skill',
      source_path: 'skills/upstream-skill',
      description: 'Historical fixture skill.',
      license_status: 'MIT',
    },
  ]);
  const target = path.join(temporary, 'historical-target');
  const fixture = fs.readFileSync(path.join(root, 'test/fixtures/inventory-v1-source-only.json'));
  writeInventory(target, fixture);
  const result = invoke(['check', '--target', target, '--json']);
  assertSchema(validateReport, result.json);
  assert.ok(
    result.json.resources.some(
      ({ catalog: name, kind, id }) =>
        name === baseline.historical_inventory.catalog &&
        kind === baseline.historical_inventory.kind &&
        id === baseline.historical_inventory.id,
    ),
  );
  assert.deepEqual(fs.readFileSync(path.join(target, '.agents/kitia-lock.json')), fixture);
});

test('future-version and unsupported-kind inventories remain byte-for-byte unchanged with force', () => {
  writeCatalog('Fixture', 'example/catalog', [fixtureResource]);
  const cases = [
    {
      name: 'future',
      contents: {
        lock_version: 999,
        catalog: 'grasdouble/Kitia',
        sources: {},
      },
    },
    {
      name: 'unsupported-kind',
      contents: {
        lock_version: 1,
        catalog: 'grasdouble/Kitia',
        sources: { 'team-alpha': { plugins: { example: {} } } },
      },
    },
  ];
  for (const scenario of cases) {
    const target = path.join(temporary, scenario.name);
    const contents = `${JSON.stringify(scenario.contents)}\n`;
    writeInventory(target, contents);
    const inventoryPath = path.join(target, '.agents/kitia-lock.json');
    const before = fs.readFileSync(inventoryPath);
    const result = invoke(
      ['uninstall', 'skill', 'upstream-skill', '--catalog', 'team-alpha', '--target', target, '--force'],
      { parseJson: false },
    );
    assert.notEqual(result.status, 0);
    assert.deepEqual(fs.readFileSync(inventoryPath), before);
    assert.deepEqual(fs.readdirSync(path.dirname(inventoryPath)), ['kitia-lock.json']);
  }
});

test('top-level help and doctor network probes use the executable argument contract', () => {
  const help = invoke(['--help'], { parseJson: false });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage:/);

  writeCatalog('Fixture', 'example/catalog', [fixtureResource]);
  const ghScript = path.join(temporary, 'gh-fixture.cjs');
  const invoked = path.join(temporary, 'gh-invoked.jsonl');
  fs.writeFileSync(
    ghScript,
    [
      'const fs = require("node:fs");',
      'const args = process.argv.slice(2);',
      'fs.appendFileSync(process.env.KITIA_TEST_GH_INVOKED, `${JSON.stringify(args)}\\n`);',
      'process.stdout.write(args[0] === "--version" ? "gh version 2.0.0\\n" : "ok\\n");',
      '',
    ].join('\n'),
  );
  const env = { KITIA_TEST_GH_SCRIPT: ghScript, KITIA_TEST_GH_INVOKED: invoked };
  const noNetwork = invoke(['doctor', '--target', temporary, '--json'], { preload: true, env });
  assertSchema(validateReport, noNetwork.json);
  const noNetworkCalls = fs
    .readFileSync(invoked, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.ok(noNetworkCalls.some((args) => args[0] === '--version'));
  assert.ok(noNetworkCalls.some((args) => args[0] === 'skill' && args[1] === '--help'));
  assert.equal(
    noNetworkCalls.some((args) => ['auth', 'api'].includes(args[0])),
    false,
  );

  fs.rmSync(invoked, { force: true });
  const network = invoke(['doctor', '--network', '--target', temporary, '--json'], { preload: true, env });
  assertSchema(validateReport, network.json);
  const calls = fs
    .readFileSync(invoked, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.ok(calls.some((args) => args[0] === 'auth'));
  assert.ok(calls.some((args) => args[0] === 'api'));

  fs.rmSync(invoked, { force: true });
  const rejected = invoke(['check', '--network', '--json'], { preload: true, env });
  assert.equal(rejected.status, 1);
  assertSchema(validateReport, rejected.json);
  assert.equal(rejected.json.errors[0]?.code, 'INVALID_ARGUMENT');
  assert.equal(fs.existsSync(invoked), false);
});

test('migration help and invalid flags dispatch through the executable contract', () => {
  const help = invoke(['migrate', '--help'], { parseJson: false });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage: .* migrate \[--dry-run \| --apply\]/);

  const invalid = invoke(['migrate', '--invalid'], { parseJson: false });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Unknown option: --invalid/);
});
