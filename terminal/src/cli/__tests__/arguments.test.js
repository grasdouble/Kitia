'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { parseArguments } = require('../arguments.ts');

test('audit is opt-in and only available for preview and install', () => {
  assert.equal(parseArguments(['preview', 'agent', 'demo', '--audit']).audit, true);
  assert.equal(parseArguments(['install', 'agent', 'demo', '--audit']).audit, true);
  assert.throws(() => parseArguments(['list', '--audit']), /only supported for source preview and install/);
});

test('collection commands parse optional key files without changing catalog export parsing', () => {
  assert.deepEqual(parseArguments(['collection', 'export', 'team.json', 'Team:agent:release-helper']), {
    command: 'collection',
    action: 'export',
    file: 'team.json',
    resourceSelectors: ['Team:agent:release-helper'],
  });
  assert.deepEqual(
    parseArguments(['collection', 'export', 'team.json', 'Team:agent:release-helper', '--signing-key', 'private.pem']),
    {
      command: 'collection',
      action: 'export',
      file: 'team.json',
      signingKey: 'private.pem',
      resourceSelectors: ['Team:agent:release-helper'],
    },
  );
  assert.deepEqual(parseArguments(['collection', 'import', 'team.json', '--trusted-key', 'approved.pem']), {
    command: 'collection',
    action: 'import',
    file: 'team.json',
    trustedKey: 'approved.pem',
  });
  assert.equal(parseArguments(['catalog', 'export', 'catalogs.json']).action, 'export');
  assert.throws(
    () => parseArguments(['collection', 'export', 'team.json', 'Team:agent:../bad']),
    /Invalid resource selector/,
  );
  assert.throws(
    () => parseArguments(['collection', 'export', 'team.json', '--signing-key']),
    /requires a PEM file path/,
  );
  assert.throws(() => parseArguments(['collection', 'import', 'team.json', '--trusted-key']), /Usage:/);
});

test('catalog presets resolve to their repositories', () => {
  for (const [preset, name, repository] of [
    ['matt-pocock', 'matt-pocock', 'https://github.com/mattpocock/skills'],
    ['anthropics', 'Anthropics', 'https://github.com/anthropics/skills'],
    ['github-awesome-copilot', 'github-awesome-copilot', 'https://github.com/github/awesome-copilot'],
  ]) {
    assert.deepEqual(parseArguments(['catalog', 'add', preset]), {
      command: 'catalog',
      action: 'add',
      name,
      repository,
    });
  }
});

test('onboarding and no-argument invocations select their default targets', () => {
  const previousCwd = process.cwd();
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-onboarding-args-'));
  try {
    process.chdir(temporary);
    assert.equal(parseArguments(['onboarding']).target, '.');
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  assert.deepEqual(parseArguments([]), { command: 'dashboard', target: '.' });
});

test('versions and install/update arguments select every source kind and validate refs', () => {
  const sha = 'c'.repeat(40);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-versions-args-'));
  const previous = process.env.KITIA_CONFIG_DIR;
  process.env.KITIA_CONFIG_DIR = temporary;
  fs.writeFileSync(
    path.join(temporary, 'catalogSources.json'),
    JSON.stringify({
      catalog_version: 1,
      sources: [{ name: 'Test', repository: 'https://github.com/example/resources' }],
    }),
  );
  try {
    for (const kind of ['skill', 'agent', 'instruction']) {
      assert.deepEqual(parseArguments(['versions', kind, 'demo-resource', '--catalog', 'Test']), {
        command: 'versions',
        kind,
        id: 'demo-resource',
        catalog: 'Test',
      });
      assert.equal(parseArguments(['install', kind, 'demo-resource', '--ref', sha]).ref, sha);
      assert.equal(parseArguments(['update', kind, 'demo-resource', '--ref', sha.slice(0, 7)]).ref, sha.slice(0, 7));
    }
  } finally {
    if (previous === undefined) delete process.env.KITIA_CONFIG_DIR;
    else process.env.KITIA_CONFIG_DIR = previous;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  assert.throws(
    () => parseArguments(['install', 'skill', 'demo-skill', '--ref', 'abc']),
    /7- to 40-character hexadecimal/,
  );
  assert.throws(
    () => parseArguments(['install', 'skill', 'demo-skill', '--ref', 'g'.repeat(7)]),
    /7- to 40-character hexadecimal/,
  );
  assert.throws(
    () => parseArguments(['update', '--ref', sha]),
    /specific skill, agent, or instruction install or update/,
  );
});

test('removed bundle commands and offline installs are rejected', () => {
  assert.throws(
    () => parseArguments(['bundle', 'export', 'bundle.json', 'Team:skill:demo-skill', '--signing-key', 'private.pem']),
    /Unknown command: bundle/,
  );
  assert.throws(() => parseArguments(['install', 'skill', 'demo-skill', '--offline']), /Unknown option: --offline/);
});
