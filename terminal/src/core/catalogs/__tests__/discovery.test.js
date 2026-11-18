'use strict';
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const { createSourceIndex, sourceMetadata } = require('../discovery.ts');
let root;
afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = undefined;
});

test('discovers indexed Markdown resources and safely rejects escaping source paths', () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-catalog-index-'));
  fs.mkdirSync(path.join(root, 'skills/demo'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills/demo/SKILL.md'), '---\nname: Demo\ndescription: Example\n---\nBody\n');
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Test']);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-qm', 'catalog fixture']);
  const index = createSourceIndex('https://github.com/acme/repo', 'team', root);
  assert.ok(index.resources.some(({ kind, id }) => kind === 'skill' && id === 'demo'));
  assert.equal(sourceMetadata(path.join(root, 'skills/demo/SKILL.md')).get('name'), 'Demo');
  assert.throws(
    () =>
      createSourceIndex('https://github.com/acme/repo', 'team', root, {
        mode: 'custom',
        entries: [{ kind: 'agent', path: '../outside.md' }],
      }),
    /unsafe|escape/i,
  );
});

test('source indexes distinguish SPDX expressions from unknown upstream license values', () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-spdx-catalog-'));
  const repository = path.join(root, 'repo');
  const resources = [
    { id: 'mit-only', license: 'MIT' },
    { id: 'dual-license', license: 'MIT OR Apache-2.0' },
    { id: 'custom-license', license: 'Acme  commercial license' },
    { id: 'no-license' },
  ];
  for (const resource of resources) {
    const directory = path.join(repository, 'skills', resource.id);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'SKILL.md'),
      [
        '---',
        `name: ${resource.id}`,
        `description: ${resource.id} test resource.`,
        ...(resource.license ? [`license: ${resource.license}`] : []),
        '---',
        'Resource body.',
      ].join('\n'),
    );
  }
  execFileSync('git', ['init', '--quiet', repository]);
  execFileSync('git', ['-C', repository, 'remote', 'add', 'origin', 'https://github.com/example/licenses']);
  execFileSync('git', ['-C', repository, 'add', '.']);
  execFileSync('git', [
    '-C',
    repository,
    '-c',
    'user.name=License fixtures',
    '-c',
    'user.email=fixtures@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '-m',
    'Add license test resources',
  ]);

  const catalog = createSourceIndex('https://github.com/example/licenses', 'licenses', repository);
  const byId = new Map(catalog.resources.map((resource) => [resource.id, resource]));
  assert.equal(byId.get('mit-only').license_status, 'MIT');
  assert.equal(byId.get('mit-only').license_spdx, 'MIT');
  assert.equal(byId.get('dual-license').license_status, 'MIT OR Apache-2.0');
  assert.equal(byId.get('dual-license').license_spdx, 'MIT OR Apache-2.0');
  assert.equal(byId.get('custom-license').license_status, 'Acme  commercial license');
  assert.equal(byId.get('custom-license').license_spdx, undefined);
  assert.equal(byId.get('no-license').license_status, 'not-declared');
  assert.equal(byId.get('no-license').license_spdx, undefined);
});
