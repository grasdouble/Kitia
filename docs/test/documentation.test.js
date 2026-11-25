'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function markdownFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? markdownFiles(file) : entry.name.endsWith('.md') ? [file] : [];
  });
}

test('local Markdown links resolve', () => {
  const files = [
    ...['README.md', 'CONTRIBUTING.md'].map((file) => path.join(root, file)),
    path.join(root, 'app', 'CHANGELOG.md'),
    ...markdownFiles(path.join(root, 'docs')),
    ...markdownFiles(path.join(root, 'app', 'src', 'migrations')),
    ...markdownFiles(path.join(root, '.github')),
  ];
  for (const file of files) {
    for (const [, url] of fs.readFileSync(file, 'utf8').matchAll(/\[[^\]\n]*\]\(([^\s)]+)\)/g)) {
      if (/^[a-z]+:/i.test(url)) continue;
      const [relative] = url.split('#');
      assert.ok(
        fs.existsSync(path.resolve(path.dirname(file), relative || path.basename(file))),
        `${path.relative(root, file)}: missing ${url}`,
      );
    }
  }
});

test('workspace packages, workflow, and docs agree on runtime and project identity', () => {
  const workspace = JSON.parse(read('package.json'));
  const pkg = JSON.parse(read('app/package.json'));
  const web = JSON.parse(read('web/package.json'));
  assert.equal(workspace.private, true);
  assert.equal(web.name, '@grasdouble/kitia-web');
  assert.equal(web.private, true);
  assert.equal(pkg.name, '@grasdouble/kitia');
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.engines.node, '>=26');
  assert.deepEqual(Object.keys(pkg.bin), ['kitia']);
  assert.match(pkg.repository.url, /github\.com\/grasdouble\/Kitia\.git$/);
  assert.match(read('README.md'), /^# Kitia/m);
});
