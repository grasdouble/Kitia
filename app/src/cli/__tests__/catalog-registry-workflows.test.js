'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const { updateCatalog } = require('../../core/catalogs/manage.ts');
const { createSourceIndex } = require('../../core/catalogs/discovery.ts');
const { manageCatalogCommand } = require('../catalog-command.ts');
const { loadUserSourceConfiguration, catalogIndexFileName } = require('../../core/catalogs/config.ts');
const { loadCommandCatalogs } = require('../loading.ts');
const { parseArguments } = require('../arguments.ts');
const {
  setupTemporaryDirectory,
  writeJson,
  createSource,
} = require('../../../test/fixtures/source-catalog-fixtures.js');

const makeTemporaryDirectory = setupTemporaryDirectory();

test('user catalogs can be added, listed and removed without repository manifests', () => {
  const temporary = makeTemporaryDirectory('kitia-user-catalog-lifecycle-');
  const repository = 'https://github.com/example/user-catalog';
  const upstream = createSource(temporary, 'upstream', repository);
  const configDirectory = path.join(temporary, 'config');
  const environmentKeys = ['KITIA_CONFIG_DIR', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0'];
  const previousEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  process.env.KITIA_CONFIG_DIR = configDirectory;
  process.env.GIT_CONFIG_COUNT = '1';
  process.env.GIT_CONFIG_KEY_0 = `url.${pathToFileURL(upstream).href}.insteadOf`;
  process.env.GIT_CONFIG_VALUE_0 = repository;
  const run = (args) => {
    const logs = [];
    const errors = [];
    try {
      const code = manageCatalogCommand({
        ...parseArguments(['catalog', ...args]),
        output: { log: (message) => logs.push(message), error: (message) => errors.push(message) },
      });
      return { code, logs, errors };
    } catch (error) {
      errors.push(error.message);
      return { code: 1, logs, errors };
    }
  };
  try {
    const reserved = run(['add', 'CATALOGSOURCES', repository]);
    assert.equal(reserved.code, 1);
    assert.match(reserved.errors.join('\n'), /reserved/i);
    const added = run(['add', 'team-alpha', repository]);
    assert.equal(added.code, 0, added.errors.join('\n'));
    assert.match(added.logs.join('\n'), /Added catalog team-alpha/);
    assert.deepEqual(run(['list']).logs, [`team-alpha\t${repository}`]);
    const indexDirectory = path.join(configDirectory, 'source-catalogs');
    const canonicalIndex = path.join(indexDirectory, catalogIndexFileName('team-alpha'));
    assert.equal(fs.existsSync(canonicalIndex), true);
    const loaded = loadCommandCatalogs({ command: 'list', catalog: 'team-alpha' }, () => {});
    assert.ok(loaded.sourceResources.length > 0);
    assert.ok(loaded.sourceResources.every((resource) => resource.catalog === 'team-alpha'));
    writeJson(path.join(indexDirectory, 'team-alpha.json'), JSON.parse(fs.readFileSync(canonicalIndex, 'utf8')));
    assert.equal(catalogIndexFileName('team-alpha'), catalogIndexFileName('TEAM-ALPHA'));
    updateCatalog('team-alpha', 'TEAM-ALPHA', repository);
    assert.equal(JSON.parse(fs.readFileSync(canonicalIndex, 'utf8')).catalog_name, 'TEAM-ALPHA');
    assert.equal(fs.existsSync(path.join(indexDirectory, 'team-alpha.json')), false);
    assert.deepEqual(
      loadUserSourceConfiguration().map(({ name }) => name),
      ['TEAM-ALPHA'],
    );
    assert.equal(parseArguments(['list', '--catalog', 'team-alpha']).catalog, 'TEAM-ALPHA');
    assert.equal(run(['remove', 'TEAM-ALPHA']).code, 0);
    assert.deepEqual(loadUserSourceConfiguration(), []);
    assert.equal(fs.existsSync(canonicalIndex), false);
  } finally {
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('catalog refresh updates one or all configured user indexes', () => {
  const temporary = makeTemporaryDirectory('kitia-refresh-catalog-');
  const repositoryUrls = ['https://github.com/example/refresh-alpha', 'https://github.com/example/refresh-beta'];
  const alpha = createSource(temporary, 'alpha-upstream', repositoryUrls[0]);
  const beta = createSource(temporary, 'beta-upstream', repositoryUrls[1]);
  const configDirectory = path.join(temporary, 'config');
  const sourceIndexDirectory = path.join(configDirectory, 'source-catalogs');
  const alphaIndexFile = path.join(sourceIndexDirectory, catalogIndexFileName('Alpha'));
  const betaIndexFile = path.join(sourceIndexDirectory, catalogIndexFileName('Beta'));
  const betaEntry = {
    kind: 'instruction',
    id: 'review-policy',
    path: 'policies/review-policy.instructions.md',
  };
  fs.mkdirSync(path.dirname(path.join(beta, betaEntry.path)), { recursive: true });
  fs.writeFileSync(
    path.join(beta, betaEntry.path),
    [
      '---',
      'name: review-policy',
      'description: Original policy.',
      'apply_to:',
      '  - src/**',
      '---',
      '',
      'Policy body.',
    ].join('\n'),
  );
  execFileSync('git', ['-C', beta, 'add', '.']);
  execFileSync('git', [
    '-C',
    beta,
    '-c',
    'user.name=Catalog fixtures',
    '-c',
    'user.email=fixtures@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '-m',
    'Add source policy',
  ]);
  const sources = [
    { name: 'Alpha', repository: repositoryUrls[0] },
    { name: 'Beta', repository: repositoryUrls[1], mode: 'custom', entries: [betaEntry] },
  ];
  const registry = { catalog_version: 1, sources };
  const envKeys = [
    'KITIA_CONFIG_DIR',
    'GIT_CONFIG_COUNT',
    'GIT_CONFIG_KEY_0',
    'GIT_CONFIG_VALUE_0',
    'GIT_CONFIG_KEY_1',
    'GIT_CONFIG_VALUE_1',
  ];
  const previousEnvironment = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  try {
    process.env.KITIA_CONFIG_DIR = configDirectory;
    process.env.GIT_CONFIG_COUNT = '2';
    process.env.GIT_CONFIG_KEY_0 = `url.${pathToFileURL(alpha).href}.insteadOf`;
    process.env.GIT_CONFIG_VALUE_0 = repositoryUrls[0];
    process.env.GIT_CONFIG_KEY_1 = `url.${pathToFileURL(beta).href}.insteadOf`;
    process.env.GIT_CONFIG_VALUE_1 = repositoryUrls[1];
    writeJson(path.join(configDirectory, 'catalogSources.json'), registry);
    writeJson(path.join(sourceIndexDirectory, 'catalogSources.json'), registry);
    writeJson(path.join(sourceIndexDirectory, 'Alpha.json'), createSourceIndex(repositoryUrls[0], 'Alpha', alpha));
    writeJson(
      path.join(sourceIndexDirectory, 'Beta.json'),
      createSourceIndex(repositoryUrls[1], 'Beta', beta, { mode: 'custom', entries: [betaEntry] }),
    );
    const betaOriginalRef = JSON.parse(
      fs.readFileSync(path.join(sourceIndexDirectory, 'Beta.json'), 'utf8'),
    ).source_ref;

    const agent = path.join(alpha, 'agents', 'release.agent.md');
    fs.mkdirSync(path.dirname(agent), { recursive: true });
    fs.writeFileSync(agent, '---\nname: release\ndescription: Release agent.\n---\n\nAgent body.\n');
    fs.writeFileSync(
      path.join(beta, betaEntry.path),
      [
        '---',
        'name: review-policy',
        'description: Updated policy.',
        'apply_to:',
        '  - src/**',
        '---',
        '',
        'Updated policy body.',
      ].join('\n'),
    );
    for (const source of [alpha, beta]) {
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
        'Update source artifacts',
      ]);
    }

    const runCommand = (args) => {
      const logs = [];
      const errors = [];
      const code = manageCatalogCommand({
        ...parseArguments(args),
        output: { log: (message) => logs.push(message), error: (message) => errors.push(message) },
      });
      return { code, logs, errors };
    };
    const single = runCommand(['catalog', 'refresh', 'Alpha']);
    assert.equal(single.code, 0);
    assert.match(single.logs.join('\n'), /Refreshed catalog Alpha/);
    const alphaIndex = JSON.parse(fs.readFileSync(alphaIndexFile, 'utf8'));
    assert.ok(alphaIndex.resources.some(({ kind, id }) => kind === 'agent' && id === 'release'));
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(sourceIndexDirectory, 'Beta.json'), 'utf8')).source_ref,
      betaOriginalRef,
    );

    const all = runCommand(['catalog', 'refresh', '--all']);
    assert.equal(all.code, 0);
    assert.match(all.logs.join('\n'), /Refreshed catalog Alpha/);
    assert.match(all.logs.join('\n'), /Refreshed catalog Beta/);
    const betaIndex = JSON.parse(fs.readFileSync(betaIndexFile, 'utf8'));
    assert.equal(betaIndex.resources.find(({ id }) => id === 'review-policy').description, 'Updated policy.');
    assert.equal(fs.existsSync(path.join(sourceIndexDirectory, 'Beta.json')), false);
    assert.deepEqual(loadUserSourceConfiguration().find(({ name }) => name === 'Beta').entries, [betaEntry]);
    assert.deepEqual(loadUserSourceConfiguration().find(({ name }) => name === 'Beta').mode, 'custom');
    const userConfigurationFile = path.join(configDirectory, 'catalogSources.json');
    const configurationBeforeUpdate = JSON.parse(fs.readFileSync(userConfigurationFile, 'utf8'));
    const betaIndexBeforeUpdate = fs.readFileSync(betaIndexFile, 'utf8');
    assert.throws(
      () =>
        updateCatalog('Beta', 'Beta', repositoryUrls[1], {
          mode: 'custom',
          entries: [{ kind: 'instruction', path: 'missing' }],
        }),
      /Source resource does not exist/,
    );
    assert.deepEqual(JSON.parse(fs.readFileSync(userConfigurationFile, 'utf8')), configurationBeforeUpdate);
    assert.equal(fs.readFileSync(betaIndexFile, 'utf8'), betaIndexBeforeUpdate);
    assert.throws(() => updateCatalog('Beta', 'Alpha', repositoryUrls[1]), /Catalog already exists/);
    const updated = updateCatalog('Beta', 'BetaEdited', repositoryUrls[1], {
      mode: 'custom',
      entries: [{ kind: 'instruction', path: 'policies/' }],
    });
    assert.equal(updated.catalog_name, 'BetaEdited');
    assert.deepEqual(
      updated.resources.map(({ kind, id }) => `${kind}:${id}`),
      ['instruction:review-policy'],
    );
    const updatedSources = loadUserSourceConfiguration();
    assert.deepEqual(
      updatedSources.map(({ name }) => name),
      ['Alpha', 'BetaEdited'],
    );
    assert.deepEqual(updatedSources.find(({ name }) => name === 'BetaEdited').entries, [
      { kind: 'instruction', path: 'policies' },
    ]);
    assert.equal(fs.existsSync(path.join(sourceIndexDirectory, 'Beta.json')), false);
    assert.equal(fs.existsSync(path.join(sourceIndexDirectory, catalogIndexFileName('BetaEdited'))), true);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(sourceIndexDirectory, 'catalogSources.json'), 'utf8')),
      JSON.parse(fs.readFileSync(userConfigurationFile, 'utf8')),
    );
  } finally {
    for (const key of envKeys) {
      if (previousEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnvironment[key];
    }
  }
});

test('user registries load metadata for multiple independently named catalogs', () => {
  const temporary = makeTemporaryDirectory('kitia-user-catalogs-');
  const indexDirectory = path.join(temporary, 'source-catalogs');
  fs.mkdirSync(indexDirectory, { recursive: true });
  const sources = [
    { name: 'team-alpha', repository: 'https://github.com/example/team-alpha' },
    { name: 'team-beta', repository: 'https://github.com/example/team-beta' },
  ];
  const manifest = { catalog_version: 1, sources };
  fs.writeFileSync(path.join(temporary, 'catalogSources.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(indexDirectory, 'catalogSources.json'), JSON.stringify(manifest));
  for (const [index, source] of sources.entries()) {
    fs.writeFileSync(
      path.join(indexDirectory, `${source.name}.json`),
      JSON.stringify({
        catalog_version: 1,
        catalog_name: source.name,
        source_repository: `example/${source.name}`,
        source_ref: String(index + 1).repeat(40),
        resources: [
          {
            id: `demo-${source.name}`,
            kind: 'skill',
            description: `${source.name} skill.`,
            source_path: `skills/category-${index}/demo-${source.name}`,
            license_status: 'MIT',
          },
        ],
      }),
    );
  }

  const originalConfig = process.env.KITIA_CONFIG_DIR;
  process.env.KITIA_CONFIG_DIR = temporary;
  try {
    const loaded = loadCommandCatalogs({ command: 'list' });
    assert.deepEqual(loaded.sourceResources.map(({ catalog, id }) => `${catalog}:${id}`).sort(), [
      'team-alpha:demo-team-alpha',
      'team-beta:demo-team-beta',
    ]);
  } finally {
    if (originalConfig === undefined) delete process.env.KITIA_CONFIG_DIR;
    else process.env.KITIA_CONFIG_DIR = originalConfig;
  }
});

test('source catalogs load from the user registry without repository manifests', () => {
  const temporary = makeTemporaryDirectory('kitia-user-catalogs-');
  const indexDirectory = path.join(temporary, 'source-catalogs');
  fs.mkdirSync(indexDirectory, { recursive: true });
  const sources = [
    { name: 'team-alpha', repository: 'https://github.com/example/team-alpha' },
    { name: 'team-beta', repository: 'https://github.com/example/team-beta' },
  ];
  const manifest = { catalog_version: 1, sources };
  writeJson(path.join(temporary, 'catalogSources.json'), manifest);
  writeJson(path.join(indexDirectory, 'catalogSources.json'), manifest);
  for (const [index, source] of sources.entries()) {
    writeJson(path.join(indexDirectory, `${source.name}.json`), {
      catalog_version: 1,
      catalog_name: source.name,
      source_repository: `example/${source.name}`,
      source_ref: String(index + 1).repeat(40),
      resources: [
        {
          id: `demo-${source.name}`,
          kind: 'skill',
          description: `${source.name} skill.`,
          source_path: `skills/category-${index}/demo-${source.name}`,
          license_status: 'MIT',
        },
      ],
    });
  }
  const originalConfig = process.env.KITIA_CONFIG_DIR;
  process.env.KITIA_CONFIG_DIR = temporary;
  try {
    const loaded = loadCommandCatalogs({ command: 'list' });
    assert.deepEqual(loaded.sourceResources.map(({ catalog, id }) => `${catalog}:${id}`).sort(), [
      'team-alpha:demo-team-alpha',
      'team-beta:demo-team-beta',
    ]);
  } finally {
    if (originalConfig === undefined) delete process.env.KITIA_CONFIG_DIR;
    else process.env.KITIA_CONFIG_DIR = originalConfig;
  }
});
