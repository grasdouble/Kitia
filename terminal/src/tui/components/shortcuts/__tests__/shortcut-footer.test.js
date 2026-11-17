'use strict';

const assert = require('node:assert/strict');
const React = require('react');
const { test } = require('node:test');
const { renderTerminal } = require('../../../__tests__/render-terminal.js');

test('ShortcutFooter wraps shortcut contents without rendering category headings', async () => {
  const { ShortcutFooter } = await import('../shortcut-footer.mjs');
  const { Box } = await import('ink');
  const frame = await renderTerminal(
    React.createElement(
      Box,
      { position: 'relative', width: 30, height: 5 },
      React.createElement(ShortcutFooter, {
        lines: ['Actions', 'A install · Delete uninstall', 'Filters', 'F filter'],
        width: 30,
      }),
    ),
    { columns: 34, rows: 5 },
  );
  assert.ok(frame.includes('A install'));
  assert.ok(frame.includes('Delete uninstall'));
  assert.ok(frame.includes('F filter'));
  assert.ok(!frame.includes('Actions') && !frame.includes('Filters'));
});
