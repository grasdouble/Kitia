'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const { dirname, resolve } = require('node:path');

const packageRoot = resolve(__dirname, '..');
const workspaceRoot = resolve(packageRoot, '..');
const marker = resolve(packageRoot, '.stage-package-docs.json');
const files = [
  'README.md',
  'LICENSE',
  'CONTRIBUTING.md',
  'docs/cli-contract.md',
  'docs/inventory-migrations.md',
  'docs/resource-audit.md',
  'docs/resource-collections.md',
];

const hash = (content) => createHash('sha256').update(content).digest('hex');

const packageContent = (file) => {
  const content = fs.readFileSync(resolve(workspaceRoot, file));
  if (!file.startsWith('docs/')) return content;
  return Buffer.from(content.toString().replaceAll('../app/schemas/', '../schemas/'));
};

function clean() {
  if (!fs.existsSync(marker)) return;

  const state = JSON.parse(fs.readFileSync(marker, 'utf8'));
  if (
    !Array.isArray(state.files) ||
    state.files.some(({ path, sha256 }) => !files.includes(path) || !/^[a-f0-9]{64}$/.test(sha256))
  ) {
    throw new Error(`Invalid package-doc staging marker: ${marker}`);
  }

  let retained = false;
  for (const { path, sha256 } of state.files) {
    const destination = resolve(packageRoot, path);
    if (!fs.existsSync(destination)) continue;
    if (hash(fs.readFileSync(destination)) !== sha256) {
      console.warn(`Preserving modified staged package file: ${destination}`);
      retained = true;
      continue;
    }
    fs.rmSync(destination);
  }

  for (const directory of state.createdDirectories ?? []) {
    if (directory !== 'docs') throw new Error(`Invalid staged directory: ${directory}`);
    try {
      fs.rmdirSync(resolve(packageRoot, directory));
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error;
    }
  }

  if (!retained) fs.rmSync(marker);
}

if (process.argv[2] === '--clean') {
  clean();
} else {
  if (process.argv.length > 2) throw new Error('Usage: stage-package-docs.js [--clean]');
  clean();
  if (fs.existsSync(marker)) throw new Error(`Previous package staging still needs attention: ${marker}`);

  const staged = files.map((file) => ({
    path: file,
    content: packageContent(file),
  }));
  for (const { path } of staged) {
    if (fs.existsSync(resolve(packageRoot, path))) {
      throw new Error(`Refusing to overwrite pre-existing package file: ${resolve(packageRoot, path)}`);
    }
  }

  const createdDirectories = fs.existsSync(resolve(packageRoot, 'docs')) ? [] : ['docs'];
  fs.writeFileSync(
    marker,
    `${JSON.stringify({
      files: staged.map(({ path, content }) => ({ path, sha256: hash(content) })),
      createdDirectories,
    })}\n`,
    { flag: 'wx' },
  );
  for (const { path, content } of staged) {
    const destination = resolve(packageRoot, path);
    fs.mkdirSync(dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content, { flag: 'wx' });
  }
}
