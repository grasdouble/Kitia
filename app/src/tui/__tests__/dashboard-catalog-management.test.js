'use strict';

const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const { mergeRefreshedCatalogResources } = require('../helpers.mts');
const {
  waitForOutput,
  selectedDetailsFrame,
  waitForDashboardFrame,
  inventoryFrameReady,
} = require('./dashboard-frames.js');

test('refreshing one catalog replaces only its resources in the catalog list', () => {
  const existingAlpha = { catalog: 'Alpha', kind: 'agent', id: 'old-agent' };
  const existingBeta = { catalog: 'Beta', kind: 'skill', id: 'unchanged-skill' };
  const updatedAlpha = { catalog: 'Alpha', kind: 'agent', id: 'new-agent' };
  const unrelatedBetaUpdate = { catalog: 'Beta', kind: 'skill', id: 'new-beta-skill' };

  assert.deepEqual(
    mergeRefreshedCatalogResources([existingAlpha, existingBeta], [updatedAlpha, unrelatedBetaUpdate], ['alpha']),
    [updatedAlpha, existingBeta],
  );
});

test('dashboard manages user catalogs and refreshes one or all catalogs', async (t) => {
  const { PassThrough } = require('node:stream');
  const { runDashboard } = await import('../dashboard.mts');
  const inkRequire = require('node:module').createRequire(require.resolve('ink'));
  const { default: chalk } = await import(pathToFileURL(inkRequire.resolve('chalk')).href);
  const previousColorLevel = chalk.level;
  // Horizontal modal choices distinguish their active option through color.
  chalk.level = 1;
  t.after(() => {
    chalk.level = previousColorLevel;
  });
  const repository = 'https://github.com/example/test';
  const userCatalogsReadyFrame =
    /^(?=[\s\S]*CONNECTED CATALOGS)(?=[\s\S]*Navigation: I Inventory)(?=[\s\S]*Q quit)(?![\s\S]*(?:ADD CATALOG|EDIT CATALOG|REMOVE CATALOG|CONFIRM CATALOG REMOVAL|IMPORT CATALOGS|EXPORT CATALOGS|REFRESH CATALOG|CATALOG REFRESH ERRORS))/;
  const driveRefresh = async (keys, refreshCatalog, extraActions = {}, exitFrames = ['INSTALLED RESOURCES']) => {
    const input = new PassThrough();
    input.isTTY = true;
    input.setRawMode = () => {};
    input.ref = () => {};
    input.unref = () => {};
    const output = new PassThrough();
    output.isTTY = true;
    output.columns = 100;
    output.rows = 40;
    let renderedOutput = '';
    output.on('data', (chunk) => {
      renderedOutput += chunk.toString();
    });
    const done = runDashboard([], input, output, [], {
      userCatalogs: [{ name: 'Test', repository }],
      refreshCatalog,
      removeCatalog: async () => ({ catalogs: [{ name: 'Test', repository }], resources: [] }),
      ...extraActions,
    });
    let dashboardFinished = false;
    done.then(
      () => {
        dashboardFinished = true;
      },
      () => {
        dashboardFinished = true;
      },
    );
    const awaitDashboardExit = async () => {
      input.write('q');
      let timeout;
      try {
        return await Promise.race([
          done,
          new Promise((_, reject) => {
            timeout = setTimeout(
              () =>
                reject(
                  new Error(`Dashboard did not exit after q for ${JSON.stringify(keys)}: ${latestFrame().slice(-400)}`),
                ),
              5_000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
    };
    const latestFrame = () => {
      const end = renderedOutput.lastIndexOf('\x1b[?2026l');
      const start = renderedOutput.lastIndexOf('\x1b[?2026h', end);
      return start >= 0 && end > start
        ? require('node:util').stripVTControlCharacters(renderedOutput.slice(start, end))
        : '';
    };
    const latestFrameEnd = () => renderedOutput.lastIndexOf('\x1b[?2026l');
    try {
      await waitForDashboardFrame(output, () => renderedOutput, inventoryFrameReady, 'initial Inventory');
      for (const entry of keys) {
        const [key, expectedOutput] = Array.isArray(entry) ? entry : [entry];
        if (key === 'q') {
          const result = await awaitDashboardExit();
          return {
            result,
            renderedOutput: require('node:util').stripVTControlCharacters(renderedOutput),
          };
        }
        const previousEnd = latestFrameEnd();
        input.write(key);
        if (expectedOutput === null) {
          // An ignored key produces no frame. Let Ink consume its readable event
          // before sending another key, or the two can arrive as pasted text.
          await require('node:timers/promises').setImmediate();
          assert.ok(inventoryFrameReady(latestFrame()), 'the unsupported refresh key leaves Inventory active');
          continue;
        }
        const expected = expectedOutput ?? (key === 'm' ? userCatalogsReadyFrame : undefined);
        assert.ok(expected, `specify a destination frame for ${JSON.stringify(key)}`);
        await waitForOutput(
          output,
          latestFrame,
          (frame) =>
            latestFrameEnd() > previousEnd &&
            (expected instanceof RegExp ? expected.test(frame) : frame.includes(expected)),
          `latest frame ${expected} after ${JSON.stringify(key)}`,
          5_000,
        );
      }
      for (const expectedFrame of exitFrames) {
        const previousEnd = latestFrameEnd();
        input.write('\x1b');
        const expected = expectedFrame instanceof RegExp ? expectedFrame : new RegExp(expectedFrame);
        await waitForOutput(
          output,
          latestFrame,
          (frame) => latestFrameEnd() > previousEnd && expected.test(frame),
          `latest frame after Escape: ${expectedFrame}`,
          5_000,
        );
      }
      const result = await awaitDashboardExit();
      dashboardFinished = true;
      return {
        result,
        renderedOutput: require('node:util').stripVTControlCharacters(renderedOutput),
      };
    } finally {
      if (!dashboardFinished && !input.destroyed) {
        input.destroy();
        let cleanupTimeout;
        try {
          await Promise.race([
            done.then(
              () => {},
              () => {},
            ),
            new Promise((resolve) => {
              cleanupTimeout = setTimeout(resolve, 1_000);
            }),
          ]);
        } finally {
          clearTimeout(cleanupTimeout);
        }
      } else if (!input.destroyed) {
        input.destroy();
      }
      output.destroy();
    }
  };
  const removed = [];
  const removeCatalog = async (name) => {
    removed.push(name);
    return { catalogs: [], resources: [] };
  };
  const removedViaEnter = await driveRefresh(
    [
      'm',
      ['\x1b[3~', 'Choose a user catalog to remove:'],
      ['\r', 'CONFIRM CATALOG REMOVAL'],
      ['y', 'ENTER / ESC CLOSE'],
      ['\r', userCatalogsReadyFrame],
      'q',
    ],
    undefined,
    { removeCatalog },
  );
  assert.equal(removedViaEnter.result, true);
  assert.deepEqual(removed, ['Test']);
  const cancelledRemoval = await driveRefresh(
    ['m', ['\x1b[3~', 'Choose a user catalog to remove:'], ['\x1b', userCatalogsReadyFrame], 'q'],
    undefined,
    { removeCatalog },
  );
  assert.equal(cancelledRemoval.result, true);
  assert.deepEqual(removed, ['Test']);
  const refreshed = [];
  const refresh = async (name) => {
    refreshed.push(name);
    return {
      catalogs: [{ name: 'Test', repository }],
      resources: [],
      refreshed: [{ name: name || 'Test', count: 2 }],
      failures: [],
    };
  };
  const management = await driveRefresh(['m', 'q'], refresh, {
    addCatalog: async () => ({ catalog: 'New', count: 0 }),
    updateCatalog: async () => ({ catalog: 'Test', count: 0 }),
  });
  assert.equal(management.result, true);
  const presetRequests = [];
  const presetManager = await driveRefresh(
    [
      ['m', userCatalogsReadyFrame],
      ['p', /PRESET/],
      ['\x1b[B', /› Matt Pocock/],
      ['\r', /ADD CATALOG RESULT/],
      ['\r', userCatalogsReadyFrame],
      'q',
    ],
    refresh,
    {
      addCatalog: async (request) => {
        presetRequests.push(request);
        return { catalog: request.name, count: 3, catalogs: [request], resources: [] };
      },
    },
  );
  assert.equal(presetManager.result, true);
  assert.deepEqual(presetRequests, [
    {
      name: 'matt-pocock',
      repository: 'https://github.com/mattpocock/skills',
      mode: 'basic',
      entries: [],
    },
  ]);
  const anthropicRequests = [];
  const anthropicManager = await driveRefresh(
    [['m', userCatalogsReadyFrame], ['p', /PRESET/], ['\r', /ADD CATALOG RESULT/], ['\r', userCatalogsReadyFrame], 'q'],
    refresh,
    {
      addCatalog: async (request) => {
        anthropicRequests.push(request);
        return { catalog: request.name, count: 6, catalogs: [request], resources: [] };
      },
    },
  );
  assert.equal(anthropicManager.result, true);
  assert.match(anthropicManager.renderedOutput, /anthropics\/skills/);
  assert.deepEqual(anthropicRequests, [
    {
      name: 'Anthropics',
      repository: 'https://github.com/anthropics/skills',
      mode: 'basic',
      entries: [],
    },
  ]);
  const githubPresetRequests = [];
  const githubPresetManager = await driveRefresh(
    [
      ['m', userCatalogsReadyFrame],
      ['p', /PRESET/],
      ['\x1b[B', /› Matt Pocock/],
      ['\x1b[B', /› GitHub Awesome Copilot/],
      ['\r', /ADD CATALOG RESULT/],
      ['\r', userCatalogsReadyFrame],
      'q',
    ],
    refresh,
    {
      addCatalog: async (request) => {
        githubPresetRequests.push(request);
        return { catalog: request.name, count: 3, catalogs: [request], resources: [] };
      },
    },
  );
  assert.equal(githubPresetManager.result, true);
  assert.deepEqual(githubPresetRequests, [
    {
      name: 'github-awesome-copilot',
      repository: 'https://github.com/github/awesome-copilot',
      mode: 'basic',
      entries: [],
    },
  ]);
  let cancelledPresetAdded = false;
  const cancelledPreset = await driveRefresh(
    [['m', userCatalogsReadyFrame], ['p', /ADD CATALOG PRESET/], ['\x1b', userCatalogsReadyFrame], 'q'],
    refresh,
    {
      addCatalog: async () => {
        cancelledPresetAdded = true;
        return { catalog: 'unexpected', count: 0 };
      },
    },
  );
  assert.equal(cancelledPreset.result, true);
  assert.ok(
    cancelledPreset.renderedOutput.indexOf('Anthropics') < cancelledPreset.renderedOutput.indexOf('Matt Pocock'),
  );
  assert.equal(cancelledPresetAdded, false);
  const transfers = [];
  const pastedConfiguration = JSON.stringify({
    catalog_version: 1,
    sources: [
      {
        name: 'Catalog One',
        repository: 'https://github.com/example/one',
        mode: 'basic',
        entries: [],
      },
      {
        name: 'Catalog Two',
        repository: 'https://github.com/example/two',
        mode: 'basic',
        entries: [],
      },
    ],
  });
  const importSummary = {
    added: ['Imported'],
    ignored: [{ name: 'Existing', reason: 'Catalog name already exists.' }],
    refreshed: [{ name: 'Imported', count: 4 }],
    refreshFailures: [{ name: 'Other', message: 'offline' }],
  };
  const transferManager = await driveRefresh(
    [
      ['m', userCatalogsReadyFrame],
      ['I', /Paste the JSON catalog configuration below/],
      [pastedConfiguration, /two","mode":"basic","entries":\[\]\}\]\}/],
      ['\x13', /SPACE\/ENTER TOGGLE/],
      ['\x1b[B', /› \[x\] Catalog Two/],
      ['\r', /› \[ \] Catalog Two/],
      ['\x13', /Added \(1\): Imported/],
      ['\r', userCatalogsReadyFrame],
      'q',
    ],
    refresh,
    {
      transferCatalogs: async (action, content) => {
        transfers.push({ action, content });
        return {
          catalogs: [{ name: 'Imported', repository }],
          resources: [],
          importSummary,
        };
      },
    },
  );
  assert.equal(transferManager.result, true);
  assert.equal(transfers.length, 1);
  assert.equal(transfers[0].action, 'import');
  assert.deepEqual(JSON.parse(transfers[0].content).sources, [
    {
      name: 'Catalog One',
      repository: 'https://github.com/example/one',
      mode: 'basic',
      entries: [],
    },
  ]);
  assert.match(transferManager.renderedOutput, /Catalog One/);
  assert.match(transferManager.renderedOutput, /Catalog Two/);
  let cancelledImport = false;
  const cancelImportManager = await driveRefresh(
    [
      ['m', userCatalogsReadyFrame],
      ['I', /CTRL\+S REVIEW/],
      [pastedConfiguration, /two","mode":"basic","entries":\[\]\}\]\}/],
      ['\x13', /SPACE\/ENTER TOGGLE/],
      ['\x1b', /Paste the JSON catalog configuration below/],
      ['\x1b', userCatalogsReadyFrame],
      'q',
    ],
    refresh,
    {
      transferCatalogs: async () => {
        cancelledImport = true;
        return {};
      },
    },
  );
  assert.equal(cancelImportManager.result, true);
  assert.equal(cancelledImport, false);
  assert.match(cancelImportManager.renderedOutput, /Catalog Two/);
  const exportTransfers = [];
  const exportManager = await driveRefresh(
    ['m', ['x', /EXPORT CATALOGS/], ['\r', /Configuration copied to clipboard/], ['\r', userCatalogsReadyFrame], 'q'],
    refresh,
    {
      transferCatalogs: async (action, content) => {
        exportTransfers.push({ action, content });
        return { catalogs: [{ name: 'Test', repository }], resources: [] };
      },
    },
  );
  assert.equal(exportManager.result, true);
  assert.deepEqual(exportTransfers, [{ action: 'export', content: '' }]);
  assert.match(exportManager.renderedOutput, /EXPORT CATALOGS/);
  const managementText = require('node:util')
    .stripVTControlCharacters(management.renderedOutput)
    .replace(/[│]/g, ' ')
    .replace(/\s+/g, ' ');
  assert.match(managementText, /FRESHNESS\s+UNKNOWN/);
  const currentManager = await driveRefresh([['m', /FRESHNESS UP TO DATE/], 'q'], refresh, {
    checkCatalogFreshness: async () => [{ name: 'Test', status: 'current' }],
  });
  assert.match(currentManager.renderedOutput, /UP TO DATE/);
  const outdatedManager = await driveRefresh([['m', /FRESHNESS OUTDATED/], 'q'], refresh, {
    checkCatalogFreshness: async () => [{ name: 'Test', status: 'outdated' }],
  });
  assert.match(outdatedManager.renderedOutput, /OUTDATED/);
  const addFromManager = await driveRefresh(
    [['m', userCatalogsReadyFrame], ['a', /ADD CATALOG/], ['\x1b', userCatalogsReadyFrame], 'q'],
    refresh,
    {
      addCatalog: async () => ({ catalog: 'New', count: 0 }),
    },
  );
  assert.equal(addFromManager.result, true);
  assert.match(addFromManager.renderedOutput, /ADD CATALOG/);
  const submittedDirectoryCatalogs = [];
  const directoryWizard = await driveRefresh(
    [
      'm',
      ['a', /Catalog name:/],
      ['DirectoryCatalog', /Catalog name: DirectoryCatalog/],
      ['\r', /HTTPS GitHub URL:/],
      [repository, /HTTPS GitHub URL: https:\/\/github.com\/example\/test/],
      ['\r', /Choose catalog setup:/],
      ['\x1b[C', /Choose catalog setup:/],
      ['\r', /Artifact kind: SKILL/],
      ['\r', /Repository-relative source path:/],
      ['custom/skills/', /Repository-relative source path: custom\/skills\//],
      ['\r', /Entries configured: 1/],
      ['\r', /Catalog added: DirectoryCatalog · 2 resources indexed/],
      ['\r', userCatalogsReadyFrame],
      'q',
    ],
    refresh,
    {
      addCatalog: async (request) => {
        submittedDirectoryCatalogs.push(request);
        return { catalog: 'DirectoryCatalog', count: 2 };
      },
    },
  );
  assert.equal(directoryWizard.result, true);
  assert.deepEqual(submittedDirectoryCatalogs[0], {
    name: 'DirectoryCatalog',
    repository,
    mode: 'custom',
    entries: [{ kind: 'skill', path: 'custom/skills' }],
  });
  assert.match(directoryWizard.renderedOutput, /Catalog added: DirectoryCatalog · 2 resources indexed/);
  const submittedEdits = [];
  const editedCatalog = await driveRefresh(
    [
      'm',
      ['e', /Catalog name: Test/],
      ['\r', /HTTPS GitHub URL: https:\/\/github.com\/example\/test/],
      ['\r', /Choose catalog setup:/],
      ['\r', /Entries configured: 1/],
      ['\x1b[3~', /Entries configured: 0/],
      ['a', /Artifact kind: SKILL/],
      ['\r', /Repository-relative source path:/],
      ['custom/skills/', /Repository-relative source path: custom\/skills\//],
      ['\r', /Entries configured: 1/],
      ['\r', /Catalog updated: Test · 1 resource indexed/],
      ['\r', userCatalogsReadyFrame],
      'q',
    ],
    refresh,
    {
      userCatalogs: [
        {
          name: 'Test',
          repository,
          mode: 'custom',
          entries: [{ kind: 'skill', path: 'custom/skills/old' }],
        },
      ],
      updateCatalog: async (originalName, request) => {
        submittedEdits.push({ originalName, request });
        return {
          catalog: request.name,
          count: 1,
          catalogs: [{ ...request }],
          resources: [],
        };
      },
    },
  );
  assert.equal(editedCatalog.result, true);
  assert.deepEqual(submittedEdits, [
    {
      originalName: 'Test',
      request: {
        name: 'Test',
        repository,
        mode: 'custom',
        entries: [{ kind: 'skill', path: 'custom/skills' }],
      },
    },
  ]);
  assert.match(editedCatalog.renderedOutput, /EDIT CATALOG/);
  assert.match(editedCatalog.renderedOutput, /Catalog updated: Test · 1 resource indexed/);
  const managerRemoved = [];
  const removedInManager = await driveRefresh(
    [
      'm',
      ['\x1b[3~', 'Choose a user catalog to remove:'],
      ['\r', 'CONFIRM CATALOG REMOVAL'],
      ['y', 'ENTER / ESC CLOSE'],
      ['\x1b', userCatalogsReadyFrame],
      'q',
    ],
    refresh,
    {
      removeCatalog: async (name) => {
        managerRemoved.push(name);
        return { catalogs: [], resources: [] };
      },
    },
  );
  assert.equal(removedInManager.result, true);
  assert.deepEqual(managerRemoved, ['Test']);
  const managerRefreshed = [];
  const refreshedInManager = await driveRefresh(
    [
      ['m', userCatalogsReadyFrame],
      ['r', /REFRESH CATALOGS/],
      ['\r', /Choose a user catalog to refresh/],
      ['\r', /Refreshed Test · 1 resource indexed/],
      ['\r', userCatalogsReadyFrame],
      'q',
    ],
    async (name) => {
      managerRefreshed.push(name);
      return {
        catalogs: [{ name: 'Test', repository }],
        resources: [],
        refreshed: [{ name, count: 1 }],
        failures: [],
      };
    },
  );
  assert.equal(refreshedInManager.result, true);
  assert.deepEqual(managerRefreshed, ['Test']);
  const freshnessChecks = [];
  const targetedFreshness = await driveRefresh(
    [
      ['m', userCatalogsReadyFrame],
      ['r', /REFRESH CATALOGS/],
      ['\r', /Choose a user catalog to refresh/],
      ['\x1b[B', /› Beta/],
      ['\r', /Refreshed Beta · 1 resource indexed/],
      ['\r', userCatalogsReadyFrame],
      'q',
    ],
    async (name) => ({
      catalogs: [
        { name: 'Alpha', repository: 'https://github.com/example/alpha' },
        { name: 'Beta', repository: 'https://github.com/example/beta' },
      ],
      resources: [],
      refreshed: [{ name, count: 1 }],
      failures: [],
    }),
    {
      userCatalogs: [
        { name: 'Alpha', repository: 'https://github.com/example/alpha' },
        { name: 'Beta', repository: 'https://github.com/example/beta' },
      ],
      checkCatalogFreshness: async (names) => {
        freshnessChecks.push(names);
        return (names || []).map((name) => ({ name, status: 'current' }));
      },
    },
  );
  assert.equal(targetedFreshness.result, true);
  assert.deepEqual(freshnessChecks, [['Alpha', 'Beta'], ['Beta']]);
  const initialDashboard = await driveRefresh(['q'], refresh);
  assert.equal(initialDashboard.result, true);
  assert.doesNotMatch(initialDashboard.renderedOutput, /A add catalog|Delete remove selected|R refresh/);
  assert.doesNotMatch(initialDashboard.renderedOutput, /G refresh/);
  assert.match(initialDashboard.renderedOutput, /↑↓ navigate/);
  assert.match(initialDashboard.renderedOutput, /F filter/);
  assert.match(initialDashboard.renderedOutput, /↑↓ navigate/);
  const ignoredInventoryRefresh = await driveRefresh(
    [['g', null], ['m', userCatalogsReadyFrame], ['i', /INSTALLED RESOURCES[\s\S]*Q quit/], 'q'],
    refresh,
  );
  assert.equal(ignoredInventoryRefresh.result, true);
  assert.deepEqual(refreshed, []);
  const refreshedOne = await driveRefresh(
    [
      ['m', userCatalogsReadyFrame],
      ['r', /REFRESH CATALOGS/],
      ['\r', /Choose a user catalog to refresh/],
      ['\r', /Refreshed Test · 2 resources indexed/],
      ['\r', userCatalogsReadyFrame],
      'q',
    ],
    refresh,
  );
  assert.equal(refreshedOne.result, true);
  assert.deepEqual(refreshed, ['Test']);
  const refreshedAll = await driveRefresh(
    [
      ['m', userCatalogsReadyFrame],
      ['r', /REFRESH CATALOGS/],
      ['\x1b[C', /REFRESH CATALOGS/],
      ['\r', /Refreshed 1 catalog · 2 resources indexed/],
      ['\r', userCatalogsReadyFrame],
      'q',
    ],
    refresh,
  );
  assert.equal(refreshedAll.result, true);
  assert.deepEqual(refreshed, ['Test', undefined]);
  const failedRefresh = await driveRefresh(
    [
      ['m', userCatalogsReadyFrame],
      ['r', /REFRESH CATALOGS/],
      ['\r', /Choose a user catalog to refresh/],
      ['\r', /Catalog Test was not refreshed/],
      ['s', /CATALOG REFRESH ERRORS/],
    ],
    async () => ({
      catalogs: [{ name: 'Test', repository }],
      resources: [],
      refreshed: [],
      failures: [{ name: 'Test', message: 'Repository not found.' }],
    }),
    {},
    [/Catalog Test was not refreshed/, userCatalogsReadyFrame],
  );
  assert.equal(failedRefresh.result, false);
  assert.ok(failedRefresh.renderedOutput.includes('Catalog Test was not refreshed.'));
  assert.ok(failedRefresh.renderedOutput.includes('S SHOW DETAILS'));
  assert.ok(failedRefresh.renderedOutput.includes('CATALOG REFRESH ERRORS'));
  assert.ok(failedRefresh.renderedOutput.includes('Test: Repository not found.'));
  assert.equal(failedRefresh.renderedOutput.includes('Refreshed Test · 0 resources indexed.'), false);
});

test('dashboard toggles catalog management details with D', async (t) => {
  const { PassThrough } = require('node:stream');
  const { runDashboard } = await import('../dashboard.mts');
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 160;
  output.rows = 24;
  let rendered = '';
  output.on('data', (chunk) => {
    rendered += chunk.toString();
  });
  const done = runDashboard([], input, output, [], {
    userCatalogs: [{ name: 'Sample', repository: 'example/sample' }],
    checkCatalogFreshness: async () => [{ name: 'Sample', status: 'current' }],
  });
  t.after(async () => {
    if (!input.destroyed) input.destroy();
    await done.catch(() => {});
    if (!output.destroyed) output.destroy();
  });
  await waitForOutput(
    output,
    () => rendered,
    (text) => text.includes('INSTALLED RESOURCES'),
    'initial inventory',
  );
  input.write('m');
  await waitForOutput(
    output,
    () => rendered,
    (text) =>
      selectedDetailsFrame(text).includes('CONNECTED CATALOGS 1') &&
      selectedDetailsFrame(text).includes('REPOSITORY example/sample'),
    'catalog management details',
  );
  const managementFrame = selectedDetailsFrame(rendered);
  assert.match(managementFrame, /Sample/);
  assert.match(managementFrame, /REPOSITORY example\/sample/);
  assert.match(managementFrame, /FRESHNESS UP TO DATE/);
  assert.match(managementFrame, /CONNECTED CATALOGS 1/);
  assert.match(managementFrame, /FRESHNESS UP TO DATE/);
  const beforeHide = rendered.length;
  input.write('d');
  await waitForOutput(
    output,
    () => rendered.slice(beforeHide),
    (text) => text.includes('\u001b[?2026l') && !selectedDetailsFrame(text).includes('FRESHNESS UP TO DATE'),
    'hidden management details frame',
  );
  const beforeShow = rendered.length;
  input.write('d');
  await waitForOutput(
    output,
    () => rendered.slice(beforeShow),
    (text) => text.includes('\u001b[?2026l') && selectedDetailsFrame(text).includes('FRESHNESS UP TO DATE'),
    'shown management details frame',
  );
  input.write('q');
  assert.equal(await done, true);
  input.destroy();
  output.destroy();
});
