'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { diagnose } = require('../doctor.ts');
test('diagnostics reports target and network checks without invoking network probes', () => {
  const calls = [];
  const result = diagnose({ target: '.', network: false }, (cmd, args) => {
    calls.push([cmd, args]);
    return { status: 0, stdout: cmd === 'git' ? 'git version 2' : 'gh version 2' };
  });
  assert.ok(result.checks.some((c) => c.id === 'target' && c.status === 'ok'));
  assert.ok(result.checks.some((c) => c.id === 'network' && c.status === 'skipped'));
  assert.equal(
    calls.some(([, a]) => a[0] === 'auth'),
    false,
  );
});
