'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createSourceIndex } = require('../../catalogs/discovery.ts');
const { latestSourceVersionAtRef } = require('../../resources/history.ts');
const { readInstallState } = require('../inventory.ts');
const { findUnmanagedArtifacts } = require('../discovery.ts');
const { installedFingerprint } = require('../../installations/files.ts');
const { collectInstalledScopes, checkInstalledResources } = require('../checks.ts');
const { enrichInstalledResources } = require('../../resources/queries.ts');
const { dashboardStatus } = require('../view.ts');
const { renderInstalledResources } = require('../../../tui/terminal.ts');
const {
  setupTemporaryDirectory,
  writeJson,
  createSource,
} = require('../../../../test/fixtures/source-catalog-fixtures.js');

const makeTemporaryDirectory = setupTemporaryDirectory();

test('skill freshness compares the latest SKILL.md revision at installed and catalog pins', () => {
  const temporary = makeTemporaryDirectory('kitia-skill-freshness-');
  const target = path.join(temporary, 'target');
  fs.mkdirSync(target);
  const skillCommit = '26d8943616ffc1be09e121a3a666c284c526a761';
  const previousRepositoryHead = '6f86fd3c8aeda1edebd04ec66261e36ec1d06b7c';
  const resource = {
    catalog: 'AI-Kit',
    id: 'conventional-commits',
    kind: 'skill',
    description: 'Conventional commits guidance.',
    source_repository: 'grasdouble/AI-Kit',
    source_path: 'skills/conventional-commits',
    source_ref: previousRepositoryHead,
    license_status: 'MIT',
  };
  const relativePath = '.agents/skills/conventional-commits/SKILL.md';
  let installedRef = skillCommit;
  let skill = [
    '---',
    'name: conventional-commits',
    'description: Conventional commits guidance.',
    'metadata:',
    `  github-repo: "https://github.com/${resource.source_repository}"`,
    `  github-path: "${resource.source_path}"`,
    `  github-ref: "${installedRef}"`,
    `  github-pinned: "${installedRef}"`,
    '---',
    '',
    'Synthetic body.',
    '',
  ].join('\n');
  const skillFile = path.join(target, relativePath);
  fs.mkdirSync(path.dirname(skillFile), { recursive: true });
  fs.writeFileSync(skillFile, skill);
  const lockFile = path.join(target, '.agents/kitia-lock.json');
  writeJson(lockFile, {
    lock_version: 1,
    catalog: 'grasdouble/Kitia',
    sources: {
      'AI-Kit': {
        skills: {
          'conventional-commits': {
            source_repository: resource.source_repository,
            source_path: resource.source_path,
            source_ref: installedRef,
            files: { [relativePath]: installedFingerprint(target, relativePath) },
          },
        },
      },
    },
  });
  const writeInstalledRef = (ref) => {
    skill = skill.replaceAll(installedRef, ref);
    installedRef = ref;
    fs.writeFileSync(skillFile, skill);
    const state = readInstallState(target);
    const record = state.sources['AI-Kit'].skills['conventional-commits'];
    record.source_ref = installedRef;
    record.files[relativePath] = installedFingerprint(target, relativePath);
    writeJson(lockFile, state);
  };
  const history = (revisions) => {
    let calls = 0;
    const run = (program, args) => {
      calls += 1;
      assert.equal(program, 'gh');
      assert.equal(args[0], 'api');
      assert.equal(args[1], '-X');
      assert.equal(args[2], 'GET');
      assert.equal(args[3], 'repos/grasdouble/AI-Kit/commits');
      assert.ok(args.includes('-f'));
      assert.ok(args.includes(`path=${resource.source_path}/SKILL.md`));
      assert.ok(args.includes('-F'));
      assert.ok(args.includes('per_page=1'));
      const ref = args.find((arg) => arg.startsWith('sha='))?.slice(4);
      assert.ok(ref && Object.hasOwn(revisions, ref), `unexpected history lookup for ${ref}`);
      return JSON.stringify([{ sha: revisions[ref] }]);
    };
    return { run, calls: () => calls, revisions };
  };

  const initialHistory = history({
    [skillCommit]: skillCommit,
    [previousRepositoryHead]: skillCommit,
  });
  const initial = checkInstalledResources(target, [resource], { run: initialHistory.run });
  assert.equal(initialHistory.calls(), 2, 'both installed and catalog pins need path-history lookups');
  assert.equal(initial.updateAvailable, false);
  assert.equal(initial.resources[0].status, 'current');
  assert.equal(dashboardStatus(initial.resources[0]), 'current');
  const dashboardHistory = history({
    [skillCommit]: skillCommit,
    [previousRepositoryHead]: skillCommit,
  });
  const initialInventory = collectInstalledScopes({ project: target, user: target }, [resource], {
    run: dashboardHistory.run,
  });
  assert.deepEqual(initialInventory.errors, []);
  assert.equal(dashboardHistory.calls(), 2, 'inventory scopes share both path-history lookups');
  assert.equal(initialInventory.resources[0].status, 'current');
  assert.equal(dashboardStatus(initialInventory.resources[0]), 'current');

  writeInstalledRef(previousRepositoryHead);
  const newerRepositoryHead = '7'.repeat(40);
  resource.source_ref = newerRepositoryHead;
  const unrelatedRepositoryHistory = history({
    [previousRepositoryHead]: skillCommit,
    [newerRepositoryHead]: skillCommit,
  });
  assert.notEqual(previousRepositoryHead, newerRepositoryHead);
  assert.equal(
    unrelatedRepositoryHistory.revisions[previousRepositoryHead],
    unrelatedRepositoryHistory.revisions[newerRepositoryHead],
    'different repository commits with the same SKILL.md path commit must be current',
  );
  const unchangedAtNewerRepositoryHead = checkInstalledResources(target, [resource], {
    run: unrelatedRepositoryHistory.run,
  });
  assert.equal(unrelatedRepositoryHistory.calls(), 2);
  assert.equal(unchangedAtNewerRepositoryHead.updateAvailable, false);
  assert.equal(unchangedAtNewerRepositoryHead.resources[0].status, 'current');
  assert.equal(dashboardStatus(unchangedAtNewerRepositoryHead.resources[0]), 'current');

  const changedCatalogHead = '8'.repeat(40);
  resource.source_ref = changedCatalogHead;
  const changedHistory = history({
    [previousRepositoryHead]: skillCommit,
    [changedCatalogHead]: 'c'.repeat(40),
  });
  const changed = checkInstalledResources(target, [resource], { run: changedHistory.run });
  assert.equal(changedHistory.calls(), 2);
  assert.equal(changed.updateAvailable, true);
  assert.equal(changed.resources[0].issues[0].code, 'UPDATE_AVAILABLE');
  assert.equal(dashboardStatus(changed.resources[0]), 'update');
  assert.throws(
    () =>
      checkInstalledResources(target, [resource], {
        run: () => {
          throw new Error('offline');
        },
      }),
    /Cannot check GitHub source history/,
  );
  const unavailableHistory = collectInstalledScopes({ project: target }, [resource], {
    run: () => {
      throw new Error('offline');
    },
  });
  assert.equal(unavailableHistory.resources.length, 0);
  assert.match(unavailableHistory.errors[0].message, /Cannot check GitHub source history/);
});

for (const { kind, id, sourcePath, installPath } of [
  {
    kind: 'agent',
    id: 'release-helper',
    sourcePath: 'agents/release-helper.agent.md',
    installPath: '.copilot/agents/release-helper.agent.md',
  },
  {
    kind: 'instruction',
    id: 'review-policy',
    sourcePath: 'instructions/review-policy.instructions.md',
    installPath: '.github/instructions/review-policy.instructions.md',
  },
]) {
  test(`${kind} freshness tracks its exact source file at both repository pins`, () => {
    const temporary = makeTemporaryDirectory(`kitia-${kind}-freshness-`);
    const target = path.join(temporary, 'target');
    fs.mkdirSync(target);
    const installedRef = 'a'.repeat(40);
    const catalogRef = 'b'.repeat(40);
    const sourceRevision = 'c'.repeat(40);
    const updatedCatalogRef = 'd'.repeat(40);
    const updatedSourceRevision = 'e'.repeat(40);
    const resource = {
      catalog: 'AI-Kit',
      id,
      kind,
      description: `${kind} fixture.`,
      source_repository: 'grasdouble/AI-Kit',
      source_path: sourcePath,
      source_ref: catalogRef,
      license_status: 'MIT',
    };
    const installedText = `Managed ${kind} fixture.\n`;
    const installedFile = path.join(target, installPath);
    fs.mkdirSync(path.dirname(installedFile), { recursive: true });
    fs.writeFileSync(installedFile, installedText);
    const lockFile = path.join(target, '.agents/kitia-lock.json');
    writeJson(lockFile, {
      lock_version: 1,
      catalog: 'grasdouble/Kitia',
      sources: {
        'AI-Kit': {
          [`${kind}s`]: {
            [id]: {
              source_repository: resource.source_repository,
              source_path: resource.source_path,
              source_ref: installedRef,
              files: { [installPath]: installedFingerprint(target, installPath) },
            },
          },
        },
      },
    });
    const history = (revisions) => {
      let calls = 0;
      const run = (program, args) => {
        calls += 1;
        assert.equal(program, 'gh');
        assert.equal(args[0], 'api');
        assert.equal(args[1], '-X');
        assert.equal(args[2], 'GET');
        assert.equal(args[3], 'repos/grasdouble/AI-Kit/commits');
        assert.ok(args.includes(`path=${sourcePath}`), `${kind} history must query its exact source file`);
        const ref = args.find((arg) => arg.startsWith('sha='))?.slice(4);
        assert.ok(ref && Object.hasOwn(revisions, ref), `unexpected ${kind} history lookup for ${ref}`);
        return JSON.stringify([{ sha: revisions[ref] }]);
      };
      return { run, calls: () => calls };
    };

    const sameFileHistory = history({
      [installedRef]: sourceRevision,
      [catalogRef]: sourceRevision,
    });
    const current = checkInstalledResources(target, [resource], { run: sameFileHistory.run });
    assert.equal(sameFileHistory.calls(), 2);
    assert.equal(current.updateAvailable, false);
    assert.equal(current.resources[0].status, 'current');
    assert.equal(dashboardStatus(current.resources[0]), 'current');

    resource.source_ref = updatedCatalogRef;
    const changedFileHistory = history({
      [installedRef]: sourceRevision,
      [updatedCatalogRef]: updatedSourceRevision,
    });
    const changed = checkInstalledResources(target, [resource], { run: changedFileHistory.run });
    assert.equal(changedFileHistory.calls(), 2);
    assert.equal(changed.updateAvailable, true);
    assert.equal(changed.resources[0].issues[0].code, 'UPDATE_AVAILABLE');
    assert.equal(dashboardStatus(changed.resources[0]), 'update');

    const unavailable = collectInstalledScopes({ project: target }, [resource], {
      run: () => {
        throw new Error('offline');
      },
    });
    assert.equal(unavailable.resources.length, 0);
    assert.match(unavailable.errors[0].message, /Cannot check GitHub source history/);
    assert.equal(
      latestSourceVersionAtRef(
        { ...resource, source_repository: 'https://gitlab.com/example/AI-Kit' },
        installedRef,
        () => assert.fail('non-GitHub resources must retain exact-pin comparison'),
      ),
      null,
    );
    const unsupported = { source_path: sourcePath.slice(0, sourcePath.lastIndexOf('/')) };
    const state = readInstallState(target);
    const record = state.sources['AI-Kit'][`${kind}s`][id];
    Object.assign(record, unsupported);
    writeJson(lockFile, state);
    const fallback = checkInstalledResources(target, [{ ...resource, ...unsupported }], {
      run: () => assert.fail('uninterpretable paths must retain exact-pin comparison'),
    });
    assert.equal(fallback.updateAvailable, true);
    assert.equal(fallback.resources[0].issues[0].code, 'UPDATE_AVAILABLE');
  });
}

test('dashboard lists unmanaged skills, agents, and instructions without a catalog', () => {
  const temporary = makeTemporaryDirectory('kitia-unmanaged-inventory-');
  const target = path.join(temporary, 'project');
  fs.mkdirSync(target, { recursive: true });
  const externalRepository = 'https://github.com/example/external-skills';
  const sourceIndex = createSourceIndex(
    externalRepository,
    'External',
    createSource(temporary, 'external-upstream', externalRepository),
  );
  const externalResource = {
    ...sourceIndex.resources[0],
    catalog: 'External',
    source_repository: sourceIndex.source_repository,
    source_ref: sourceIndex.source_ref,
  };
  const writeArtifact = (relativePath, content) => {
    const file = path.join(target, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  const sourceSkillPath = '.agents/skills/demo-skill/SKILL.md';
  writeArtifact(
    sourceSkillPath,
    [
      '---',
      'name: demo-skill',
      'description: Installed outside Kitia.',
      'metadata:',
      `  github-repo: "${externalResource.source_repository}"`,
      `  github-path: "${externalResource.source_path}"`,
      `  github-pinned: "${externalResource.source_ref}"`,
      '---',
      '',
      'External skill.',
      '',
    ].join('\n'),
  );
  writeArtifact('.claude/skills/category/local-skill/SKILL.md', 'Local skill.');
  writeArtifact(
    '.claude/agents/review-helper.md',
    ['---', 'name: review-helper', 'description: Reviews code changes.', '---', ''].join('\n'),
  );
  writeArtifact(
    '.github/instructions/repo-rules.instructions.md',
    ['---', 'description: Repository-specific guidance.', '---', ''].join('\n'),
  );
  assert.ok(
    findUnmanagedArtifacts(target).some((artifact) => artifact.kind === 'instruction' && artifact.id === 'repo-rules'),
    JSON.stringify(findUnmanagedArtifacts(target)),
  );
  const trackedPath = '.agents/skills/kitia-tracked/SKILL.md';
  writeArtifact(trackedPath, 'Tracked through Kitia.');
  const state = readInstallState(target);
  state.sources.Tracked = {
    skills: {
      'kitia-tracked': {
        source_repository: 'example/tracked',
        source_path: 'skills/kitia-tracked',
        source_ref: 'a'.repeat(40),
        files: { [trackedPath]: installedFingerprint(target, trackedPath) },
      },
    },
  };
  writeJson(path.join(target, '.agents/kitia-lock.json'), state);

  const result = collectInstalledScopes({ project: target }, [externalResource]);
  const unmanaged = result.resources.filter((resource) => resource.managed === false);
  assert.deepEqual(
    unmanaged.map(({ kind, id, catalog }) => `${catalog}:${kind}:${id}`).sort(),
    ['-:agent:review-helper', '-:instruction:repo-rules', '-:skill:category/local-skill', '-:skill:demo-skill'],
    JSON.stringify(result),
  );
  assert.ok(unmanaged.every((resource) => resource.status === 'unmanaged' && resource.scope === 'project'));
  const resource = (id) => unmanaged.find((entry) => entry.id === id);
  assert.equal(resource('demo-skill').description, 'Installed outside Kitia.');
  assert.equal(resource('review-helper').description, 'Reviews code changes.');
  assert.equal(resource('repo-rules').description, 'Repository-specific guidance.');
  assert.equal(resource('category/local-skill').description, '.claude/skills/category/local-skill/SKILL.md');
  const rendered = renderInstalledResources(enrichInstalledResources(result.resources, []), {
    columns: 120,
    isTTY: false,
  });
  assert.match(rendered, /project\s+-\s+skill\s+demo-skill\s+unmanaged/);
  assert.match(rendered, /Installed outside Kitia\./);
  assert.deepEqual(result.errors, []);
  assert.ok(
    result.resources.some(
      (resource) => resource.catalog === 'Tracked' && resource.id === 'kitia-tracked' && resource.managed !== false,
    ),
  );
});
