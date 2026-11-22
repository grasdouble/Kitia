'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { runSourceOperation } = require('../../core/installations/lifecycle.ts');
const { collectInstalledScopes } = require('../../core/inventory/checks.ts');
const { enrichInstalledResources } = require('../../core/resources/queries.ts');
const { cycleFilter, filterInventory, inventoryCatalogLabel } = require('../helpers.mts');
const { setupTemporaryDirectory } = require('../../../test/fixtures/source-catalog-fixtures.js');
const {
  waitForOutput,
  waitForDashboardFrame,
  selectedListRow,
  inventoryFrameReady,
  detailBodyText,
} = require('./dashboard-frames.js');

const makeTemporaryDirectory = setupTemporaryDirectory();

test('inventory labels custom catalogs from the most specific configured source folders', () => {
  const resource = (kind, id, source_path, catalog = 'MattPucock') => ({
    catalog,
    kind,
    id,
    source_path,
    source_repository: 'example/resources',
    managed: true,
  });
  const resources = [
    resource('skill', 'review', 'skills/engineering/review'),
    resource('skill', 'review-special', 'skills/engineering/review'),
    resource('skill', 'writing', 'skills/productivity/writing'),
    resource('agent', 'release-bot', 'agents/release.agent.md'),
    resource('instruction', 'policy', 'policies/checklist.instructions.md'),
    resource('agent', 'first-release', 'one/engineering/release.agent.md'),
    resource('agent', 'second-release', 'two/engineering/release.agent.md'),
    resource('skill', 'basic', 'skills/basic', 'BasicCatalog'),
    resource('skill', 'unmapped', 'elsewhere/unmapped'),
    { ...resource('skill', 'unmanaged', 'skills/engineering/unmanaged'), managed: false },
  ];
  const catalogs = [
    {
      name: 'MattPucock',
      mode: 'custom',
      entries: [
        { kind: 'skill', path: 'skills' },
        { kind: 'skill', id: 'review-special', path: 'skills/engineering/review/SKILL.md' },
        { kind: 'skill', path: 'skills/productivity' },
        { kind: 'agent', id: 'release-bot', path: 'agents/release.agent.md' },
        { kind: 'instruction', path: 'policies/checklist.instructions.md' },
        { kind: 'agent', path: 'one/engineering' },
        { kind: 'agent', path: 'two/engineering' },
      ],
    },
    { name: 'BasicCatalog', mode: 'basic', entries: [] },
  ];

  const labels = resources.map((entry) => inventoryCatalogLabel(entry, catalogs, resources));
  assert.deepEqual(labels, [
    'MattPucock[engineering]',
    'MattPucock[engineering]',
    'MattPucock[productivity]',
    'MattPucock[agents]',
    'MattPucock[policies]',
    'MattPucock[one/engineering]',
    'MattPucock[two/engineering]',
    'BasicCatalog',
    'MattPucock',
    '-',
  ]);
  assert.deepEqual(
    filterInventory(resources, '', 'MattPucock[engineering]', 'all', catalogs).map(({ id }) => id),
    ['review', 'review-special'],
  );
  assert.equal(
    cycleFilter(
      'all',
      resources.filter((entry) => entry.managed !== false),
      'catalog',
      'kind',
      'all',
      catalogs,
    ),
    'BasicCatalog',
  );
});

test('catalog browser renders custom source folders in SOURCE and detail labels', async () => {
  const { PassThrough } = require('node:stream');
  const { runDashboard } = await import('../dashboard.mts');
  const candidates = [
    {
      catalog: 'MattPucock',
      kind: 'skill',
      id: 'engineering-skill',
      source_repository: 'matt/skills',
      source_path: 'engineering/engineering-skill',
      managed: true,
    },
    {
      catalog: 'MattPucock',
      kind: 'skill',
      id: 'productivity-skill',
      source_repository: 'matt/skills',
      source_path: 'productivity/productivity-skill',
      managed: true,
    },
    {
      catalog: 'Basic',
      kind: 'skill',
      id: 'basic-skill',
      source_repository: 'basic/skills',
      source_path: 'skills/basic-skill',
      managed: true,
    },
    {
      catalog: 'MattPucock',
      kind: 'skill',
      id: 'unmapped-skill',
      source_repository: 'matt/skills',
      source_path: 'misc/unmapped-skill',
      managed: true,
    },
  ];
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 140;
  output.rows = 50;
  let renderedOutput = '';
  output.on('data', (chunk) => {
    renderedOutput += chunk.toString();
  });
  const done = runDashboard([], input, output, [], {
    catalogResources: candidates,
    userCatalogs: [
      {
        name: 'MattPucock',
        repository: 'matt/skills',
        mode: 'custom',
        entries: [
          { kind: 'skill', path: 'engineering' },
          { kind: 'skill', path: 'productivity' },
        ],
      },
      { name: 'Basic', repository: 'basic/skills', mode: 'basic', entries: [] },
    ],
  });
  input.write('b');
  await waitForOutput(
    output,
    () => renderedOutput,
    (text) => text.includes('\u001b[?2026l') && text.includes('CATALOG RESOURCES'),
    'catalog browser screen',
  );
  input.write('q');
  assert.equal(await done, true);
  input.destroy();
  output.destroy();
  assert.match(renderedOutput, /MattPucock\[engineering\]/);
  assert.match(renderedOutput, /MattPucock\[productivity\]/);
  assert.match(renderedOutput, /Basic/);
  assert.match(renderedOutput, /unmapped-skill/);
  assert.doesNotMatch(renderedOutput, /MattPucock\[misc\]/);
});

test('catalog browser renders mapped source folders and keeps repository-less names', async () => {
  const { PassThrough } = require('node:stream');
  const { runDashboard } = await import('../dashboard.mts');
  const candidates = [
    {
      catalog: 'MattPucock',
      kind: 'skill',
      id: 'grill-me',
      source_repository: 'matt/skills',
      source_path: 'skills/productivity/grill-me',
      description: 'Interview practice',
      managed: true,
    },
    {
      catalog: 'BasicCatalog',
      kind: 'skill',
      id: 'basic-skill',
      source_path: 'skills/basic-skill',
      managed: true,
    },
  ];
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 160;
  output.rows = 40;
  let rendered = '';
  output.on('data', (chunk) => {
    rendered += chunk.toString();
  });
  const done = runDashboard([], input, output, [], {
    catalogResources: candidates,
    userCatalogs: [
      {
        name: 'MattPucock',
        repository: 'matt/skills',
        mode: 'custom',
        entries: [{ kind: 'skill', path: 'skills/productivity' }],
      },
    ],
  });
  const plain = () => rendered.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
  await waitForOutput(
    output,
    () => plain(),
    (text) => text.includes('INSTALLED RESOURCES'),
    'initial inventory',
  );
  input.write('b');
  await waitForOutput(
    output,
    () => plain(),
    (text) => text.includes('CATALOG RESOURCES'),
    'catalog browser',
  );
  assert.ok(
    plain()
      .split(/\r?\n/)
      .some((line) => line.includes('MattPucock[productivity]') && line.includes('grill-me')),
  );
  assert.ok(
    plain()
      .split(/\r?\n/)
      .some((line) => line.includes('basic-skill') && line.includes('BasicCatalog')),
  );
  assert.match(plain(), /CATALOG[^\n]*\n[^\n]*MattPucock\[productivity\]/);

  const filterStart = rendered.length;
  input.write('f');
  await waitForOutput(
    output,
    () => rendered,
    (text) => text.length > filterStart,
    'filter input',
  );
  for (const character of 'MattPucock[productivity]') input.write(character);
  await waitForOutput(
    output,
    () => plain(),
    (text) => /CATALOG RESOURCES[^\n]*\b1 results\b/.test(text),
    'filtered catalog result',
  );
  assert.ok(
    plain()
      .split(/\r?\n/)
      .some((line) => line.includes('MattPucock[productivity]') && line.includes('grill-me')),
  );
  input.write('\x1b');
  await new Promise((resolve) => setTimeout(resolve, 50));
  input.write('q');
  assert.equal(await done, true);
  input.destroy();
  output.destroy();
});

test('inventory TUI labels a tracked user skill with its custom source folder', async (t) => {
  const { PassThrough } = require('node:stream');
  const { runDashboard } = await import('../dashboard.mts');
  const temporary = makeTemporaryDirectory('kitia-inventory-source-label-');
  const target = path.join(temporary, 'project');
  fs.mkdirSync(target, { recursive: true });
  const sourceResource = {
    catalog: 'MattPucock',
    id: 'grill-me',
    kind: 'skill',
    description: 'A relentless interview to sharpen a plan or design.',
    source_repository: 'mattpocock/skills',
    source_path: 'skills/productivity/grill-me',
    source_ref: 'a'.repeat(40),
    license_status: 'MIT',
  };
  const writeArtifact = (relativePath, lines) => {
    const file = path.join(target, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, lines.join('\n'));
  };
  const sourceMetadata = [
    `  github-repo: "https://github.com/${sourceResource.source_repository}"`,
    `  github-path: "${sourceResource.source_path}"`,
    `  github-ref: "${sourceResource.source_ref}"`,
    `  github-pinned: "${sourceResource.source_ref}"`,
  ];
  const invokeInstall = (args) => {
    assert.deepEqual(args.slice(0, 4), [
      'skill',
      'install',
      sourceResource.source_repository,
      sourceResource.source_path,
    ]);
    writeArtifact(`.agents/skills/${sourceResource.id}/SKILL.md`, [
      '---',
      `name: ${sourceResource.id}`,
      `description: ${sourceResource.description}`,
      'metadata:',
      ...sourceMetadata,
      '---',
      '',
      'Tracked source content.',
      '',
    ]);
    return 0;
  };
  assert.equal(
    runSourceOperation(
      {
        action: 'install',
        resource: sourceResource,
        target,
        tool: 'copilot',
        scope: 'user',
      },
      invokeInstall,
    ).status,
    0,
  );
  writeArtifact('.agents/skills/manual-skill/SKILL.md', [
    '---',
    'name: manual-skill',
    'description: Installed outside Kitia.',
    'metadata:',
    ...sourceMetadata,
    '---',
    '',
    'Untracked source content.',
    '',
  ]);

  const result = collectInstalledScopes({ user: target }, [sourceResource]);
  const tracked = result.resources.find((resource) => resource.id === 'grill-me');
  assert.equal(tracked.catalog, 'MattPucock');
  assert.equal(tracked.source_repository, sourceResource.source_repository);
  assert.equal(tracked.source_path, sourceResource.source_path);
  const untracked = result.resources.find((resource) => resource.id === 'manual-skill');
  assert.equal(untracked.managed, false);
  assert.equal(untracked.catalog, '-');

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
  const done = runDashboard(enrichInstalledResources(result.resources, [sourceResource]), input, output, [], {
    userCatalogs: [
      {
        name: 'MattPucock',
        mode: 'custom',
        entries: [
          { kind: 'skill', path: 'skills/productivity' },
          { kind: 'skill', path: 'skills/engineering' },
          { kind: 'skill', path: 'skills/misc' },
          { kind: 'skill', path: 'skills/in-progress' },
        ],
      },
    ],
  });
  t.after(async () => {
    if (!input.destroyed) input.destroy();
    await done.catch(() => {});
    if (!output.destroyed) output.destroy();
  });
  let frame = await waitForDashboardFrame(
    output,
    () => rendered,
    (value) => inventoryFrameReady(value) && value.includes('SELECTION DETAILS') && Boolean(selectedListRow(value)),
    'initial selected inventory details',
  );
  if (selectedListRow(frame) !== tracked.id) {
    const start = rendered.length;
    input.write('\x1b[B');
    frame = await waitForDashboardFrame(
      output,
      () => rendered,
      (value) => inventoryFrameReady(value) && selectedListRow(value) === tracked.id,
      'tracked skill selection',
      start,
    );
  }
  assert.match(frame, /manual-skill[^\r\n]*Unmanaged/, 'the unmanaged resource remains in the inventory list');
  const compactDetailText = detailBodyText(frame);
  assert.ok(
    compactDetailText.startsWith('skillgrill-meArelentlessinterviewtosharpenaplanordesign.'),
    'kind, resource ID, and unlabeled description follow the current Inventory hierarchy',
  );
  assert.ok(!compactDetailText.includes('DESCRIPTION'), 'the Inventory description has no redundant field label');
  assert.ok(
    compactDetailText.includes('CATALOGMattPucock[productivity]'),
    'the custom catalog folder remains visible in Inventory details',
  );
  input.write('q');
  assert.equal(await done, true);
  input.destroy();
  output.destroy();
});

test('inventory TUI renders multiple configured custom folders and preserves other catalog labels', async (t) => {
  const { PassThrough } = require('node:stream');
  const { runDashboard } = await import('../dashboard.mts');
  const resource = (catalog, id, source_path, managed = true) => ({
    catalog,
    id,
    kind: 'skill',
    description: id,
    managed,
    scope: 'project',
    status: managed ? 'current' : 'unmanaged',
    source_repository: catalog === '-' ? undefined : `example/${catalog.toLowerCase()}`,
    source_path,
  });
  const resources = [
    resource('MattPucock', 'engineering-skill', 'custom/engineering/engineering-skill'),
    resource('MattPucock', 'productivity-skill', 'custom/productivity/productivity-skill'),
    resource('BasicCatalog', 'basic-skill', 'skills/basic-skill'),
    resource('MattPucock', 'unmapped-skill', 'other/unmapped-skill'),
    resource('-', 'manual-skill', '', false),
  ];
  const userCatalogs = [
    {
      name: 'MattPucock',
      repository: 'https://github.com/example/mattpucock',
      mode: 'custom',
      entries: [
        { kind: 'skill', path: 'custom/engineering' },
        { kind: 'skill', path: 'custom/productivity' },
      ],
    },
    {
      name: 'BasicCatalog',
      repository: 'https://github.com/example/basic',
      mode: 'basic',
      entries: [],
    },
  ];
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 160;
  output.rows = 40;
  let rendered = '';
  output.on('data', (chunk) => {
    rendered += chunk.toString();
  });
  const done = runDashboard(resources, input, output, [], { userCatalogs });
  t.after(async () => {
    if (!input.destroyed) input.destroy();
    await done.catch(() => {});
    if (!output.destroyed) output.destroy();
  });
  const inventorySelection = (value) => {
    const selected = selectedListRow(value);
    return inventoryFrameReady(value) && selected && detailBodyText(value).startsWith(`skill${selected}`);
  };
  let frame = await waitForDashboardFrame(output, () => rendered, inventorySelection, 'initial Inventory selection');
  const expectedLabels = new Map([
    ['engineering-skill', 'MattPucock[engineering]'],
    ['productivity-skill', 'MattPucock[productivity]'],
    ['basic-skill', 'BasicCatalog'],
    ['unmapped-skill', 'MattPucock'],
  ]);
  const observed = new Set();
  for (let index = 0; index < resources.length; index += 1) {
    const selected = selectedListRow(frame);
    const details = detailBodyText(frame);
    if (selected === 'manual-skill') {
      assert.match(frame, /manual-skill[^\r\n]*Unmanaged/);
      assert.doesNotMatch(details, /CATALOG/, 'unmanaged artifacts do not inherit a catalog label');
    } else {
      const expectedLabel = expectedLabels.get(selected);
      assert.ok(expectedLabel, `resource ${selected} has an expected catalog label`);
      assert.ok(
        details.includes(`CATALOG${expectedLabel}`),
        `${selected} shows its catalog/source-folder label ${expectedLabel}`,
      );
      if (selected === 'unmapped-skill') assert.doesNotMatch(details, /CATALOGMattPucock\[/);
    }
    observed.add(selected);
    if (index + 1 < resources.length) {
      const start = rendered.length;
      input.write('\x1b[B');
      frame = await waitForDashboardFrame(
        output,
        () => rendered,
        (value) => inventorySelection(value) && selectedListRow(value) !== selected,
        `next inventory detail after ${selected}`,
        start,
      );
    }
  }
  assert.deepEqual(
    observed,
    new Set(resources.map(({ id }) => id)),
    'every tracked and unmanaged resource remains reachable in the inventory list',
  );
  input.write('q');
  assert.equal(await done, true);
  input.destroy();
  output.destroy();
});

test('inventory columns reserve usable ID space and expose custom Catalog suffixes at 120 columns', async () => {
  const { detailPanelLayout, tableColumns } = await import('../helpers.mts');
  const listWidth = detailPanelLayout(120).listWidth - 4;
  const catalogWidth = 'MattPucock[productivity]'.length;
  const columns = tableColumns(listWidth, 21, catalogWidth);
  const wide = tableColumns(160 - 6, 40, catalogWidth);
  const narrower = tableColumns(100 - 6, 40, catalogWidth);
  assert.ok(columns.id >= 20);
  assert.equal(columns.catalog, catalogWidth);
  assert.equal(wide.id >= 12, true);
  assert.equal(narrower.id >= 12, true);
  assert.equal(wide.catalog > narrower.catalog, true);
  assert.equal(tableColumns(60 - 6).catalog, 0);
});
