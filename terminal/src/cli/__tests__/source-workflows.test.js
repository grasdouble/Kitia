'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createSourceIndex } = require('../../core/catalogs/discovery.ts');
const { recordSourceInstallation, readInstallState } = require('../../core/inventory/inventory.ts');
const { runSourceOperation } = require('../../core/installations/lifecycle.ts');
const { loadCommandCatalogs } = require('../loading.ts');
const { collectInstalledScopes } = require('../../core/inventory/checks.ts');
const { parseArguments } = require('../arguments.ts');
const { executeCommand } = require('../commands.ts');
const {
  setupTemporaryDirectory,
  writeJson,
  createSource,
  nodeScriptSpawn,
} = require('../../../test/fixtures/source-catalog-fixtures.js');

const makeTemporaryDirectory = setupTemporaryDirectory();

test('onboarding defaults its project scan to the current directory', () => {
  const temporary = makeTemporaryDirectory('kitia-onboarding-target-');
  const previousCwd = process.cwd();
  try {
    process.chdir(temporary);
    const options = parseArguments(['onboarding']);
    assert.equal(options.target, '.');
    assert.deepEqual(collectInstalledScopes({ project: options.target, user: temporary }, []).errors, []);
  } finally {
    process.chdir(previousCwd);
  }
});

test('dashboard refreshes its source catalog set before rebuilding installed skills', async () => {
  const temporary = makeTemporaryDirectory('kitia-dashboard-source-refresh-');
  const configDirectory = path.join(temporary, 'config');
  const catalogDirectory = path.join(configDirectory, 'source-catalogs');
  const target = path.join(temporary, 'project');
  const repository = 'https://github.com/example/dashboard-skill';
  const source = createSource(temporary, 'upstream', repository);
  const registry = { catalog_version: 1, sources: [{ name: 'Test', repository }] };
  const previousConfigDirectory = process.env.KITIA_CONFIG_DIR;
  process.env.KITIA_CONFIG_DIR = configDirectory;
  try {
    const userTarget = path.join(temporary, 'user');
    fs.mkdirSync(userTarget, { recursive: true });
    fs.mkdirSync(target, { recursive: true });
    writeJson(path.join(configDirectory, 'catalogSources.json'), registry);
    writeJson(path.join(catalogDirectory, 'catalogSources.json'), registry);
    writeJson(path.join(catalogDirectory, 'Test.json'), createSourceIndex(repository, 'Test', source));
    const resource = loadCommandCatalogs({ command: 'list' }, () => {}).sourceResources.find(
      ({ id }) => id === 'demo-skill',
    );
    assert.ok(resource);

    const result = runSourceOperation(
      {
        action: 'install',
        resource,
        target,
        scope: 'project',
        tool: 'copilot',
      },
      (_args, installTarget) => {
        const skillFile = path.join(installTarget, '.agents/skills/demo-skill/SKILL.md');
        fs.mkdirSync(path.dirname(skillFile), { recursive: true });
        fs.writeFileSync(
          skillFile,
          [
            '---',
            'name: demo-skill',
            'description: Installed from a source catalog.',
            'metadata:',
            `  github-repo: "${resource.source_repository}"`,
            `  github-path: "${resource.source_path}"`,
            `  github-pinned: "${resource.source_ref}"`,
            '---',
            '',
            'Installed skill body.',
            '',
          ].join('\n'),
        );
        return 0;
      },
    );

    assert.equal(result.status, 0);
    const refreshedCatalogs = loadCommandCatalogs({ command: 'list' }, () => {});
    const refreshed = collectInstalledScopes({ project: target, user: userTarget }, refreshedCatalogs.sourceResources);
    assert.ok(
      refreshed.resources.some(
        (entry) => entry.catalog === 'Test' && entry.kind === 'skill' && entry.id === 'demo-skill',
      ),
      JSON.stringify(refreshed),
    );
  } finally {
    if (previousConfigDirectory === undefined) delete process.env.KITIA_CONFIG_DIR;
    else process.env.KITIA_CONFIG_DIR = previousConfigDirectory;
  }
});

test('CLI install --ref replaces only the selected scope and retains skill update safety', async () => {
  const temporary = makeTemporaryDirectory('kitia-cli-ref-replace-');
  const projectTarget = path.join(temporary, 'project');
  const userTarget = path.join(temporary, 'user');
  const oppositeOnlyTarget = path.join(temporary, 'opposite-only-project');
  const modifiedTarget = path.join(temporary, 'modified');
  const untrackedTarget = path.join(temporary, 'untracked');
  const configDirectory = path.join(temporary, 'config');
  const indexDirectory = path.join(configDirectory, 'source-catalogs');
  const binDirectory = path.join(temporary, 'bin');
  fs.mkdirSync(indexDirectory, { recursive: true });
  fs.mkdirSync(binDirectory);
  const catalogResource = {
    catalog: 'Test',
    kind: 'skill',
    id: 'demo-skill',
    source_repository: 'example/team-alpha',
    source_path: 'skills/demo-skill',
    source_ref: 'a'.repeat(40),
    license_status: 'MIT',
  };
  const seedTarget = (target) => {
    const directory = path.join(target, '.agents/skills/demo-skill');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'SKILL.md'),
      [
        '---',
        'name: demo-skill',
        'description: A source skill.',
        'metadata:',
        `  github-repo: "https://github.com/${catalogResource.source_repository}"`,
        `  github-path: "${catalogResource.source_path}"`,
        `  github-ref: "${catalogResource.source_ref}"`,
        `  github-pinned: "${catalogResource.source_ref}"`,
        '---',
        '',
        'Old installed body.',
        '',
      ].join('\n'),
    );
    recordSourceInstallation(catalogResource, target, 'github-copilot');
  };
  for (const target of [projectTarget, userTarget, modifiedTarget, untrackedTarget]) seedTarget(target);
  fs.mkdirSync(oppositeOnlyTarget);
  const modifiedFile = path.join(modifiedTarget, '.agents/skills/demo-skill/SKILL.md');
  fs.appendFileSync(modifiedFile, 'Local edit.\n');
  fs.writeFileSync(path.join(untrackedTarget, '.agents/skills/demo-skill/reference.md'), 'Untracked content.');
  writeJson(path.join(configDirectory, 'catalogSources.json'), {
    catalog_version: 1,
    sources: [{ name: 'Test', repository: 'https://github.com/example/team-alpha' }],
  });
  writeJson(path.join(indexDirectory, 'catalogSources.json'), {
    catalog_version: 1,
    sources: [{ name: 'Test', repository: 'https://github.com/example/team-alpha' }],
  });
  writeJson(path.join(indexDirectory, 'Test.json'), {
    catalog_version: 1,
    catalog_name: 'Test',
    source_repository: 'example/team-alpha',
    source_ref: catalogResource.source_ref,
    resources: [
      {
        kind: 'skill',
        id: catalogResource.id,
        source_path: catalogResource.source_path,
        description: 'A source skill.',
        license_status: 'MIT',
      },
    ],
  });
  const selectedRef = 'b'.repeat(40);
  const receivedPin = path.join(temporary, 'received-pin');
  fs.writeFileSync(
    path.join(binDirectory, 'gh'),
    [
      '#!/usr/bin/env node',
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      'const file = ".agents/skills/demo-skill/SKILL.md";',
      'const ref = process.argv[process.argv.indexOf("--pin") + 1];',
      'fs.writeFileSync(process.env.KITIA_TEST_GH_PIN, ref);',
      'fs.mkdirSync(path.dirname(file), { recursive: true });',
      'let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : `---\\nname: demo-skill\\ndescription: A source skill.\\nmetadata:\\n  github-repo: "https://github.com/example/team-alpha"\\n  github-path: "skills/demo-skill"\\n  github-ref: "${ref}"\\n  github-pinned: "${ref}"\\n---\\n\\nFresh install.\\n`;',
      'text = text.replace(/github-ref: "[^"]+"/, `github-ref: "${ref}"`).replace(/github-pinned: "[^"]+"/, `github-pinned: "${ref}"`).replace("Old installed body.", "Updated body.");',
      'fs.writeFileSync(file, text);',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  const previousConfig = process.env.KITIA_CONFIG_DIR;
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  const previousCwd = process.cwd();
  const previousPin = process.env.KITIA_TEST_GH_PIN;
  process.env.KITIA_CONFIG_DIR = configDirectory;
  process.env.KITIA_TEST_GH_PIN = receivedPin;
  const output = { log() {}, error() {} };
  const invoke = async (scope, target) => {
    const args =
      scope === 'user'
        ? ['install', 'skill', 'demo-skill', '--catalog', 'Test', '--ref', selectedRef, '--scope', 'user']
        : ['install', 'skill', 'demo-skill', '--catalog', 'Test', '--ref', selectedRef, '--target', target];
    const options = {
      ...parseArguments(args),
      nonInteractive: true,
      output,
      onProgress() {},
      spawnProcess: nodeScriptSpawn(path.join(binDirectory, 'gh')),
    };
    if (scope === 'user') assert.equal(options.target, userTarget);
    return executeCommand(options, null);
  };
  try {
    assert.equal(await invoke('project', projectTarget), 0);
    assert.equal(fs.readFileSync(receivedPin, 'utf8'), selectedRef, 'gh receives the requested full SHA via --pin');
    assert.equal(readInstallState(projectTarget).sources.Test.skills['demo-skill'].source_ref, selectedRef);
    assert.equal(readInstallState(userTarget).sources.Test.skills['demo-skill'].source_ref, catalogResource.source_ref);

    process.env.HOME = userTarget;
    process.env.USERPROFILE = userTarget;
    process.chdir(projectTarget);
    const projectRefBeforeUserReplacement =
      readInstallState(projectTarget).sources.Test.skills['demo-skill'].source_ref;
    assert.equal(await invoke('user', userTarget), 0);
    assert.equal(fs.readFileSync(receivedPin, 'utf8'), selectedRef);
    assert.equal(readInstallState(userTarget).sources.Test.skills['demo-skill'].source_ref, selectedRef);
    assert.equal(
      readInstallState(projectTarget).sources.Test.skills['demo-skill'].source_ref,
      projectRefBeforeUserReplacement,
      'user-scope replacement leaves the project installation unchanged',
    );

    await assert.rejects(
      invoke('project', modifiedTarget),
      (error) => error.code === 'LOCAL_CONFLICT' && error.category === 'tracked-modification',
    );
    assert.match(fs.readFileSync(modifiedFile, 'utf8'), /Local edit\./);
    await assert.rejects(
      invoke('project', untrackedTarget),
      (error) => error.code === 'LOCAL_CONFLICT' && error.category === 'untracked-skill-content',
    );
    assert.equal(
      readInstallState(modifiedTarget).sources.Test.skills['demo-skill'].source_ref,
      catalogResource.source_ref,
    );
    assert.equal(
      readInstallState(untrackedTarget).sources.Test.skills['demo-skill'].source_ref,
      catalogResource.source_ref,
    );
    assert.equal(await invoke('project', oppositeOnlyTarget), 0);
    assert.equal(fs.readFileSync(receivedPin, 'utf8'), selectedRef);
    assert.equal(readInstallState(oppositeOnlyTarget).sources.Test.skills['demo-skill'].source_ref, selectedRef);

    process.env.HOME = userTarget;
    process.env.USERPROFILE = userTarget;
    process.chdir(userTarget);
    await assert.rejects(
      invoke('project', userTarget),
      (error) =>
        error.code === 'AMBIGUOUS_RESOURCE' && /project and user scopes resolve to the same target/.test(error.message),
    );
    await assert.rejects(
      invoke('user', userTarget),
      (error) =>
        error.code === 'AMBIGUOUS_RESOURCE' && /project and user scopes resolve to the same target/.test(error.message),
    );
  } finally {
    if (previousConfig === undefined) delete process.env.KITIA_CONFIG_DIR;
    else process.env.KITIA_CONFIG_DIR = previousConfig;
    if (previousPin === undefined) delete process.env.KITIA_TEST_GH_PIN;
    else process.env.KITIA_TEST_GH_PIN = previousPin;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousUserProfile;
    process.chdir(previousCwd);
  }
});
