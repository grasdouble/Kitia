'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { addPlanEntry } = require('../plan.ts');
const { CatalogError } = require('../../resources/model.ts');

test('plan merges identical destinations and rejects conflicting content', () => {
  const plan = new Map();
  addPlanEntry(plan, 'a.md', Buffer.from('same'));
  addPlanEntry(plan, 'a.md', Buffer.from('same'));
  assert.equal(plan.size, 1);
  assert.throws(() => addPlanEntry(plan, 'a.md', Buffer.from('different')), CatalogError);
});
