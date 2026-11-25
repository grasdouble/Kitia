import assert from 'node:assert/strict';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const vite = await createServer({
  configFile: path.join(projectRoot, 'web/vite.config.ts'),
  logLevel: 'silent',
  server: { middlewareMode: true },
  appType: 'custom',
});
after(() => vite.close());
const { createTuiDemoSession } = await vite.ssrLoadModule('/src/components/demo/tuiDemoSession.ts');

const fixture = (session, kind, id) =>
  session.actions.catalogResources.find((entry) => entry.kind === kind && entry.id === id);

test('all supported kind, scope, and destination selections retain paths and metadata on update', async () => {
  for (const kind of ['skill', 'agent', 'instruction']) {
    for (const scope of ['project', 'user']) {
      const selections =
        kind === 'skill'
          ? [undefined, ['standard'], ['copilot'], ['claude'], ['standard', 'copilot', 'claude']]
          : [undefined, ['copilot'], ['claude'], ['copilot', 'claude']];
      for (const destinations of selections) {
        const session = createTuiDemoSession();
        const source = fixture(
          session,
          kind,
          kind === 'skill' ? 'testing' : kind === 'agent' ? 'planner' : 'documentation',
        );
        const installed = await session.actions.execute('install', source, { scope, destinations });
        if (kind === 'instruction' && scope === 'user') {
          assert.equal(installed.code, 1);
          assert.match(installed.failure.userMessage, /project scope only/);
          continue;
        }
        assert.equal(installed.code, 0);
        const row = installed.resources.find(
          (entry) => entry.kind === kind && entry.id === source.id && entry.scope === scope,
        );
        const id = source.id;
        const copilotDirectory = scope === 'user' ? '.copilot' : '.github';
        const paths =
          kind === 'skill'
            ? {
                standard: `.agents/skills/${id}/SKILL.md`,
                copilot: `${copilotDirectory}/skills/${id}/SKILL.md`,
                claude: `.claude/skills/${id}/SKILL.md`,
              }
            : kind === 'agent'
              ? { copilot: `${copilotDirectory}/agents/${id}.agent.md`, claude: `.claude/agents/${id}.md` }
              : { copilot: `.github/instructions/${id}.instructions.md`, claude: `.claude/rules/${id}.md` };
        assert.deepEqual(
          row.paths,
          (destinations ?? [kind === 'skill' ? 'standard' : 'copilot']).map((id) => paths[id]),
        );
        assert.match(row.source_ref, /^[a-f0-9]{40}$/);
        const versions = await session.actions.listSourceVersions(row);
        const updated = await session.actions.execute('update', row, {
          ref: versions[2].sha,
          destinations: ['claude'],
        });
        assert.equal(updated.code, 0);
        const updatedRow = updated.resources.find(
          (entry) => entry.kind === kind && entry.id === source.id && entry.scope === scope,
        );
        assert.deepEqual(updatedRow.paths, row.paths);
        assert.equal(updatedRow.source_ref, versions[2].sha);
        assert.equal(updatedRow.version, versions[2].prefix);
        assert.ok(updatedRow.issues.some((issue) => issue.code === 'UPDATE_AVAILABLE'));
      }
    }
  }
});

test('adding a destination preserves existing files and update and uninstall affect only the chosen scope', async () => {
  for (const [kind, id, paths] of [
    ['skill', 'testing', ['.agents/skills/testing/SKILL.md', '.claude/skills/testing/SKILL.md']],
    ['agent', 'planner', ['.github/agents/planner.agent.md', '.claude/agents/planner.md']],
    [
      'instruction',
      'documentation',
      ['.github/instructions/documentation.instructions.md', '.claude/rules/documentation.md'],
    ],
  ]) {
    const session = createTuiDemoSession();
    const source = fixture(session, kind, id);
    const versions = await session.actions.listSourceVersions(source);
    const project = () => session.resources.find((entry) => entry.id === id && entry.scope === 'project');
    const user = () => session.resources.find((entry) => entry.id === id && entry.scope === 'user');
    if (kind !== 'instruction') {
      const userInstall = await session.actions.execute('install', source, { scope: 'user' });
      assert.equal(userInstall.code, 0);
    }
    const beforeUser = user();
    const initial = await session.actions.execute('install', source, kind === 'skill' ? { ref: versions[2].sha } : {});
    assert.equal(initial.code, 0);
    const before = await session.actions.execute('preview', project(), {});
    assert.deepEqual(
      before.previewFiles.map(({ path }) => path),
      [paths[0]],
    );
    const addition = await session.actions.execute('install', source, { destinations: ['claude'] });
    assert.equal(addition.code, 0);
    assert.deepEqual(project().paths, paths);
    const after = await session.actions.execute('preview', project(), {});
    assert.deepEqual(after.previewFiles[0], before.previewFiles[0]);
    if (kind === 'skill') {
      assert.deepEqual(project().issues, [{ code: 'UPDATE_AVAILABLE', paths: [paths[0]] }]);
      assert.notEqual(after.previewFiles[1].content, after.previewFiles[0].content);
    }
    if (kind === 'instruction') assert.match(after.previewFiles[1].content, /^---\npaths: \["\*\*\/\*\.md"\]/);
    assert.deepEqual(user(), beforeUser);
    const duplicate = await session.actions.execute('install', source, { destinations: ['claude'] });
    assert.equal(duplicate.code, 1);
    const update = await session.actions.execute('update', project(), { ref: versions[0].sha });
    assert.equal(update.code, 0);
    assert.deepEqual(project().paths, paths);
    assert.equal(project().source_ref, versions[0].sha);
    assert.equal((await session.actions.execute('uninstall', project(), {})).code, 0);
    assert.equal(project(), undefined);
    assert.deepEqual(user(), beforeUser);
  }
});

test('adding a file destination cannot change the pin of an installed copy', async () => {
  const session = createTuiDemoSession();
  const source = fixture(session, 'agent', 'planner');
  const versions = await session.actions.listSourceVersions(source);
  const initial = await session.actions.execute('install', source, { ref: versions[2].sha });
  assert.equal(initial.code, 0);
  const snapshot = session.resources;
  const addition = await session.actions.execute('install', source, { destinations: ['claude'] });
  assert.equal(addition.code, 1);
  assert.match(addition.failure.userMessage, /Update the existing demo installation/);
  assert.deepEqual(session.resources, snapshot);
});

test('preview uses the installed revision and bundled content without claiming an audit', async () => {
  const session = createTuiDemoSession();
  const source = fixture(session, 'skill', 'testing');
  const versions = await session.actions.listSourceVersions(source);
  assert.equal(versions.length, 3);
  assert.ok(versions.every(({ sha }) => /^[a-f0-9]{40}$/.test(sha)));
  const before = await session.actions.execute('preview', source, {});
  const installed = await session.actions.execute('install', source, {
    ref: versions[1].sha,
    scope: 'user',
    destinations: ['standard', 'claude'],
  });
  const row = installed.resources.find((entry) => entry.id === source.id && entry.scope === 'user');
  await session.actions.refreshCatalog('toolkit');
  const preview = await session.actions.execute('preview', row, {});
  assert.equal(preview.previewFiles.length, 2);
  assert.match(preview.previewFiles[0].content, /Use isolated fixtures and deterministic inputs/);
  assert.match(preview.previewFiles[0].content, new RegExp(versions[1].sha));
  assert.notEqual(preview.previewFiles[0].content, before.previewFiles[0].content);
  assert.match(preview.previewAuditLines.join('\n'), /no security audit was run/i);
  assert.ok(preview.previewTree.some((line) => line.includes(row.paths[0])));
  assert.equal(
    fixture(session, 'skill', 'testing').source_ref,
    versions[0].sha,
    'selecting a revision does not repin the catalog',
  );
});

test('conflicts protect destination ownership even with force; scope remains independent', async () => {
  const session = createTuiDemoSession();
  await session.actions.addCatalog({
    name: 'simulated',
    repository: 'https://github.com/example/anything',
    mode: 'basic',
    entries: [],
  });
  const duplicate = session.actions.catalogResources.find(
    (entry) => entry.catalog === 'simulated' && entry.id === 'code-review',
  );
  assert.match(duplicate.description, /Simulated bundled fixture; no GitHub fetch/);
  const conflict = await session.actions.execute('install', duplicate, {
    scope: 'project',
    destinations: ['claude'],
    force: true,
  });
  assert.equal(conflict.code, 1);
  assert.match(conflict.failure.userMessage, /destination conflict/);
  const userInstall = await session.actions.execute('install', duplicate, { scope: 'user', destinations: ['claude'] });
  assert.equal(userInstall.code, 0);
  const unmanaged = session.resources.find((entry) => entry.managed === false);
  assert.equal((await session.actions.execute('uninstall', unmanaged, {})).code, 1);
  assert.equal((await session.actions.execute('remove-unmanaged', unmanaged, {})).code, 0);
  assert.ok(!session.resources.some((entry) => entry.managed === false));
});

test('refresh and catalog edits never rewrite installed content; removal retains installations', async () => {
  const session = createTuiDemoSession();
  assert.equal((await session.actions.checkCatalogFreshness(['team']))[0].status, 'outdated');
  const source = fixture(session, 'agent', 'planner');
  const installed = await session.actions.execute('install', source, {
    scope: 'project',
    destinations: ['copilot', 'claude'],
  });
  const row = installed.resources.find((entry) => entry.id === 'planner');
  const before = await session.actions.execute('preview', row, {});
  await session.actions.refreshCatalog('team');
  assert.equal((await session.actions.checkCatalogFreshness(['team']))[0].status, 'current');
  const after = await session.actions.execute('preview', row, {});
  assert.deepEqual(after.previewFiles, before.previewFiles);
  await session.actions.updateCatalog('team', {
    name: 'renamed',
    repository: 'https://github.com/demo/team',
    mode: 'basic',
    entries: [],
  });
  assert.ok(session.actions.catalogResources.some((entry) => entry.catalog === 'renamed'));
  assert.ok(!session.actions.catalogResources.some((entry) => entry.catalog === 'team'));
  assert.ok(
    session.resources.find((entry) => entry.id === 'planner').removed,
    'CLI catalog edits do not migrate installation ownership',
  );
  await session.actions.removeCatalog('renamed');
  assert.equal((await session.actions.execute('preview', row, {})).code, 0);
  assert.equal((await session.actions.execute('uninstall', row, {})).code, 0);
});

test('catalog import parses real JSON atomically, reports duplicates, and exports actual configuration', async () => {
  const session = createTuiDemoSession();
  const before = session.actions.userCatalogs;
  await assert.rejects(session.actions.transferCatalogs('import', '{invalid'), /valid catalog JSON/);
  await assert.rejects(
    session.actions.transferCatalogs(
      'import',
      JSON.stringify({
        catalog_version: 1,
        sources: [
          { name: 'valid', repository: 'https://github.com/example/valid' },
          {
            name: 'invalid',
            repository: 'https://github.com/example/invalid',
            mode: 'custom',
            entries: [{ kind: 'skill', path: '../escape' }],
          },
        ],
      }),
    ),
    /safe paths/,
  );
  assert.deepEqual(session.actions.userCatalogs, before);
  const imported = await session.actions.transferCatalogs(
    'import',
    JSON.stringify({
      catalog_version: 1,
      sources: [
        before[0],
        {
          name: 'new',
          repository: 'https://github.com/example/new',
          mode: 'custom',
          entries: [{ kind: 'skill', path: 'skills/testing' }],
        },
      ],
    }),
  );
  assert.deepEqual(imported.importSummary.added, ['new']);
  assert.equal(imported.importSummary.ignored.length, 1);
  assert.equal(imported.resources.filter((entry) => entry.catalog === 'new').length, 1);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let clipboard;
  try {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        clipboard: {
          async writeText(text) {
            clipboard = text;
          },
        },
      },
    });
    await session.actions.transferCatalogs('export', '');
    assert.deepEqual(JSON.parse(clipboard), {
      catalog_version: 1,
      sources: session.actions.userCatalogs,
    });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    await assert.rejects(session.actions.transferCatalogs('export', ''), /No configuration was copied/);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else delete globalThis.navigator;
  }
});

test('new sessions and returned snapshots cannot mutate another private store', async () => {
  const first = createTuiDemoSession();
  const second = createTuiDemoSession();
  const firstSnapshot = first.resources;
  firstSnapshot[0].paths.push('not-a-real-path');
  first.actions.catalogResources[0].limitations.push('external mutation');
  assert.ok(!first.resources.some((entry) => entry.paths.includes('not-a-real-path')));
  assert.ok(!first.actions.catalogResources[0].limitations.includes('external mutation'));
  await first.actions.removeCatalog('toolkit');
  assert.equal(second.actions.userCatalogs.length, 2);
  assert.equal(createTuiDemoSession().actions.userCatalogs.length, 2);
});
