'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { executeInstallationOperation, runSourceOperation } = require('../lifecycle.ts');

test('source lifecycle rejects unsupported operations and actions', async () => {
  await assert.rejects(
    executeInstallationOperation({ operation: 'unsupported', target: '.' }, []),
    /Unsupported installation operation/,
  );
  assert.throws(
    () => runSourceOperation({ action: 'unsupported', resource: { kind: 'agent' }, target: '.' }),
    /Unsupported source resource action/,
  );
});

test('install rejects a source without a pinned revision before writing files or inventory', (t) => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-source-lifecycle-'));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  const resource = {
    kind: 'agent',
    id: 'reviewer',
    catalog: 'Fixture',
    source_repository: 'example/catalog',
    source_path: 'agents/reviewer.md',
    license_status: 'MIT',
  };

  assert.throws(
    () => runSourceOperation({ action: 'install', resource, target, destinations: ['copilot', 'claude'] }),
    /pinned source-catalog resources/,
  );
  assert.deepEqual(fs.readdirSync(target), []);
});
