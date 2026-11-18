'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildSourceSkillArgs, formatGhDiagnostics, describeGhFailure } = require('../gh-skill.ts');

test('builds scoped source skill commands and explains command failures', () => {
  const resource = {
    id: 'demo',
    kind: 'skill',
    catalog: 'sample',
    source_repository: 'acme/repo',
    source_path: 'skills/demo',
  };
  assert.deepEqual(
    buildSourceSkillArgs('install', { ...resource, source_ref: 'a'.repeat(40) }, 'github-copilot', {
      scope: 'user',
      force: true,
      target: '/home/user',
    }),
    [
      'skill',
      'install',
      'acme/repo',
      'skills/demo',
      '--agent',
      'github-copilot',
      '--scope',
      'user',
      '--pin',
      'a'.repeat(40),
      '--dir',
      '/home/user/.agents/skills',
      '--force',
    ],
  );
  assert.match(formatGhDiagnostics({ stdout: 'ok', stderr: 'warning', exitCode: 1 }), /warning/);
  assert.match(describeGhFailure(''), /recognized cause/i);
});
