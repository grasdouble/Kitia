'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createSourceIndex } = require('../dist/core/catalogs/discovery.js');
const { recordSourceInstallation } = require('../dist/core/inventory/inventory.js');
const { executeInstallationOperation } = require('../dist/core/installations/lifecycle.js');
const { main: runCliMain } = require('../dist/kitia.js');
const { setupTemporaryDirectory, writeJson, createSource } = require('./fixtures/source-catalog-fixtures.js');

const makeTemporaryDirectory = setupTemporaryDirectory();

test('dashboard update reaches the production CLI and reports a safe local-conflict failure', async () => {
  const temporary = makeTemporaryDirectory('kitia-dashboard-update-cli-');
  const configDirectory = path.join(temporary, 'config');
  const sourceIndexDirectory = path.join(configDirectory, 'source-catalogs');
  const target = path.join(temporary, 'project');
  const repository = 'https://github.com/example/dashboard-update';
  const previousConfigDirectory = process.env.KITIA_CONFIG_DIR;
  process.env.KITIA_CONFIG_DIR = configDirectory;
  fs.mkdirSync(target, { recursive: true });
  const source = createSource(temporary, 'dashboard-update-cli-upstream', repository);
  const configuration = { catalog_version: 1, sources: [{ name: 'Test', repository }] };
  writeJson(path.join(configDirectory, 'catalogSources.json'), configuration);
  writeJson(path.join(sourceIndexDirectory, 'catalogSources.json'), configuration);
  const index = createSourceIndex(repository, 'Test', source);
  writeJson(path.join(sourceIndexDirectory, 'Test.json'), index);
  const resource = {
    ...index.resources[0],
    catalog: 'Test',
    source_repository: index.source_repository,
    source_ref: index.source_ref,
    scope: 'project',
    managed: true,
  };
  const skillFile = path.join(target, '.agents/skills/demo-skill/SKILL.md');
  fs.mkdirSync(path.dirname(skillFile), { recursive: true });
  fs.writeFileSync(
    skillFile,
    [
      '---',
      'name: demo-skill',
      'description: A generated source skill.',
      'metadata:',
      `  github-repo: "https://github.com/${resource.source_repository}"`,
      `  github-path: "${resource.source_path}"`,
      `  github-ref: "${resource.source_ref}"`,
      `  github-pinned: "${resource.source_ref}"`,
      '---',
      '',
      'Synthetic installed skill.',
      '',
    ].join('\n'),
  );

  try {
    recordSourceInstallation(resource, target, 'github-copilot');
    fs.writeFileSync(skillFile, 'Locally modified content that the updater must protect.\n');
    await assert.rejects(
      executeInstallationOperation(
        {
          operation: 'update',
          resource,
          id: resource.id,
          kind: resource.kind,
          target,
          scope: 'project',
          tool: 'copilot',
        },
        [resource],
      ),
      /Refusing to overwrite locally modified .*demo-skill.*SKILL\.md.*--force/,
    );
    const originalLog = console.log;
    const output = [];
    console.log = (line) => output.push(line);
    try {
      assert.equal(await runCliMain(['update', 'skill', 'demo-skill', '--target', target, '--dry-run', '--json']), 1);
    } finally {
      console.log = originalLog;
    }
    const report = JSON.parse(output.join('\n'));
    assert.equal(report.errors[0].code, 'LOCAL_CONFLICT');
    assert.match(report.errors[0].message, /locally modified/);
    assert.equal(fs.readFileSync(skillFile, 'utf8'), 'Locally modified content that the updater must protect.\n');
  } finally {
    if (previousConfigDirectory === undefined) delete process.env.KITIA_CONFIG_DIR;
    else process.env.KITIA_CONFIG_DIR = previousConfigDirectory;
  }
});
