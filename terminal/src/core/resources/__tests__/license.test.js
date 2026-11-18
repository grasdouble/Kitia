'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spdxExpression, matchesLicense } = require('../license.ts');
test('license parsing canonicalizes whitespace and filters SPDX identifiers', () => {
  assert.equal(spdxExpression(' MIT  OR Apache-2.0 '), 'MIT OR Apache-2.0');
  assert.equal(spdxExpression('not valid license'), undefined);
  assert.equal(matchesLicense({ license_spdx: 'MIT OR Apache-2.0' }, 'MIT'), true);
  assert.equal(matchesLicense({ license_status: 'unknown' }, 'unknown'), true);
});
