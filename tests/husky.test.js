import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const preCommitPath = path.join(repositoryRoot, '.husky', 'pre-commit');

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: options.env ?? process.env,
  });
  if (result.error) throw result.error;
  if (options.allowFailure) return result;
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} a échoué :\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout.trim();
}

async function createGitFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lufa-husky-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, '.husky'), { recursive: true });
  await cp(preCommitPath, path.join(root, '.husky', 'pre-commit'));
  await mkdir(path.join(root, 'src'));
  await mkdir(path.join(root, 'scripts'));
  await mkdir(path.join(root, 'dist'));
  await writeFile(
    path.join(root, 'package.json'),
    `${JSON.stringify({
      name: 'lufa-husky-hook-fixture',
      private: true,
      scripts: { build: 'node scripts/build.js' },
    })}\n`,
  );
  await writeFile(path.join(root, 'package-lock.json'), '{}\n');
  await writeFile(path.join(root, 'tsconfig.json'), '{}\n');
  await writeFile(path.join(root, 'src', 'index.ts'), 'export {};\n');
  await writeFile(
    path.join(root, 'scripts', 'build.js'),
    `import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const dist = path.join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
writeFileSync(path.join(dist, 'new.js'), readFileSync(path.join(root, 'src', 'index.ts'), 'utf8'));
writeFileSync(path.join(root, 'build-ran'), 'yes');
`,
  );
  await writeFile(path.join(root, 'dist', 'old.js'), 'old');
  run('git', ['init', '--initial-branch=main'], root);
  run('git', ['config', 'user.name', 'Lufa Husky tests'], root);
  run('git', ['config', 'user.email', 'lufa-husky@example.invalid'], root);
  run('git', ['add', '--all'], root);
  run('git', ['commit', '--message', 'hook fixture baseline'], root);
  return root;
}

test('prepare installs Husky without compiling', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lufa-husky-prepare-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, '.husky'), { recursive: true });
  await writeFile(
    path.join(root, '.husky', 'pre-commit'),
    '#!/bin/sh\nexit 0\n',
  );
  await writeFile(
    path.join(root, 'package.json'),
    `${JSON.stringify({
      name: 'lufa-husky-prepare-fixture',
      private: true,
      scripts: { prepare: 'husky', build: 'node build.js' },
    })}\n`,
  );
  await writeFile(
    path.join(root, 'build.js'),
    `import { writeFileSync } from 'node:fs';\nwriteFileSync('build-ran', 'yes');\n`,
  );
  await writeFile(path.join(root, 'dist-sentinel'), 'precompiled');
  run('git', ['init', '--initial-branch=main'], root);
  const env = {
    ...process.env,
    PATH: `${path.join(repositoryRoot, 'node_modules', '.bin')}${path.delimiter}${process.env.PATH}`,
  };

  run('npm', ['run', 'prepare'], root, { env });

  assert.equal(
    run('git', ['config', '--local', 'core.hooksPath'], root),
    '.husky/_',
  );
  await assert.rejects(readFile(path.join(root, 'build-ran')));
  assert.equal(
    await readFile(path.join(root, 'dist-sentinel'), 'utf8'),
    'precompiled',
  );
  assert.equal(
    JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).scripts
      .prepare,
    'husky',
  );
  assert.equal(
    JSON.parse(
      await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    ).scripts.prepare,
    'husky',
  );
});

test('pre-commit builds then force-stages dist additions and deletions', async (t) => {
  const root = await createGitFixture(t);
  await writeFile(
    path.join(root, 'src', 'index.ts'),
    'export const staged = true;\n',
  );
  run('git', ['add', 'src/index.ts'], root);
  await writeFile(path.join(root, 'unrelated.txt'), 'staged');
  run('git', ['add', 'unrelated.txt'], root);

  run('sh', ['.husky/pre-commit'], root);

  const staged = run('git', ['diff', '--cached', '--name-status'], root);
  assert.match(staged, /A\s+dist\/new\.js/);
  assert.match(staged, /D\s+dist\/old\.js/);
  assert.equal(
    run('git', ['show', ':dist/new.js'], root),
    'export const staged = true;',
  );
  assert.equal(
    run('git', ['diff', '--cached', '--name-only'], root).includes(
      'unrelated.txt',
    ),
    true,
  );
});

test('pre-commit refuses unstaged build-source changes before running the build', async (t) => {
  const root = await createGitFixture(t);
  await writeFile(
    path.join(root, 'src', 'index.ts'),
    'export const staged = true;\n',
  );
  run('git', ['add', 'src/index.ts'], root);
  await writeFile(
    path.join(root, 'src', 'index.ts'),
    'export const unstaged = true;\n',
  );

  const result = run('sh', ['.husky/pre-commit'], root, {
    allowFailure: true,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /non stagés/);
  await assert.rejects(readFile(path.join(root, 'build-ran')));
});

test('pre-commit refuses untracked build-source files before running the build', async (t) => {
  const root = await createGitFixture(t);
  await writeFile(path.join(root, 'src', 'new.ts'), 'export {};\n');

  const result = run('sh', ['.husky/pre-commit'], root, {
    allowFailure: true,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /fichiers de build sont non suivis/);
  assert.match(result.stderr, /src\/new\.ts/);
  await assert.rejects(readFile(path.join(root, 'build-ran')));
});
