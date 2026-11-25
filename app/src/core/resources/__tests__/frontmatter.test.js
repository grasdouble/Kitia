'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parseFrontmatter, frontmatterParts } = require('../frontmatter.ts');
test('frontmatter parses mapping and separates body', () => {
  assert.deepEqual(parseFrontmatter('---\nname: test\n---\nbody', 'x.md'), new Map([['name', 'test']]));
  assert.equal(frontmatterParts('---\na: 1\n---\ntext', 'x').body, 'text');
});
test('frontmatter accepts CRLF YAML without changing the body bytes', () => {
  const { values, body } = frontmatterParts('---\r\npaths: [src/**]\r\n---\r\nFirst\r\nSecond\r\n', 'x.md');
  assert.deepEqual(values.get('paths'), ['src/**']);
  assert.equal(body, 'First\r\nSecond\r\n');
});
test('frontmatter rejects malformed framing and duplicate YAML keys', () => {
  assert.throws(() => parseFrontmatter('no', 'x'), /start with YAML/);
  assert.throws(() => parseFrontmatter('---\na: 1\na: 2\n---', 'x'), /Invalid YAML/);
});
