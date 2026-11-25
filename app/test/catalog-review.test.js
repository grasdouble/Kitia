'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');
const { Worker } = require('node:worker_threads');
const { catalogIndexFileName } = require('../dist/core/catalogs/config.js');

const executable = path.join(__dirname, '../dist/kitia.js');
const ghPreload = path.join(__dirname, 'gh-process-preload.cjs');
const dashboardWorker = path.join(__dirname, '../dist/application/worker.js');
const fixtureAgent = {
  id: 'demo-agent',
  kind: 'agent',
  source_path: 'agents/demo-agent.agent.md',
  description: 'A local fixture agent.',
  license_status: 'MIT',
};
const agentBytes = Buffer.from(
  '---\nname: demo-agent\ndescription: A local fixture agent.\nlicense: MIT\n---\n\nFixture body.\n',
);

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function catalogFixture(config, sources) {
  const directory = path.join(config, 'source-catalogs');
  const registry = {
    catalog_version: 1,
    sources: sources.map(({ name, repository }) => ({ name, repository: `https://github.com/${repository}` })),
  };
  writeJson(path.join(config, 'catalogSources.json'), registry);
  writeJson(path.join(directory, 'catalogSources.json'), registry);
  for (const { name, repository, missing, ref = 'a'.repeat(40), legacy = false } of sources) {
    if (missing) continue;
    writeJson(path.join(directory, legacy ? `${name}.json` : catalogIndexFileName(name)), {
      catalog_version: 1,
      catalog_name: name,
      source_repository: repository,
      source_ref: ref,
      resources: [fixtureAgent],
    });
  }
}

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-catalog-review-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const target = path.join(root, 'project');
  for (const directory of [home, target]) fs.mkdirSync(directory);
  const config = path.join(root, 'config');
  const ghScript = path.join(root, 'gh.cjs');
  fs.writeFileSync(
    ghScript,
    `
    const args = JSON.stringify(process.argv.slice(2));
    if (args === '["--version"]') console.log('gh version 2.0.0');
    else if (args === '["skill","--help"]') console.log('gh skill');
    else throw new Error('Unexpected gh invocation: ' + args);
  `,
  );
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    KITIA_CONFIG_DIR: config,
    KITIA_TEST_GH_SCRIPT: ghScript,
    GIT_ALLOW_PROTOCOL: 'file',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'),
    GIT_CONFIG_COUNT: '0',
  };
  return { root, home, target, config, env };
}

function invoke({ target, env }, args) {
  const result = spawnSync(process.execPath, ['--require', ghPreload, executable, ...args], {
    cwd: target,
    env,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  return { ...result, json: args.includes('--json') ? JSON.parse(result.stdout) : undefined };
}

function snapshot(directory) {
  return fs
    .readdirSync(directory, { recursive: true, withFileTypes: true })
    .map((entry) => {
      const file = path.join(entry.parentPath, entry.name);
      return [path.relative(directory, file), entry.isDirectory() ? null : fs.readFileSync(file)];
    })
    .sort(([left], [right]) => left.localeCompare(right));
}

function localRepository({ root, env }, id) {
  const upstream = path.join(root, 'upstream');
  const source = path.join(upstream, fixtureAgent.source_path);
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, agentBytes);
  const git = (...args) => execFileSync('git', ['-C', upstream, ...args], { env, encoding: 'utf8' });
  git('init', '--quiet');
  git('add', '.');
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '-m',
    'Fixture agent',
  );
  const repository = `https://github.com/${id}`;
  const rewrite = `url.${pathToFileURL(upstream).href}.insteadOf`;
  Object.assign(env, {
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: rewrite,
    GIT_CONFIG_VALUE_0: repository,
    GIT_CONFIG_KEY_1: rewrite,
    GIT_CONFIG_VALUE_1: `${repository}.git`,
  });
  return { repository, ref: git('rev-parse', 'HEAD').trim() };
}

for (const problem of ['missing', 'invalid']) {
  test(`executable discovery isolates a ${problem} catalog index and reports only that catalog`, (t) => {
    const state = workspace(t);
    catalogFixture(state.config, [
      { name: 'Healthy', repository: 'example/healthy' },
      { name: 'Unavailable', repository: 'example/unavailable', missing: problem === 'missing', ref: 'invalid-pin' },
    ]);
    const detail = problem === 'missing' ? /index not found/i : /source_ref.*40-character/i;
    function assertUnavailable(result) {
      assert.equal(result.status, 1, result.stderr);
      const warning = JSON.parse(result.stderr);
      assert.equal(warning.catalog, 'Unavailable');
      assert.equal(warning.code, 'CATALOG_UNAVAILABLE');
      assert.match(warning.message, detail);
    }
    for (const command of [['list'], ['search', 'demo-agent']]) {
      const all = invoke(state, [...command, '--json']);
      assertUnavailable(all);
      assert.deepEqual(
        all.json.map(({ catalog, id }) => ({ catalog, id })),
        [{ catalog: 'Healthy', id: fixtureAgent.id }],
      );
      const healthy = invoke(state, [...command, '--catalog', 'Healthy', '--json']);
      assert.equal(healthy.status, 0, healthy.stderr);
      assert.equal(healthy.stderr, '');
      assert.deepEqual(healthy.json, all.json);
      const unavailable = invoke(state, [...command, '--catalog', 'Unavailable', '--json']);
      assertUnavailable(unavailable);
      assert.deepEqual(unavailable.json, []);
    }
  });
}

test('native executable ignores the historical home config for reads and catalog writes', (t) => {
  const state = workspace(t);
  const legacy = path.join(state.home, '.config', 'kiti');
  const current = path.join(state.home, '.config', 'kitia');
  catalogFixture(legacy, [{ name: 'Historical', repository: 'example/historical', missing: true }]);
  const originalLegacy = snapshot(legacy);
  delete state.env.KITIA_CONFIG_DIR;
  const listed = invoke(state, ['catalog', 'list']);
  assert.equal(listed.status, 0, listed.stderr);
  assert.equal(listed.stdout.trim(), '');
  const dashboard = invoke(state, ['dashboard', '--non-interactive']);
  assert.equal(dashboard.status, 0, dashboard.stdout + dashboard.stderr);
  assert.equal(fs.existsSync(current), false);
  const { repository } = localRepository(state, 'example/current');
  const added = invoke(state, ['catalog', 'add', 'Current', repository]);
  assert.equal(added.status, 0, added.stderr);
  assert.equal(fs.existsSync(path.join(current, 'catalogSources.json')), true);
  assert.deepEqual(snapshot(legacy), originalLegacy);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(current, 'catalogSources.json'), 'utf8')).sources.map(({ name }) => name),
    ['Current'],
  );
  const currentList = invoke(state, ['catalog', 'list']);
  assert.equal(currentList.status, 0, currentList.stderr);
  assert.match(currentList.stdout, /Current/);
  const override = invoke({ ...state, env: { ...state.env, KITIA_CONFIG_DIR: legacy } }, ['catalog', 'list']);
  assert.equal(override.status, 0, override.stderr);
  assert.match(override.stdout, /Historical/);
  assert.deepEqual(snapshot(legacy), originalLegacy);
});

test('executable uninstall selects removed catalog ownership and refuses nonowners without changes', (t) => {
  const state = workspace(t);
  catalogFixture(state.config, [{ name: 'Available', repository: 'example/available' }]);
  const { repository } = localRepository(state, 'example/retired');
  const added = invoke(state, ['catalog', 'add', 'Retired Kit', repository]);
  assert.equal(added.status, 0, added.stderr);
  const installed = invoke(state, ['install', 'agent', fixtureAgent.id, '--catalog', 'Retired Kit']);
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  const destination = path.join(state.target, '.github', 'agents', `${fixtureAgent.id}.agent.md`);
  assert.deepEqual(fs.readFileSync(destination), agentBytes);
  const removed = invoke(state, ['catalog', 'remove', 'Retired Kit']);
  assert.equal(removed.status, 0, removed.stderr);
  const listed = invoke(state, ['catalog', 'list']);
  assert.equal(listed.status, 0, listed.stderr);
  assert.equal(listed.stdout.trim(), 'Available\thttps://github.com/example/available');

  const originalTarget = snapshot(state.target);
  const originalConfig = snapshot(state.config);
  for (const [catalog, error] of [
    ['Unknown', /Unknown catalog: Unknown/],
    ['Available', /No tracked source installation for agent:demo-agent/],
  ]) {
    const rejected = invoke(state, ['uninstall', 'agent', fixtureAgent.id, '--catalog', catalog]);
    assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
    assert.match(rejected.stderr, error);
    assert.deepEqual(snapshot(state.target), originalTarget);
    assert.deepEqual(snapshot(state.config), originalConfig);
  }
  const uninstalled = invoke(state, ['uninstall', 'agent', fixtureAgent.id, '--catalog', 'rETIRED kIT']);
  assert.equal(uninstalled.status, 0, uninstalled.stdout + uninstalled.stderr);
  assert.match(uninstalled.stdout, /Removed Retired Kit catalog agent:/);
  assert.equal(fs.existsSync(destination), false);
  const inventory = JSON.parse(fs.readFileSync(path.join(state.target, '.agents', 'kitia-lock.json'), 'utf8'));
  assert.deepEqual(inventory.sources, {});
  assert.deepEqual(snapshot(state.config), originalConfig);
});

test('dashboard case-only rename preserves CLI discovery and validation on the local filesystem', async (t) => {
  const state = workspace(t);
  const id = 'example/case-rename';
  const { repository, ref } = localRepository(state, id);
  const reserved = invoke(state, ['catalog', 'add', 'CATALOGSOURCES', repository]);
  assert.equal(reserved.status, 1);
  assert.match(reserved.stderr, /reserved/i);
  assert.equal(fs.existsSync(state.config), false);

  catalogFixture(state.config, [{ name: 'Team Alpha', repository: id, ref, legacy: true }]);
  const worker = new Worker(dashboardWorker, {
    env: state.env,
    execArgv: ['--require', ghPreload],
    workerData: {
      task: 'catalog-update',
      originalName: 'Team Alpha',
      request: { name: 'TEAM ALPHA', repository, mode: 'basic', entries: [] },
    },
  });
  let response;
  try {
    [response] = await Promise.race([
      once(worker, 'message'),
      once(worker, 'exit').then(([code]) => assert.fail(`Catalog worker exited ${code} before reporting a result`)),
    ]);
  } finally {
    await worker.terminate();
  }
  assert.equal(response.ok, true, response.error?.message);
  const discovered = invoke(state, ['list', '--catalog', 'team alpha', '--json']);
  assert.equal(discovered.status, 0, discovered.stderr);
  assert.equal(discovered.stderr, '');
  assert.deepEqual(
    discovered.json.map(({ catalog, id: resource }) => [catalog, resource]),
    [['TEAM ALPHA', fixtureAgent.id]],
  );
  const validated = invoke(state, ['validate']);
  assert.equal(validated.status, 0, validated.stderr);
  assert.match(validated.stdout, /Validated 1 resources/);
  const files = snapshot(path.join(state.config, 'source-catalogs'))
    .filter(([, bytes]) => bytes !== null)
    .map(([file]) => file);
  assert.deepEqual(files.sort(), [path.normalize(catalogIndexFileName('TEAM ALPHA')), 'catalogSources.json'].sort());
});
