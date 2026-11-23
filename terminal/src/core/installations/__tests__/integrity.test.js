'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');
const { createSourceIndex } = require('../../catalogs/discovery.ts');
const {
  readInstallState,
  readInstalledSourceResources,
  recordSourceInstallation,
} = require('../../inventory/inventory.ts');
const { installedFingerprint } = require('../files.ts');
const { executeInstallationOperation } = require('../lifecycle.ts');

const catalog = 'Fixture';
const repository = 'example/integrity';
const lock = '.agents/kitia-lock.json';
const sources = {
  skill: 'skills/demo/SKILL.md',
  agent: 'agents/demo.agent.md',
  instruction: 'instructions/demo.instructions.md',
};
const destinations = {
  skill: ['.claude/skills/demo/SKILL.md', '.agents/skills/demo/SKILL.md'],
  agent: ['.claude/agents/demo.md', '.github/agents/demo.agent.md'],
  instruction: ['.claude/rules/demo.md', '.github/instructions/demo.instructions.md'],
};
const skillHeader = '---\nname: demo\ndescription: A fixture skill.\n';
const agentHeader = '---\nname: demo\ndescription: A fixture agent.\n---\n';
const globalInstruction = '# Project guidance\nCheck the examples.\n';

function write(root, relativePath, content) {
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-install-integrity-'));
  const upstream = path.join(root, 'upstream');
  const userTarget = path.join(root, 'user');
  fs.mkdirSync(userTarget);
  const remote = `https://github.com/${repository}`;
  const trace = path.join(root, 'git.trace');
  const env = {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `url.${pathToFileURL(upstream).href}.insteadOf`,
    GIT_CONFIG_VALUE_0: `${remote}.git`,
    GIT_TRACE: trace,
  };
  const oldEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  execFileSync('git', ['init', '--quiet', upstream]);
  write(upstream, '.gitattributes', '*.md text eol=lf\n');
  const git = (...args) => execFileSync('git', ['-C', upstream, ...args], { encoding: 'utf8' });
  return {
    commit(contents) {
      for (const [kind, content] of Object.entries(contents)) write(upstream, sources[kind], content);
      git('add', '.');
      git(
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--quiet',
        '-m',
        'Fixture',
      );
      const index = createSourceIndex(remote, catalog, upstream);
      return index.resources.map((entry) => ({
        ...entry,
        catalog,
        source_repository: repository,
        source_ref: index.source_ref,
        license_status: 'MIT',
      }));
    },
    target(name) {
      const target = path.join(root, name);
      fs.mkdirSync(target);
      return target;
    },
    cloneCount: () => (fs.readFileSync(trace, 'utf8').match(/built-in: git clone /g) || []).length,
    operate(operation, target, resources, options = {}) {
      return executeInstallationOperation(
        { operation, target, userTarget, scope: 'project', tool: 'both', ...options },
        resources,
      );
    },
  };
}

function snapshot(target, paths) {
  return Object.fromEntries(
    paths.map((relativePath) => {
      const file = path.join(target, relativePath);
      return [
        relativePath,
        fs.existsSync(file) ? { content: fs.readFileSync(file), mode: fs.statSync(file).mode } : null,
      ];
    }),
  );
}

function assertInventoryMatchesFiles(target, resources) {
  const state = readInstallState(target);
  for (const { kind, source_ref: ref } of resources) {
    const installed = state.sources[catalog][`${kind}s`].demo;
    assert.equal(installed.source_ref, ref);
    assert.deepEqual(Object.keys(installed.files).sort(), [...destinations[kind]].sort());
    for (const [relativePath, expected] of Object.entries(installed.files)) {
      assert.deepEqual(expected, installedFingerprint(target, relativePath), relativePath);
    }
  }
}

test('audited selected replacements block incomplete coverage before touching either runtime', async (t) => {
  const repo = fixture(t);
  const initial = repo.commit({
    skill: `${skillHeader}---\nSkill body.\n`,
    agent: `${agentHeader}First agent.\n`,
    instruction: globalInstruction,
  });
  const oversizedBody = `# Large benign fixture\n${'Line of ordinary text.\n'.repeat(50_000)}`;
  const selected = repo.commit({
    skill: `${skillHeader}---\n${oversizedBody}`,
    agent: `${agentHeader}${oversizedBody}`,
    instruction: oversizedBody,
  });

  for (const resource of initial) {
    const { kind, source_ref: initialRef } = resource;
    const target = repo.target(kind);
    if (kind === 'skill') {
      for (const [i, location] of destinations.skill.entries()) {
        write(
          target,
          location,
          `${skillHeader}metadata:\n  github-repo: ${repository}\n  github-path: ${resource.source_path}\n  github-pinned: ${initialRef}\n---\nSkill body.\n`,
        );
        recordSourceInstallation(resource, target, i === 0 ? 'claude-code' : 'github-copilot');
      }
    } else {
      await repo.operate('install', target, initial, { resource });
    }
    const paths = [lock, ...destinations[kind]];
    const before = snapshot(target, paths);
    const beforeClones = repo.cloneCount();
    const audits = [];
    await assert.rejects(
      repo.operate('install', target, initial, {
        resource,
        ref: selected[0].source_ref,
        audit: true,
        nonInteractive: kind !== 'instruction',
        onAudit: (audit) => audits.push(audit),
        spawnProcess: () => assert.fail('blocked audit must not invoke gh'),
      }),
      { code: 'AUDIT_BLOCKED' },
    );
    assert.equal(audits.length, 1, kind);
    assert.deepEqual(audits[0].findings, []);
    assert.equal(audits[0].coverage.complete, false);
    assert.equal(audits[0].coverage.skipped[0].path, sources[kind]);
    assert.match(audits[0].coverage.skipped[0].reason, /per-file limit/);
    assert.equal(repo.cloneCount() - beforeClones, 1);
    assert.deepEqual(snapshot(target, paths), before);
    assertInventoryMatchesFiles(target, [resource]);
  }
});

test('failed inventory publication restores installations and a bulk update, including modes', async (t) => {
  const repo = fixture(t);
  const initial = repo.commit({ agent: `${agentHeader}First agent.\n`, instruction: globalInstruction });
  const target = repo.target('project');
  const originalRename = fs.renameSync;
  const paths = [lock, ...destinations.agent, ...destinations.instruction];
  let failInventory = true;
  let publishedPaths;
  const attempts = [];
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (to === path.join(fs.realpathSync(target), lock) && failInventory) {
      attempts.push(snapshot(target, publishedPaths));
      throw new Error('injected inventory publication failure');
    }
    return originalRename(from, to);
  });

  for (const resource of initial) {
    publishedPaths = destinations[resource.kind];
    await assert.rejects(
      repo.operate('install', target, initial, { resource }),
      /injected inventory publication failure/,
    );
    assert.ok(Object.values(attempts.at(-1)).every(Boolean), 'destinations were staged and published first');
    assert.ok(Object.values(snapshot(target, paths)).every((entry) => entry === null));
  }
  failInventory = false;
  for (const resource of initial) await repo.operate('install', target, initial, { resource });
  assertInventoryMatchesFiles(target, initial);
  if (process.platform !== 'win32') for (const file of paths) fs.chmodSync(path.join(target, file), 0o664);
  const before = snapshot(target, paths);
  const beforeState = readInstallState(target);
  const next = repo.commit({
    agent: `${agentHeader}Second agent.\n`,
    instruction: '---\npaths: [src/**]\n---\nUpdate body.\n',
  });
  failInventory = true;
  publishedPaths = paths.slice(1);
  const oldMask = process.platform === 'win32' ? null : process.umask(0o077);
  try {
    await assert.rejects(repo.operate('update', target, next), /injected inventory publication failure/);
  } finally {
    if (oldMask !== null) process.umask(oldMask);
  }
  assert.equal(attempts.length, 3);
  for (const [file, entry] of Object.entries(attempts[2])) assert.notDeepEqual(entry.content, before[file].content);
  assert.deepEqual(snapshot(target, paths), before);
  assert.deepEqual(readInstallState(target), beforeState);
  assertInventoryMatchesFiles(target, initial);
});

test('one-runtime installs cannot advance a shared pin; both runtimes or update can', async (t) => {
  const repo = fixture(t);
  const initial = repo.commit({ agent: `${agentHeader}First agent.\n`, instruction: globalInstruction });
  const next = repo.commit({
    agent: `${agentHeader}Second agent.\n`,
    instruction: '---\napply_to: src/**\n---\nScoped body.\n',
  });
  for (const resource of initial) {
    const target = repo.target(resource.kind);
    for (const tool of ['claude', 'copilot']) await repo.operate('install', target, initial, { resource, tool });
    const paths = [lock, ...destinations[resource.kind]];
    const before = snapshot(target, paths);
    const upcoming = next.find(({ kind }) => kind === resource.kind);
    for (const [i, tool] of ['claude', 'copilot'].entries()) {
      await assert.rejects(
        repo.operate('install', target, next, { resource: upcoming, tool, force: true }),
        (error) => {
          assert.equal(error.code, 'SHARED_SOURCE_PIN');
          assert.match(error.message, /--tool both or use update/);
          assert.deepEqual(error.paths, [destinations[resource.kind][1 - i]]);
          return true;
        },
      );
    }
    assert.deepEqual(snapshot(target, paths), before);
    assert.deepEqual(
      readInstalledSourceResources(target, [upcoming])[0].installations.map(({ ref }) => ref),
      [resource.source_ref, resource.source_ref],
    );
    if (resource.kind === 'agent') await repo.operate('install', target, next, { resource: upcoming });
    else await repo.operate('update', target, next, { kind: resource.kind, id: resource.id });
    assertInventoryMatchesFiles(target, [upcoming]);
  }
});

test('historical instructions use pinned scopes for both runtimes and bulk updates share Git acquisitions', async (t) => {
  const repo = fixture(t);
  const global = repo.commit({ agent: `${agentHeader}Global-era agent.\n`, instruction: globalInstruction });
  assert.deepEqual(global.find(({ kind }) => kind === 'instruction').apply_to, ['**']);
  const older = repo.commit({
    agent: `${agentHeader}Older agent.\n`,
    instruction: '---\napplyTo: old/**\n---\nOlder instruction.\n',
  });
  const latest = repo.commit({ instruction: '---\npaths: [new/**, tests/**]\n---\nCurrent instruction.\n' });
  const currentInstruction = latest.find(({ kind }) => kind === 'instruction');
  const target = repo.target('project');
  for (const resource of latest) await repo.operate('install', target, latest, { resource });
  if (process.platform !== 'win32') for (const file of destinations.agent) fs.chmodSync(path.join(target, file), 0o660);
  const unchanged = snapshot(target, destinations.agent);
  const assertInstruction = (scope, body) => {
    const [claude, copilot] = destinations.instruction.map((file) => fs.readFileSync(path.join(target, file), 'utf8'));
    assert.equal(claude, `---\npaths: ${JSON.stringify(scope)}\n---\n\n${body}`);
    assert.equal(copilot, `---\napplyTo: ${JSON.stringify(scope.join(', '))}\n---\n\n${body}`);
    assert.deepEqual(readInstallState(target).sources[catalog].instructions.demo.apply_to, scope);
  };
  assertInstruction(['new/**', 'tests/**'], 'Current instruction.\n');

  let beforeClones = repo.cloneCount();
  await repo.operate('update', target, older);
  assert.equal(repo.cloneCount() - beforeClones, 1);
  assertInstruction(['old/**'], 'Older instruction.\n');
  assert.deepEqual(snapshot(target, destinations.agent), unchanged, 'same bytes were not rewritten');
  assertInventoryMatchesFiles(target, older);
  assert.match(fs.readFileSync(path.join(target, destinations.agent[0]), 'utf8'), /Older agent/);

  beforeClones = repo.cloneCount();
  const ref = global[0].source_ref;
  await repo.operate('install', target, latest, { resource: currentInstruction, tool: 'claude', ref, audit: true });
  assert.equal(repo.cloneCount() - beforeClones, 1, 'audited replacement reuses acquisition');
  assertInstruction(['**'], globalInstruction);
  assertInventoryMatchesFiles(target, [{ ...currentInstruction, source_ref: ref }]);
});
