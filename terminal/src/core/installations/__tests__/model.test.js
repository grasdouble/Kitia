'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { SOURCE_SKILL_DIRECTORIES } = require('../model.ts');

test('installation skill destinations remain distinct per agent', () => {
  assert.equal(SOURCE_SKILL_DIRECTORIES['claude-code'], '.claude/skills');
  assert.equal(SOURCE_SKILL_DIRECTORIES['github-copilot'], '.agents/skills');
  assert.notEqual(SOURCE_SKILL_DIRECTORIES['claude-code'], SOURCE_SKILL_DIRECTORIES['github-copilot']);
});
