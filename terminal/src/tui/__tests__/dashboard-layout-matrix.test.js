'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  waitForDashboardFrame,
  selectedListRow,
  inventoryFrameReady,
  browseFrameReady,
  detailBodyText,
} = require('./dashboard-frames.js');

test('dashboard renders the resource list and selection panel at wide and narrow widths', async (t) => {
  const { PassThrough } = require('node:stream');
  const { runDashboard } = await import('../dashboard.mts');
  for (const columns of [160, 100]) {
    const input = new PassThrough();
    input.isTTY = true;
    input.setRawMode = () => {};
    input.ref = () => {};
    input.unref = () => {};
    const output = new PassThrough();
    output.isTTY = true;
    output.columns = columns;
    output.rows = 40;
    let rendered = '';
    output.on('data', (chunk) => {
      rendered += chunk.toString();
    });
    const done = runDashboard(
      [
        {
          catalog: 'a-very-long-external-catalog-name-for-layout-smoke-testing',
          kind: 'skill',
          id: 'manual-skill',
          scope: 'project',
          status: 'current',
          managed: true,
          description: 'A manually maintained skill.',
          source_repository: 'example/manual-skill',
          source_path: 'skills/manual-skill',
          source_ref: 'abcdef0123456789abcdef0123456789abcdef01',
        },
      ],
      input,
      output,
    );
    t.after(async () => {
      if (!input.destroyed) input.destroy();
      await done.catch(() => {});
      if (!output.destroyed) output.destroy();
    });
    let frame = await waitForDashboardFrame(
      output,
      () => rendered,
      (value) => inventoryFrameReady(value) && selectedListRow(value) === 'manual-skill' && detailBodyText(value),
      'selected inventory details',
    );
    assert.match(frame, /INSTALLED RESOURCES/);
    const fields = [
      'INSTALLEDREVISIONabcdef0',
      'https://github.com/example/manual-skill',
      'SOURCEPATHskills/manual-skill',
    ];
    let details = detailBodyText(frame);
    assert.ok(details.startsWith('skillmanual-skillAmanuallymaintainedskill.'));
    const initial = frame;
    for (let page = 0; page < 6 && !fields.every((field) => details.includes(field)); page += 1) {
      const previous = detailBodyText(frame);
      const start = rendered.length;
      input.write('\x1b[6~');
      frame = await waitForDashboardFrame(
        output,
        () => rendered,
        (value) => inventoryFrameReady(value) && detailBodyText(value) !== previous,
        'next inventory metadata page',
        start,
      );
      const next = detailBodyText(frame);
      let overlap = Math.min(details.length, next.length);
      while (overlap && !details.endsWith(next.slice(0, overlap))) overlap -= 1;
      details += next.slice(overlap);
    }
    for (const field of fields) assert.ok(details.includes(field), `${field} is reachable at ${columns} columns`);
    assert.doesNotMatch(details, /DESCRIPTION|STATUS/);
    frame = initial;
    const inventoryRow = frame.split(/\r?\n/).find((line) => line.includes('manual-skill') && line.includes('Current'));
    assert.ok(inventoryRow, 'inventory row is rendered');
    assert.doesNotMatch(inventoryRow, /A manually maintained skill/);
    assert.doesNotMatch(frame, /DESC\s/);
    const header = frame
      .split(/\r?\n/)
      .find(
        (line) =>
          line.includes('RESOURCE') && line.includes('KIND') && line.includes('SCOPE') && line.includes('STATUS'),
      );
    assert.ok(header, 'inventory header is rendered');
    const column = (label) => header.indexOf(label);
    assert.ok(
      column('RESOURCE') < column('KIND') && column('KIND') < column('SCOPE') && column('SCOPE') < column('STATUS'),
      'inventory columns preserve their resource/kind/scope/status order',
    );
    input.write('q');
    assert.equal(await done, true);
    input.destroy();
    output.destroy();
  }
});

test('catalog browser renders ordered columns without list descriptions at wide and narrow widths', async (t) => {
  const { PassThrough } = require('node:stream');
  const { runDashboard } = await import('../dashboard.mts');
  for (const columns of [160, 100]) {
    const input = new PassThrough();
    input.isTTY = true;
    input.setRawMode = () => {};
    input.ref = () => {};
    input.unref = () => {};
    const output = new PassThrough();
    output.isTTY = true;
    output.columns = columns;
    output.rows = 40;
    let rendered = '';
    output.on('data', (chunk) => {
      rendered += chunk.toString();
    });
    const sourceName = 'MattPucock';
    const kind = 'instruction';
    const done = runDashboard([], input, output, [], {
      catalogResources: [
        {
          catalog: sourceName,
          kind,
          id: 'catalog-skill',
          description: 'Catalog panel toggle behavior.',
        },
      ],
    });
    t.after(async () => {
      if (!input.destroyed) input.destroy();
      await done.catch(() => {});
      if (!output.destroyed) output.destroy();
    });
    await waitForDashboardFrame(output, () => rendered, inventoryFrameReady, 'initial inventory');
    const start = rendered.length;
    input.write('b');
    const frame = await waitForDashboardFrame(
      output,
      () => rendered,
      (value) => browseFrameReady(value) && detailBodyText(value).startsWith('instructioncatalog-skill'),
      'catalog resources table and details',
      start,
    );
    const header = frame
      .split(/\r?\n/)
      .find(
        (line) =>
          line.includes('RESOURCE') && line.includes('KIND') && line.includes('CATALOG') && line.includes('INSTALLED'),
      );
    assert.ok(header, 'catalog header is rendered');
    assert.ok(
      header.indexOf('RESOURCE') < header.indexOf('KIND') &&
        header.indexOf('KIND') < header.indexOf('CATALOG') &&
        header.indexOf('CATALOG') < header.indexOf('INSTALLED'),
    );
    const row = frame
      .split(/\r?\n/)
      .find((line) => line.includes(sourceName) && line.includes('instruction') && line.includes('catalog-skill'));
    assert.ok(row, 'catalog row is rendered');
    const positions = ['catalog-skill', 'instruction', sourceName].map((label) => row.indexOf(label));
    assert.ok(
      positions.every((position) => position >= 0),
      'resource, kind, and catalog values remain in the row',
    );
    assert.ok(
      positions[0] < positions[1] && positions[1] < positions[2],
      `resource, kind, and catalog order is retained: ${JSON.stringify({ positions, row })}`,
    );
    assert.doesNotMatch(row, /Catalog panel toggle behavior\./);
    assert.doesNotMatch(header, /DESC/);
    const details = detailBodyText(frame);
    assert.ok(details.startsWith('instructioncatalog-skillCatalogpaneltogglebehavior.'));
    assert.doesNotMatch(details, /DESCRIPTION/);
    input.write('q');
    assert.equal(await done, true);
    input.destroy();
    output.destroy();
  }
});

for (const [screen, dimensions] of [
  [
    'inventory',
    [
      [160, 40],
      [112, 50],
      [100, 50],
      [160, 30],
      [120, 36],
      [100, 36],
    ],
  ],
  [
    'catalog',
    [
      [160, 40],
      [112, 40],
      [100, 50],
      [160, 30],
      [120, 36],
      [100, 38],
    ],
  ],
  [
    'management',
    [
      [160, 40],
      [112, 40],
      [100, 50],
      [160, 24],
      [120, 36],
      [100, 29],
    ],
  ],
]) {
  for (const [columns, rows] of dimensions) {
    test(`${screen} rows, details and shortcuts stay reachable at ${columns}x${rows}`, async () => {
      const { PassThrough } = require('node:stream');
      const { runDashboard } = await import('../dashboard.mts');
      const input = new PassThrough();
      input.isTTY = true;
      input.setRawMode = () => {};
      input.ref = () => {};
      input.unref = () => {};
      const output = new PassThrough();
      output.isTTY = true;
      output.columns = columns;
      output.rows = rows;
      let rendered = '';
      output.on('data', (chunk) => {
        rendered += chunk.toString();
      });
      const resources = Array.from({ length: 60 }, (_, index) => ({
        catalog: 'sample',
        kind: 'skill',
        id: `resource-${String(index).padStart(2, '0')}`,
        scope: 'project',
        status: 'current',
        managed: true,
        tags: ['review'],
        license_status: 'MIT',
        license_spdx: 'MIT',
        description: `Selected description ${index}.`,
        source_repository: 'org/repo',
        source_path: 'skills/sample',
        source_ref: 'main',
      }));
      const catalogs = resources.map((_, index) => ({
        name: `catalog-${String(index).padStart(2, '0')}`,
        repository: `org/repo-${index}`,
      }));
      const done = runDashboard(screen === 'inventory' ? resources : [], input, output, [], {
        ...(screen === 'catalog' ? { catalogResources: resources } : {}),
        ...(screen === 'management' ? { userCatalogs: catalogs } : {}),
      });
      const title = (index) =>
        screen === 'management'
          ? `catalog-${String(index).padStart(2, '0')}`
          : `resource-${String(index).padStart(2, '0')}`;
      const press = (key, predicate, description) => {
        const start = rendered.length;
        input.write(key);
        return waitForDashboardFrame(output, () => rendered, predicate, description, start);
      };
      const listReady =
        screen === 'inventory'
          ? (value) => inventoryFrameReady(value) && value.includes('INSTALLED RESOURCES')
          : screen === 'catalog'
            ? browseFrameReady
            : (value) => value.includes('CONNECTED CATALOGS 60') && value.includes('Q quit');
      const selected = (value, index) =>
        screen === 'management'
          ? value.includes(title(index)) && new RegExp(`org/repo-${index}(?:\\s|│)`).test(value)
          : selectedListRow(value) === title(index);
      const visibleDetails = (value) =>
        screen === 'management' ? value.includes('FRESHNESS') : Boolean(detailBodyText(value));
      const ready =
        (index, details = true) =>
        (value) =>
          listReady(value) && selected(value, index) && visibleDetails(value) === details;
      const assertListAndShortcuts = (value, detailsVisible = true, query = '') => {
        assert.ok(value.trimEnd().split(/\r?\n/).length <= rows, `${screen} fits the ${columns}x${rows} viewport`);
        const plain = value;
        const lines = plain.split(/\r?\n/);
        const tableTitle =
          screen === 'inventory'
            ? 'INSTALLED RESOURCES'
            : screen === 'catalog'
              ? 'CATALOG RESOURCES'
              : 'CONNECTED CATALOGS 60';
        assert.ok(plain.includes(tableTitle));
        if (screen !== 'management') {
          const headerPattern =
            screen === 'inventory'
              ? /RESOURCE\s+KIND\s+SCOPE\s+STATUS/
              : /RESOURCE\s+KIND\s+CATALOG\s+INST(?:ALLED|\.\.\.)/;
          const tableHeader = lines.find((line) => headerPattern.test(line));
          assert.ok(tableHeader, 'resource column headings remain visible');
          assert.match(tableHeader, headerPattern);
          const resultCount = query ? 10 : 60;
          assert.ok(plain.includes(`${resultCount} results`), 'the list metadata matches active filters');
          assert.ok(
            lines.some((line) => /resource-\d\d/.test(line)),
            'data rows remain visible below the headings',
          );
          assert.equal(visibleDetails(plain), detailsVisible);
        } else {
          assert.ok(
            lines.some((line) => /catalog-\d\d/.test(line)) && lines.some((line) => /org\/repo-\d/.test(line)),
            'catalog card names and repositories remain visible',
          );
          assert.equal(plain.includes('FRESHNESS'), detailsVisible);
          assert.equal(
            plain.includes('Refresh updates metadata only; installed content stays unchanged.'),
            detailsVisible && rows >= 30,
          );
        }
        const shortcuts = plain.match(/^ *┌─+┐\r?\n *│ SHORTCUTS +│\r?\n(?: *│[^\r\n]*│\r?\n)+ *└─+┘/m)?.[0];
        assert.ok(shortcuts, 'the shortcut panel retains its complete frame');
        assert.match(shortcuts, /Display: \? guide/);
        const navigation = ['I Inventory', 'B Browse resources', 'M Manage catalogs'];
        assert.match(shortcuts, /Navigation: I Inventory[\s\S]*B Browse resources[\s\S]*M Manage catalogs/);
        if (screen !== 'management') assert.match(shortcuts, /Filters: F filter/);
        if (screen === 'catalog') assert.match(shortcuts, /Actions: ENTER install/);
        const shortcutTokens =
          screen === 'inventory'
            ? [
                'F filter',
                'C catalog',
                'K kind',
                'L license',
                'D details',
                ...navigation,
                '↑↓ navigate',
                '? guide',
                'Q quit',
              ]
            : screen === 'catalog'
              ? [
                  'ENTER install',
                  'V revisions',
                  'P preview/audit',
                  'F filter',
                  'C catalog',
                  'K kind',
                  'L license',
                  'D details',
                  ...navigation,
                  '↑↓ navigate',
                  '? guide',
                  'Q quit',
                ]
              : ['D details', ...navigation, '↑↓ navigate', '? guide', 'Q quit'];
        for (const token of shortcutTokens)
          assert.ok(shortcuts.includes(token), `shortcut remains reachable: ${token}`);
      };
      const assertSelection = (value, index) => {
        assertListAndShortcuts(value);
        assert.ok(selected(value, index), `${title(index)} remains visible in the selected page`);
        if (screen === 'management') {
          assert.match(value, /FRESHNESS UNKNOWN/);
          assert.equal(value.includes('Refresh updates metadata only; installed content stays unchanged.'), rows >= 30);
        } else {
          const details = detailBodyText(value);
          assert.ok(details.startsWith(`skill${title(index)}`), 'the details belong to the selected resource');
          const complete = [`Selecteddescription${index}.`, 'org/repo'].every((field) => details.includes(field));
          assert.ok(complete || value.includes('PgUp/PgDn'), 'additional details remain reachable through paging');
        }
      };
      try {
        const inventory = await waitForDashboardFrame(
          output,
          () => rendered,
          screen === 'inventory' ? ready(0) : inventoryFrameReady,
          'initial Inventory',
        );
        const initial =
          screen === 'inventory'
            ? inventory
            : await press(screen === 'catalog' ? 'b' : 'm', ready(0), `${screen} ready`);
        assertSelection(initial, 0);
        assertSelection(await press('\u001b[A', ready(59), 'wrapped to the last selection'), 59);
        assertListAndShortcuts(await press('d', ready(59, false), 'details hidden'), false);
        assertSelection(await press('d', ready(59), 'details shown'), 59);
        assertSelection(await press('\u001b[B', ready(0), 'wrapped to the first selection'), 0);
        if (screen !== 'management') {
          await press(
            'f',
            (value) => value.includes('Filters: TYPE to search') && value.includes('▏'),
            'categorized search hints are ready',
          );
          await press(
            'resource-5',
            (value) => value.includes('TYPE to search') && value.includes('resource-5▏') && selected(value, 50),
            'live search selects the first matching resource',
          );
          const filtered = (index) => (value) => ready(index)(value) && value.includes('10 results');
          assertListAndShortcuts(await press('\r', filtered(50), 'search applied'), true, 'resource-5');
          assertListAndShortcuts(
            await press('\u001b[A', filtered(59), 'wrapped to the last search result'),
            true,
            'resource-5',
          );
          const filter = (label) => (value) => filtered(50)(value) && value.includes(`${label}▾`);
          if (screen === 'catalog') {
            assertListAndShortcuts(await press('l', filter('MIT'), 'license filter applied'), true, 'resource-5');
          } else {
            assertListAndShortcuts(await press('c', filter('sample'), 'catalog filter applied'), true, 'resource-5');
            assertListAndShortcuts(await press('k', filter('skill'), 'kind filter applied'), true, 'resource-5');
          }
        }
        input.write('q');
        assert.equal(await done, true);
      } finally {
        input.destroy();
        await done.catch(() => {});
        output.destroy();
      }
    });
  }
}

test('dashboard uses a shared list/details split at wide terminal widths', async () => {
  const { detailPanelLayout } = await import('../helpers.mts');
  assert.deepEqual(detailPanelLayout(160), {
    sideBySide: true,
    listWidth: 106,
    detailsWidth: 51,
  });
  assert.deepEqual(detailPanelLayout(100), {
    sideBySide: false,
    listWidth: undefined,
    detailsWidth: undefined,
  });
});
