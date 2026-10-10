import assert from 'node:assert/strict';
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'lufa-git-smoke-'));
const fixtureRepository = path.join(temporaryRoot, 'fixture-repository');
let gitUrl;
const temporaryRegistry = 'http://127.0.0.1:1/registry/catalog-index.json';

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: options.timeout ?? 240_000,
    env: {
      ...process.env,
      LUFA_REGISTRY_URL: temporaryRegistry,
      LUFA_CACHE_DIR: path.join(
        temporaryRoot,
        'cache',
        options.cacheName ?? 'default',
      ),
      ...options.env,
    },
  });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} a échoué :\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout.trim();
}

try {
  await mkdir(fixtureRepository);
  const sourceFiles = run(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    repositoryRoot,
  ).split('\0');
  for (const relative of sourceFiles) {
    if (!relative) continue;
    const components = relative.split('/');
    if (
      components.some((component) =>
        ['.git', 'node_modules'].includes(component),
      ) ||
      relative.startsWith('src/') ||
      relative === 'scripts/build.js' ||
      relative.startsWith('web/dist/') ||
      relative.startsWith('web/dist-pages/') ||
      relative.startsWith('tests/fixtures/web-security/dist/')
    ) {
      continue;
    }
    const source = path.join(repositoryRoot, relative);
    try {
      await stat(source);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const destination = path.join(fixtureRepository, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination);
  }

  run('git', ['init', '--initial-branch=main'], fixtureRepository);
  run(
    'git',
    ['config', 'user.name', 'Lufa Git source smoke'],
    fixtureRepository,
  );
  run(
    'git',
    ['config', 'user.email', 'lufa-git-smoke@example.invalid'],
    fixtureRepository,
  );
  run('git', ['add', '--all'], fixtureRepository);
  const fixtureManifest = JSON.parse(
    await readFile(path.join(fixtureRepository, 'package.json'), 'utf8'),
  );
  assert.equal(fixtureManifest.scripts?.prepare, 'husky');
  assert.equal(fixtureManifest.scripts?.prepack, undefined);
  assert.equal(
    run(
      'git',
      ['ls-files', '--error-unmatch', 'dist/lufa-command.js'],
      fixtureRepository,
    ),
    'dist/lufa-command.js',
  );
  await stat(path.join(fixtureRepository, 'dist/lufa-command.js'));
  await assert.rejects(stat(path.join(fixtureRepository, 'src')));
  run(
    'git',
    ['commit', '--message', 'Git source smoke fixture'],
    fixtureRepository,
  );
  const resolvedRef = run('git', ['rev-parse', 'HEAD'], fixtureRepository);
  gitUrl = `git+${pathToFileURL(fixtureRepository).href}#${resolvedRef}`;

  for (const runner of [
    {
      name: 'npm/npx',
      command: 'npx',
      args: (commandArgs) => [
        '--yes',
        `--package=${gitUrl}`,
        'lufa',
        ...commandArgs,
      ],
    },
    {
      name: 'pnpm/dlx',
      command: 'pnpm',
      args: (commandArgs) => [
        'dlx',
        `--allow-build=lufa-ai@${gitUrl}`,
        '--yes',
        `--package=${gitUrl}`,
        'lufa',
        ...commandArgs,
      ],
    },
  ]) {
    const consumer = path.join(temporaryRoot, runner.name.replaceAll('/', '-'));
    const project = path.join(consumer, 'fixture-project');
    await mkdir(project, { recursive: true });
    const consumerManifest = { name: 'lufa-git-smoke-consumer', private: true };
    const manifestPath = path.join(consumer, 'package.json');
    await writeFile(
      manifestPath,
      `${JSON.stringify(consumerManifest, null, 2)}\n`,
    );

    const invoke = (args) =>
      run(runner.command, runner.args(args), consumer, {
        cacheName: runner.name.replaceAll('/', '-'),
      });

    const list = JSON.parse(invoke(['list', '--json']));
    assert.ok(list.some((artifact) => artifact.id === 'hello-agent'));

    const show = JSON.parse(invoke(['show', 'hello-agent', '--json']));
    assert.equal(show.id, 'hello-agent');

    invoke(['install', 'hello-agent', '--yes', '--project', project]);
    const installedSkill = await readFile(
      path.join(project, '.agents/skills/hello-agent/SKILL.md'),
      'utf8',
    );
    assert.match(installedSkill, /Hello Agent/);

    assert.deepEqual(
      JSON.parse(await readFile(manifestPath, 'utf8')),
      consumerManifest,
      `${runner.name} a modifié le manifeste du consommateur`,
    );
    assert.deepEqual(
      (await readdir(consumer)).sort(),
      ['fixture-project', 'package.json'],
      `${runner.name} a ajouté des fichiers au consommateur`,
    );
    console.log(`Smoke source Git ${runner.name} : list/show/install OK.`);
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
