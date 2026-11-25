'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createSourceIndex } = require('../dist/core/catalogs/discovery.js');
const { recordSourceInstallation } = require('../dist/core/inventory/inventory.js');
const { runDashboardWorker } = require('../dist/cli/commands.js');
const { setupTemporaryDirectory, writeJson, createSource } = require('./fixtures/source-catalog-fixtures.js');
const { waitForOutput } = require('../src/tui/__tests__/dashboard-frames.js');

const makeTemporaryDirectory = setupTemporaryDirectory();

test('removing an unmanaged skill deletes its entire detected folder', async () => {
  const temporary = makeTemporaryDirectory('kitia-dashboard-unmanaged-remove-');
  const configDirectory = path.join(temporary, 'config');
  const target = path.join(temporary, 'project');
  const userTarget = path.join(temporary, 'user');
  const skillDirectory = path.join(target, '.agents/skills/manual-skill');
  const previousConfigDirectory = process.env.KITIA_CONFIG_DIR;
  fs.mkdirSync(configDirectory, { recursive: true });
  fs.mkdirSync(skillDirectory, { recursive: true });
  fs.mkdirSync(userTarget, { recursive: true });
  const entryFile = path.join(skillDirectory, 'SKILL.md');
  const extraFile = path.join(skillDirectory, 'reference.txt');
  fs.writeFileSync(entryFile, 'Unmanaged skill entry point.');
  fs.writeFileSync(extraFile, 'User-owned supporting file.');
  process.env.KITIA_CONFIG_DIR = configDirectory;
  try {
    const result = await runDashboardWorker({
      task: 'resource-action',
      action: 'remove-unmanaged',
      resource: {
        catalog: '-',
        kind: 'skill',
        id: 'manual-skill',
        scope: 'project',
        managed: false,
      },
      dashboardOptions: { target, userTarget },
      catalogs: { sourceResources: [] },
      installOptions: {},
    });
    assert.equal(result.code, 0);
    assert.equal(fs.existsSync(skillDirectory), false);
    assert.equal(fs.existsSync(entryFile), false);
    assert.equal(fs.existsSync(extraFile), false);
    assert.ok(!result.resources.some((resource) => resource.id === 'manual-skill'));
  } finally {
    if (previousConfigDirectory === undefined) delete process.env.KITIA_CONFIG_DIR;
    else process.env.KITIA_CONFIG_DIR = previousConfigDirectory;
  }
});

test('real GH update progress and sanitized output reach the TUI through its worker', async () => {
  const { PassThrough } = require('node:stream');
  const { runDashboard } = await import('../dist/tui/dashboard.mjs');
  const temporary = makeTemporaryDirectory('kitia-worker-progress-');
  const configDirectory = path.join(temporary, 'config');
  const sourceIndexDirectory = path.join(configDirectory, 'source-catalogs');
  const target = path.join(temporary, 'project');
  const userTarget = path.join(temporary, 'user');
  const ghScript = path.join(temporary, 'gh.js');
  const ghPreload = path.join(temporary, 'gh-spawn-preload.cjs');
  const repository = 'https://github.com/example/worker-progress';
  const previousEnvironment = Object.fromEntries(
    ['KITIA_CONFIG_DIR', 'KITIA_TEST_SKILL_CONTENT', 'KITIA_TEST_GH_SCRIPT'].map((key) => [key, process.env[key]]),
  );
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(userTarget, { recursive: true });
  fs.writeFileSync(
    ghPreload,
    [
      'const childProcess = require("node:child_process");',
      'const originalSpawn = childProcess.spawn;',
      'childProcess.spawn = (command, args, options) => command === "gh"',
      '  ? originalSpawn(process.execPath, [process.env.KITIA_TEST_GH_SCRIPT, ...args], options)',
      '  : originalSpawn(command, args, options);',
      '',
    ].join('\n'),
  );
  const source = createSource(temporary, 'worker-progress-upstream', repository);
  const oldRef = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  fs.appendFileSync(path.join(source, 'skills', 'demo-skill', 'SKILL.md'), '\nSecond source revision.\n');
  execFileSync('git', ['-C', source, 'add', '.']);
  execFileSync('git', [
    '-C',
    source,
    '-c',
    'user.name=Catalog fixtures',
    '-c',
    'user.email=fixtures@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '-m',
    'Update synthetic skill',
  ]);
  const sourceIndex = createSourceIndex(repository, 'Test', source);
  const newResource = {
    ...sourceIndex.resources.find(({ kind }) => kind === 'skill'),
    catalog: 'Test',
    source_repository: sourceIndex.source_repository,
    source_ref: sourceIndex.source_ref,
  };
  const newRef = sourceIndex.source_ref;
  const skillPath = `.agents/skills/${newResource.id}/SKILL.md`;
  const skillFile = path.join(target, skillPath);
  const makeSkill = (ref) =>
    [
      '---',
      `name: ${newResource.id}`,
      'description: Worker progress fixture.',
      'metadata:',
      `  github-repo: "https://github.com/${newResource.source_repository}"`,
      `  github-path: "${newResource.source_path}"`,
      `  github-pinned: "${ref}"`,
      '---',
      '',
      'Fixture skill.',
      '',
    ].join('\n');
  fs.mkdirSync(path.dirname(skillFile), { recursive: true });
  fs.writeFileSync(skillFile, makeSkill(oldRef));
  recordSourceInstallation({ ...newResource, source_ref: oldRef }, target, skillPath);
  writeJson(path.join(configDirectory, 'catalogSources.json'), {
    catalog_version: 1,
    sources: [{ name: 'Test', repository }],
  });
  writeJson(path.join(sourceIndexDirectory, 'catalogSources.json'), {
    catalog_version: 1,
    sources: [{ name: 'Test', repository }],
  });
  writeJson(path.join(sourceIndexDirectory, 'Test.json'), sourceIndex);

  fs.writeFileSync(
    ghScript,
    [
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      'const args = process.argv.slice(2);',
      'const file = path.join(args[args.indexOf("--dir") + 1], args[3].split("/").at(-1), "SKILL.md");',
      `const output = ${JSON.stringify('\u001b[32mFetching https://user:passsecret@example.invalid/resource?token=querysecret token=verysecretcredential\u001b[0m\n')};`,
      'setTimeout(() => process.stdout.write(output), 500);',
      'setTimeout(() => { fs.writeFileSync(file, process.env.KITIA_TEST_SKILL_CONTENT); process.exit(0); }, 800);',
      '',
    ].join('\n'),
  );
  process.env.KITIA_CONFIG_DIR = configDirectory;
  process.env.KITIA_TEST_SKILL_CONTENT = makeSkill(newRef);
  process.env.KITIA_TEST_GH_SCRIPT = ghScript;

  const installedResource = {
    ...newResource,
    source_ref: oldRef,
    scope: 'project',
    status: 'attention',
    managed: true,
    paths: [skillPath],
    issues: [{ code: 'UPDATE_AVAILABLE', paths: [skillPath] }],
  };
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 120;
  output.rows = 40;
  let rendered = '';
  output.on('data', (chunk) => {
    rendered += chunk.toString();
  });
  const done = runDashboard([installedResource], input, output, [], {
    catalogResources: [newResource],
    listSourceVersions: async () => [
      {
        sha: oldRef,
        prefix: oldRef.slice(0, 7),
        date: '2026-11-09T00:00:00Z',
        subject: 'Installed pin',
      },
      {
        sha: newRef,
        prefix: newRef.slice(0, 7),
        date: '2026-11-08T00:00:00Z',
        subject: 'Selected update',
      },
    ],
    execute: (action, resource, options) => {
      const { onProgress, ...installOptions } = options;
      return runDashboardWorker(
        {
          task: 'resource-action',
          action,
          resource,
          dashboardOptions: { target, userTarget },
          catalogs: { sourceResources: [newResource] },
          installOptions,
        },
        onProgress,
        { execArgv: ['--require', ghPreload] },
      );
    },
  });
  const visibleFrame = () => {
    const start = rendered.lastIndexOf('\u001b[?2026h');
    const end = rendered.indexOf('\u001b[?2026l', start);
    return start >= 0 && end > start ? require('node:util').stripVTControlCharacters(rendered.slice(start, end)) : '';
  };
  const waitForFrame = (predicate, message) =>
    waitForOutput(output, visibleFrame, predicate, `dashboard ${message}`, 10_000);
  let finished = false;
  try {
    await waitForFrame((frame) => frame.includes('↑↓ navigate'), 'Inventory');
    input.write('b');
    await waitForFrame((frame) => frame.includes('CATALOG RESOURCES'), 'Catalog');
    input.write('v');
    await waitForFrame((frame) => frame.includes('RESOURCE REVISIONS'), 'version picker');
    input.write('\x1b[B');
    await waitForFrame((frame) => frame.includes(`› ${newRef.slice(0, 7)}`), 'selected commit');
    input.write('\r');
    await waitForFrame((frame) => frame.includes('CONFIRM UPDATE'), 'update confirmation');
    input.write('y');
    const phase = await waitForFrame(
      (frame) => frame.includes(`Invoking GitHub CLI to update ${newResource.id} for standard`),
      "the actual worker's GitHub update phase",
    );
    assert.ok(phase.includes('Invoking GitHub CLI to update'));
    const ghOutput = await waitForFrame(
      (frame) => frame.includes('Fetching') && frame.includes('https://[REDACTED]@example.invalid/resource?[REDACTED]'),
      'sanitized GitHub progress output',
    );
    assert.ok(ghOutput.includes('token=[REDACTED]'));
    assert.doesNotMatch(ghOutput, /passsecret|querysecret|verysecretcredential|[\u001b]/);
    for (
      let attempt = 0;
      attempt < 100 && !fs.readFileSync(skillFile, 'utf8').includes(`github-pinned: "${newRef}"`);
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(fs.readFileSync(skillFile, 'utf8').includes(`github-pinned: "${newRef}"`));
    await waitForFrame((frame) => frame.includes('Q quit') && !frame.includes('LOADING'), 'completed update result');
    input.write('q');
    let exitTimeout;
    const exited = await Promise.race([
      done,
      new Promise((_, reject) => {
        exitTimeout = setTimeout(() => reject(new Error('Dashboard did not exit after q')), 5_000);
      }),
    ]).finally(() => clearTimeout(exitTimeout));
    assert.equal(exited, true);
    finished = true;
  } finally {
    input.destroy();
    if (!finished) {
      let cleanupTimeout;
      await Promise.race([
        done.catch(() => {}),
        new Promise((resolve) => {
          cleanupTimeout = setTimeout(resolve, 5_000);
        }),
      ]).finally(() => clearTimeout(cleanupTimeout));
    }
    output.destroy();
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
