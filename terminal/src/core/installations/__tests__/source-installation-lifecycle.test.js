'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { uninstallSourceResource, updateSourceResources } = require('../mutations.ts');
const { runGhSkill, buildSourceSkillArgs } = require('../gh-skill.ts');
const { readInstalledSourceSkills, readInstallState } = require('../../inventory/inventory.ts');
const { runSourceOperation } = require('../lifecycle.ts');
const { loadCommandCatalogs } = require('../../../cli/loading.ts');
const { installedFingerprint } = require('../files.ts');
const { checkInstalledResources } = require('../../inventory/checks.ts');
const { setupTemporaryDirectory } = require('../../../../test/fixtures/source-catalog-fixtures.js');

const makeTemporaryDirectory = setupTemporaryDirectory();

test('source skills can be uninstalled from inventory after their catalog is removed', () => {
  const temporary = makeTemporaryDirectory('kitia-removed-source-');
  const target = path.join(temporary, 'target');
  const relativePath = '.agents/skills/retired-skill/SKILL.md';
  const skillFile = path.join(target, relativePath);
  fs.mkdirSync(path.dirname(skillFile), { recursive: true });
  fs.writeFileSync(
    skillFile,
    [
      '---',
      'name: retired-skill',
      'description: An installed skill from a removed source.',
      'metadata:',
      '  github-repo: "https://github.com/example/retired"',
      '  github-path: "skills/retired-skill"',
      `  github-ref: "${'a'.repeat(40)}"`,
      '---',
      '',
      'Tracked skill body.',
      '',
    ].join('\n'),
  );
  const record = {
    source_repository: 'example/retired',
    source_path: 'skills/retired-skill',
    source_ref: 'a'.repeat(40),
    files: { [relativePath]: installedFingerprint(target, relativePath) },
  };
  fs.mkdirSync(path.join(target, '.agents'), { recursive: true });
  fs.writeFileSync(
    path.join(target, '.agents/kitia-lock.json'),
    JSON.stringify({
      lock_version: 1,
      catalog: 'grasdouble/Kitia',
      sources: { retired: { skills: { 'retired-skill': record } } },
    }),
  );

  const loaded = loadCommandCatalogs(
    {
      command: 'uninstall',
      kind: 'skill',
      target,
    },
    () => assert.fail('uninstall must not need source discovery'),
  );
  assert.deepEqual(
    loaded.sourceResources.map(({ catalog, id }) => `${catalog}:${id}`),
    ['retired:retired-skill'],
  );
  uninstallSourceResource(loaded.sourceResources[0], target);
  assert.equal(fs.existsSync(skillFile), false);
  assert.equal(fs.existsSync(path.dirname(skillFile)), false);
});

test('identical skill IDs from different sources cannot collide in one installation target', () => {
  const temporary = makeTemporaryDirectory('kitia-source-id-collision-');
  const target = path.join(temporary, 'target');
  const relativePath = '.agents/skills/demo-skill/SKILL.md';
  const skillFile = path.join(target, relativePath);
  fs.mkdirSync(path.dirname(skillFile), { recursive: true });
  fs.writeFileSync(skillFile, 'Tracked by another source.\n');
  const record = {
    source_repository: 'example/team-beta',
    source_path: 'skills/demo-skill',
    source_ref: 'b'.repeat(40),
    files: { [relativePath]: installedFingerprint(target, relativePath) },
  };
  fs.mkdirSync(path.join(target, '.agents'), { recursive: true });
  fs.writeFileSync(
    path.join(target, '.agents/kitia-lock.json'),
    JSON.stringify({
      lock_version: 1,
      catalog: 'grasdouble/Kitia',
      sources: { 'team-beta': { skills: { 'demo-skill': record } } },
    }),
  );

  const resource = {
    catalog: 'team-alpha',
    id: 'demo-skill',
    kind: 'skill',
    description: 'A source skill.',
    source_repository: 'example/team-alpha',
    source_path: 'skills/demo-skill',
    source_ref: 'a'.repeat(40),
    license_status: 'MIT',
  };
  assert.throws(
    () =>
      runSourceOperation(
        {
          action: 'install',
          resource,
          target,
          scope: 'project',
        },
        () => assert.fail('a colliding install must not invoke gh'),
      ),
    /already tracked from another catalog/,
  );
});

test('configured source skills use the same pinned install, check, update and uninstall lifecycle', () => {
  const temporary = makeTemporaryDirectory('kitia-source-lifecycle-');
  const target = path.join(temporary, 'target');
  fs.mkdirSync(target);
  const sourceResource = {
    catalog: 'team-alpha',
    id: 'demo-skill',
    kind: 'skill',
    description: 'A generated source skill.',
    source_repository: 'example/team-alpha',
    source_path: 'skills/demo-skill',
    source_ref: 'a'.repeat(40),
    license_status: 'MIT',
  };
  let installedRef = sourceResource.source_ref;
  let updateArgs;
  const invoke = (args) => {
    if (args[args.indexOf('--pin') + 1] !== sourceResource.source_ref) updateArgs = args;
    assert.deepEqual(args.slice(0, 4), [
      'skill',
      'install',
      sourceResource.source_repository,
      sourceResource.source_path,
    ]);
    installedRef = args[args.indexOf('--pin') + 1];
    const skillFile = path.join(target, '.agents/skills/demo-skill/SKILL.md');
    fs.mkdirSync(path.dirname(skillFile), { recursive: true });
    fs.writeFileSync(
      skillFile,
      [
        '---',
        'name: demo-skill',
        'description: A generated source skill.',
        'metadata:',
        `  github-repo: "https://github.com/${sourceResource.source_repository}"`,
        `  github-path: "${sourceResource.source_path}"`,
        `  github-ref: "${installedRef}"`,
        `  github-pinned: "${installedRef}"`,
        '---',
        '',
        'Synthetic body.',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(path.join(path.dirname(skillFile), 'reference.md'), 'Supporting file.');
    return 0;
  };

  assert.equal(
    runSourceOperation(
      {
        action: 'install',
        resource: sourceResource,
        target,
        scope: 'project',
      },
      invoke,
    ).status,
    0,
  );
  const state = readInstallState(target);
  assert.equal(state.sources['team-alpha'].skills['demo-skill'].source_ref, sourceResource.source_ref);
  assert.equal(state.source_skills, undefined);
  assert.equal(readInstalledSourceSkills(target, [sourceResource]).length, 1);
  const checked = checkInstalledResources(target, [sourceResource], { catalog: 'team-alpha' });
  assert.equal(checked.updateAvailable, false);
  assert.equal(
    checked.resources.find((resource) => resource.id === sourceResource.id).version,
    installedRef.slice(0, 7),
  );

  const updatedResource = { ...sourceResource, source_ref: 'c'.repeat(40) };
  const installed = readInstalledSourceSkills(target, [updatedResource]);
  assert.match(updateSourceResources(installed, target, {}, invoke).join('\n'), /Updated team-alpha catalog skill/);
  assert.equal(updateArgs.includes('--force'), false, 'the first managed update attempt must not force GH overwrite');
  assert.equal(installedRef, updatedResource.source_ref);
  const failedResource = { ...updatedResource, source_ref: 'd'.repeat(40) };
  let plannedUpdate;
  updateSourceResources(
    readInstalledSourceSkills(target, [failedResource]),
    target,
    {
      dryRun: true,
      onAction: (action) => {
        plannedUpdate = action;
      },
    },
    () => assert.fail('a dry-run update must not invoke gh'),
  );
  assert.equal(
    plannedUpdate.command.args.includes('--force'),
    false,
    'dry-run plans must not force GH overwrite by default',
  );
  const skillFile = path.join(target, '.agents/skills/demo-skill/SKILL.md');
  const installedSkill = fs.readFileSync(skillFile, 'utf8');
  fs.writeFileSync(skillFile, 'Locally modified managed skill.\n');
  let guardedGhCalls = 0;
  assert.throws(
    () =>
      updateSourceResources(readInstalledSourceSkills(target, [failedResource]), target, {}, () => {
        guardedGhCalls++;
        return 0;
      }),
    (error) => {
      assert.equal(error.code, 'LOCAL_CONFLICT');
      assert.equal(error.category, 'tracked-modification');
      assert.deepEqual(error.paths, ['.agents/skills/demo-skill/SKILL.md']);
      assert.equal(error.recoverable, true);
      return true;
    },
  );
  assert.equal(guardedGhCalls, 0, 'local modifications must be rejected before invoking gh');
  assert.throws(
    () =>
      updateSourceResources(
        readInstalledSourceSkills(target, [failedResource]),
        target,
        { ghForce: true, ghForceAgent: 'standard' },
        () => {
          guardedGhCalls++;
          return 0;
        },
      ),
    (error) => error.code === 'LOCAL_CONFLICT',
  );
  assert.equal(guardedGhCalls, 0, "GH-only force retry must not bypass Kitia's tracked-file guard");
  let forcedArgs;
  assert.throws(
    () =>
      updateSourceResources(readInstalledSourceSkills(target, [failedResource]), target, { force: true }, (args) => {
        forcedArgs = args;
        return 1;
      }),
    /gh exited with status 1/,
  );
  assert.ok(forcedArgs.includes('--force'), 'explicit --force must still reach gh');
  fs.writeFileSync(skillFile, installedSkill);
  fs.writeFileSync(path.join(path.dirname(skillFile), 'local-notes.txt'), 'Keep this file.');
  guardedGhCalls = 0;
  assert.throws(
    () =>
      updateSourceResources(readInstalledSourceSkills(target, [failedResource]), target, {}, () => {
        guardedGhCalls++;
        return 0;
      }),
    (error) => {
      assert.equal(error.code, 'LOCAL_CONFLICT');
      assert.equal(error.category, 'untracked-skill-content');
      assert.deepEqual(error.paths, ['.agents/skills/demo-skill/local-notes.txt']);
      assert.equal(error.recoverable, true);
      return true;
    },
  );
  assert.equal(guardedGhCalls, 0, 'untracked files must be protected before invoking gh');
  assert.throws(
    () =>
      updateSourceResources(
        readInstalledSourceSkills(target, [failedResource]),
        target,
        { ghForce: true, ghForceAgent: 'standard' },
        () => {
          guardedGhCalls++;
          return 0;
        },
      ),
    (error) => error.code === 'LOCAL_CONFLICT',
  );
  assert.equal(guardedGhCalls, 0, "GH-only force retry must not bypass Kitia's untracked-file guard");
  let untrackedForcedArgs;
  assert.throws(
    () =>
      updateSourceResources(readInstalledSourceSkills(target, [failedResource]), target, { force: true }, (args) => {
        untrackedForcedArgs = args;
        return 1;
      }),
    /gh exited with status 1/,
  );
  assert.ok(untrackedForcedArgs.includes('--force'), 'explicit --force may replace untracked content');
  fs.unlinkSync(path.join(path.dirname(skillFile), 'local-notes.txt'));
  let ghFailure;
  assert.throws(
    () =>
      updateSourceResources(
        readInstalledSourceSkills(target, [failedResource]),
        target,
        { nonInteractive: true },
        () => ({
          status: 1,
          stderr:
            '\u001b[31mGitHub API rate limit exceeded; retry later\u001b[0m token ghp_abcdefghijklmnopqrstuvwxyz123456 GH_TOKEN=super-secret-value\n',
          stdout: 'ignored stdout',
        }),
      ),
    (error) => {
      ghFailure = error;
      return true;
    },
  );
  assert.equal(
    ghFailure.message,
    'Could not update team-alpha catalog skill demo-skill for standard: gh exited with status 1. GitHub reports an API rate limit; wait for the limit to reset, then retry. No destinations were confirmed updated before this failure. gh diagnostic: GitHub API rate limit exceeded; retry later token [REDACTED] GH_TOKEN=[REDACTED]',
  );
  assert.doesNotMatch(
    ghFailure.message,
    /\u001b|\bghp_abcdefghijklmnopqrstuvwxyz123456\b|super-secret-value|ignored stdout/,
  );
  let truncatedFailure;
  assert.throws(
    () =>
      updateSourceResources(
        readInstalledSourceSkills(target, [failedResource]),
        target,
        { nonInteractive: true },
        () => ({ status: 1, stderr: 'x'.repeat(401) }),
      ),
    (error) => {
      truncatedFailure = error;
      return true;
    },
  );
  assert.match(truncatedFailure.message, /x{400}… \[diagnostic truncated\]$/);
  assert.equal(ghFailure.code, 'GH_UPDATE_FAILED', 'unrelated GH failures must remain ordinary failures');
  const forceRequiredResource = { ...updatedResource, source_ref: 'f'.repeat(40) };
  let firstAttemptArgs;
  assert.throws(
    () =>
      updateSourceResources(readInstalledSourceSkills(target, [forceRequiredResource]), target, {}, (args) => {
        firstAttemptArgs = args;
        return {
          status: 1,
          stderr: 'skills already installed: demo-skill (Use --force to overwrite)',
        };
      }),
    (error) => {
      assert.equal(error.code, 'GH_FORCE_REQUIRED');
      assert.equal(error.category, 'github-force-required');
      assert.equal(error.recoverable, true);
      assert.equal(error.agent, 'standard');
      assert.match(error.userMessage, /already installed and requires --force/);
      assert.doesNotMatch(error.userMessage, /Skills already installed/);
      return true;
    },
  );
  assert.equal(firstAttemptArgs.includes('--force'), false);
  for (const diagnostic of [
    'skills already installed: demo-skill (Use --force to overwrite!)',
    'Skills already installed: demo-skill (Use --force to overwrite!)',
    'Skills already installed:\ndemo-skill (Use --force to overwrite)',
    'prefix Skills already installed: demo-skill (Use --force to overwrite)',
  ]) {
    let nearMatchArgs;
    assert.throws(
      () =>
        updateSourceResources(readInstalledSourceSkills(target, [forceRequiredResource]), target, {}, (args) => {
          nearMatchArgs = args;
          return { status: 1, stderr: diagnostic };
        }),
      (error) => error.code === 'GH_UPDATE_FAILED',
    );
    assert.equal(nearMatchArgs.includes('--force'), false);
  }
  updateSourceResources(
    readInstalledSourceSkills(target, [forceRequiredResource]),
    target,
    { ghForce: true, ghForceAgent: 'standard' },
    invoke,
  );
  assert.ok(updateArgs.includes('--force'));
  assert.equal(installedRef, forceRequiredResource.source_ref);
  assert.equal(
    readInstallState(target).sources['team-alpha'].skills['demo-skill'].source_ref,
    forceRequiredResource.source_ref,
  );

  let spawnOptions;
  const captured = runGhSkill(
    ['skill', 'install'],
    target,
    (_program, _args, options) => {
      spawnOptions = options;
      return { status: 1, stdout: 'out', stderr: 'actionable error' };
    },
    { nonInteractive: true, captureOutput: true },
  );
  assert.deepEqual(spawnOptions.stdio, ['ignore', 'pipe', 'pipe']);
  assert.equal(spawnOptions.env.GH_PROMPT_DISABLED, '1');
  assert.deepEqual(captured, { status: 1, stdout: 'out', stderr: 'actionable error' });
  assert.throws(
    () =>
      runGhSkill(['skill', 'install', 'https://example.invalid/?token=secret'], target, () => {
        throw Object.assign(new Error('secret process details'), { code: 'EACCES' });
      }),
    (error) => {
      assert.equal(error.code, 'GH_SPAWN_FAILED');
      assert.match(error.message, /EACCES/);
      assert.doesNotMatch(error.message, /example\.invalid|token=secret|secret process details/);
      return true;
    },
  );
  assert.equal(
    checkInstalledResources(target, [forceRequiredResource], { catalog: 'team-alpha' }).updateAvailable,
    false,
  );
  const partialResource = { ...updatedResource, source_ref: 'e'.repeat(40) };
  const partialInstalled = readInstalledSourceSkills(target, [partialResource]);
  partialInstalled[0].installations.push({
    ...partialInstalled[0].installations[0],
    destination: 'claude',
    path: '.claude/skills/demo-skill/SKILL.md',
  });
  let partialCalls = 0;
  assert.throws(
    () =>
      updateSourceResources(partialInstalled, target, { nonInteractive: true }, (args) => {
        partialCalls += 1;
        return partialCalls === 1 ? invoke(args) : { status: 1, stderr: 'unexpected failure' };
      }),
    (error) => {
      assert.equal(error.code, 'GH_UPDATE_FAILED');
      assert.match(error.userMessage, /for claude: gh exited with status 1/);
      assert.match(error.userMessage, /did not provide a recognized cause/);
      assert.match(error.userMessage, /Updated destinations: standard/);
      assert.doesNotMatch(error.userMessage, /unexpected failure/);
      return true;
    },
  );
  assert.equal(partialCalls, 2);

  assert.match(
    uninstallSourceResource(updatedResource, target).join('\n'),
    /Removed team-alpha catalog skill entry point/,
  );
  assert.equal(fs.existsSync(path.join(target, '.agents/skills/demo-skill')), false);
  assert.equal(readInstalledSourceSkills(target, []).length, 0);
});

test('an explicit skill ref is installed and recorded without changing the catalog resource pin', () => {
  const temporary = makeTemporaryDirectory('kitia-explicit-ref-');
  const target = path.join(temporary, 'target');
  fs.mkdirSync(target);
  const catalogResource = {
    catalog: 'team-alpha',
    id: 'demo-skill',
    kind: 'skill',
    description: 'A source skill.',
    source_repository: 'example/team-alpha',
    source_path: 'skills/demo-skill',
    source_ref: 'a'.repeat(40),
    license_status: 'MIT',
  };
  const requestedRef = 'b'.repeat(40);
  let installedRef;
  const invoke = (args) => {
    installedRef = args[args.indexOf('--pin') + 1];
    const skillFile = path.join(target, '.agents/skills/demo-skill/SKILL.md');
    fs.mkdirSync(path.dirname(skillFile), { recursive: true });
    fs.writeFileSync(
      skillFile,
      [
        '---',
        'name: demo-skill',
        'description: A source skill.',
        'metadata:',
        `  github-repo: "https://github.com/${catalogResource.source_repository}"`,
        `  github-path: "${catalogResource.source_path}"`,
        `  github-ref: "${installedRef}"`,
        `  github-pinned: "${installedRef}"`,
        '---',
        '',
        'Pinned test revision.',
        '',
      ].join('\n'),
    );
    return 0;
  };
  assert.equal(
    runSourceOperation(
      {
        action: 'install',
        resource: { ...catalogResource, source_ref: requestedRef },
        target,
        scope: 'project',
      },
      invoke,
    ).status,
    0,
  );
  assert.equal(installedRef, requestedRef);
  assert.equal(catalogResource.source_ref, 'a'.repeat(40));
  assert.equal(readInstallState(target).sources['team-alpha'].skills['demo-skill'].source_ref, requestedRef);
  assert.deepEqual(updateSourceResources(readInstalledSourceSkills(target, [catalogResource]), target, {}, invoke), [
    `Updated ${catalogResource.catalog} catalog skill: ${catalogResource.id}`,
  ]);
  assert.equal(installedRef, catalogResource.source_ref);
  assert.equal(
    readInstallState(target).sources['team-alpha'].skills['demo-skill'].source_ref,
    catalogResource.source_ref,
  );
  assert.equal(catalogResource.source_ref, 'a'.repeat(40));
  assert.equal(
    buildSourceSkillArgs(
      'install',
      { ...catalogResource, source_ref: requestedRef },
      path.join(target, '.agents/skills'),
    ).at(-1),
    requestedRef,
  );
});

for (const [scope, copilotDirectory] of [
  ['project', '.github/skills'],
  ['user', '.copilot/skills'],
]) {
  test(`adds the dedicated Copilot skill in ${scope} without taking ownership of other copies`, () => {
    const target = fs.realpathSync(makeTemporaryDirectory('kitia-skill-destinations-'));
    const resource = {
      catalog: 'team-alpha',
      kind: 'skill',
      id: 'demo',
      source_repository: 'example/team-alpha',
      source_path: 'skills/demo',
      source_ref: 'a'.repeat(40),
      license_status: 'MIT',
    };
    const standard = '.agents/skills/demo/SKILL.md';
    const copilot = `${copilotDirectory}/demo/SKILL.md`;
    const unmanaged = '.claude/skills/demo/SKILL.md';
    const body = (ref) =>
      `---\nname: demo\ndescription: A fixture skill.\nmetadata:\n  github-repo: ${resource.source_repository}\n  github-path: ${resource.source_path}\n  github-pinned: ${ref}\n---\nSkill body at ${ref}.\n`;
    const write = (file, content) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    };
    write(path.join(target, standard), body(resource.source_ref));
    write(path.join(target, unmanaged), body(resource.source_ref));
    const lockFile = path.join(target, '.agents/kitia-lock.json');
    write(
      lockFile,
      JSON.stringify({
        lock_version: 1,
        catalog: 'grasdouble/Kitia',
        sources: {
          [resource.catalog]: {
            skills: {
              demo: {
                source_repository: resource.source_repository,
                source_path: resource.source_path,
                source_ref: resource.source_ref,
                files: { [standard]: installedFingerprint(target, standard) },
              },
            },
          },
        },
      }),
    );

    const paths = () =>
      readInstalledSourceSkills(target, [resource])[0].installations.map(({ destination, path }) => [
        destination,
        path,
      ]);
    const before = fs.readFileSync(lockFile);
    assert.deepEqual(paths(), [['standard', standard]]);
    assert.deepEqual(fs.readFileSync(lockFile), before, 'recognition does not rewrite the inventory');
    const seen = [];
    const invoke = (args) => {
      const file = path.join(args[args.indexOf('--dir') + 1], 'demo/SKILL.md');
      seen.push(path.relative(target, file));
      write(file, body(args[args.indexOf('--pin') + 1]));
      return 0;
    };
    runSourceOperation({ action: 'install', target, scope, resource, destinations: ['copilot'] }, invoke);
    assert.deepEqual(seen, [copilot]);
    assert.deepEqual(paths(), [
      ['standard', standard],
      ['copilot', copilot],
    ]);
    assert.equal(fs.readFileSync(path.join(target, standard), 'utf8'), body(resource.source_ref));
    const next = { ...resource, source_ref: 'b'.repeat(40) };
    updateSourceResources(readInstalledSourceSkills(target, [next]), target, { scope }, invoke);
    assert.deepEqual(seen, [copilot, standard, copilot]);
    assert.equal(fs.readFileSync(path.join(target, unmanaged), 'utf8'), body(resource.source_ref));
    uninstallSourceResource(next, target);
    assert.equal(fs.existsSync(path.join(target, standard)), false);
    assert.equal(fs.existsSync(path.join(target, copilot)), false);
    assert.equal(fs.readFileSync(path.join(target, unmanaged), 'utf8'), body(resource.source_ref));
  });
}
