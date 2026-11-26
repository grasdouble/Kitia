'use strict';

const assert = require('node:assert/strict');
const React = require('react');
const { test } = require('node:test');
const { renderTerminal } = require('../../../__tests__/render-terminal.js');

test('ShortcutHint renders category labels and highlighted shortcut keys as visible text', async () => {
  const { ShortcutHint } = await import('../shortcut-hint.mjs');
  const frame = await renderTerminal(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(ShortcutHint, { value: 'Actions', width: 20 }),
      React.createElement(ShortcutHint, { value: 'ENTER install', width: 20 }),
    ),
    { columns: 24, rows: 4 },
  );
  assert.ok(frame.includes('Actions'));
  assert.ok(frame.includes('ENTER install'));
});
