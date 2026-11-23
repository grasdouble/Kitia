'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

test('shortcut line helpers order categories and wrap content to available widths', async () => {
  const { categorizedShortcutLines, wrappedShortcutLines } = await import('../shortcut-lines.mjs');
  const categorized = categorizedShortcutLines({
    Navigation: ['↑↓ navigate'],
    Actions: ['ENTER install', 'V revisions'],
    Filters: [],
    Display: ['D details'],
  });
  assert.deepEqual(categorized, [
    'Actions',
    'ENTER install · V revisions',
    'Display',
    'D details',
    'Navigation',
    '↑↓ navigate',
  ]);
  const wrapped = wrappedShortcutLines(categorized, 20);
  assert.ok(wrapped.includes('Actions'));
  assert.ok(wrapped.every((line) => line.length <= 16));
  assert.ok(wrapped.some((line) => line.includes('ENTER install')));
});
