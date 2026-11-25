'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const { findUnmanagedArtifacts } = require('../discovery.ts');

let root;
afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = undefined;
});

test('finds unmanaged Markdown skills and ignores tracked paths', () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-discovery-'));
  fs.mkdirSync(path.join(root, '.agents/skills/demo'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.agents/skills/demo/SKILL.md'),
    '---\nname: Demo\ndescription: Demo skill\n---\nBody\n',
  );
  const vibeSkill = '.vibe/skills/vibe-demo/SKILL.md';
  fs.mkdirSync(path.dirname(path.join(root, vibeSkill)), { recursive: true });
  fs.writeFileSync(path.join(root, vibeSkill), '---\nname: vibe-demo\ndescription: Vibe skill\n---\nBody\n');
  fs.mkdirSync(path.join(root, '.claude/agents'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.claude/agents/review.agent.md'),
    '---\nname: Review\ndescription: Review agent\n---\nBody\n',
  );
  const found = findUnmanagedArtifacts(root);
  assert.ok(found.some(({ kind, id }) => kind === 'skill' && id === 'demo'));
  assert.ok(found.some(({ kind, id }) => kind === 'agent' && id === 'review'));
  const remaining = findUnmanagedArtifacts(root, new Set(['.agents/skills/demo/SKILL.md']));
  assert.deepEqual(
    remaining.filter(({ kind }) => kind === 'skill').map(({ id, paths }) => [id, paths]),
    [['vibe-demo', [vibeSkill]]],
  );
});
