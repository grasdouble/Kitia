'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { prepareSelfUpdate } = require('../self-update.ts');

const packageName = '@grasdouble/kitia';
const entry = path.join('dist', 'kitia.js');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-self-update-'));
  const bin = path.join(directory, 'bin');
  fs.mkdirSync(bin);
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
  t.after(() => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    manager(name, output) {
      fs.writeFileSync(
        path.join(bin, name),
        `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(output)});\n`,
        { mode: 0o755 },
      );
    },
  };
}

function packageIn(modules) {
  const location = path.join(modules, packageName);
  fs.mkdirSync(path.join(location, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(location, entry), '');
  return location;
}

function linkPackage(modules, target) {
  const location = path.join(modules, packageName);
  fs.mkdirSync(path.dirname(location), { recursive: true });
  fs.symlinkSync(target, location, 'dir');
  return location;
}

const unixOnly = { skip: process.platform === 'win32' };

test('npm self-update refuses a linked checkout but accepts the installed global executable', unixOnly, async (t) => {
  const { directory, manager } = fixture(t);
  const global = path.join(directory, 'global', 'node_modules');
  const checkout = packageIn(path.join(directory, 'project', 'node_modules'));
  const linked = linkPackage(global, checkout);
  manager('npm', global);
  manager('pnpm', '[]');
  assert.equal(await prepareSelfUpdate(path.join(linked, entry)), null);

  fs.unlinkSync(linked);
  const installed = packageIn(global);
  const shim = path.join(directory, 'bin', 'kitia');
  fs.symlinkSync(path.join(installed, entry), shim);
  assert.equal((await prepareSelfUpdate(shim))?.manager, 'npm');
});

test('pnpm self-update distinguishes the global launcher from dlx sharing its store', unixOnly, async (t) => {
  const { directory, manager } = fixture(t);
  const store = packageIn(path.join(directory, 'store', 'node_modules'));
  const project = path.join(directory, 'global');
  const global = linkPackage(path.join(project, 'node_modules'), store);
  const dlx = linkPackage(path.join(directory, 'dlx', 'node_modules'), store);
  manager('npm', '');
  for (const listedPath of [global, store]) {
    manager(
      'pnpm',
      JSON.stringify([{ path: project, dependencies: { [packageName]: { from: packageName, path: listedPath } } }]),
    );
    assert.equal((await prepareSelfUpdate(path.join(global, entry)))?.manager, 'pnpm');
    assert.equal(await prepareSelfUpdate(path.join(dlx, entry)), null);
  }
});
