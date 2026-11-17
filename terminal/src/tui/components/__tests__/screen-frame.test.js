'use strict';

const assert = require('node:assert/strict');
const React = require('react');
const { test } = require('node:test');
const { renderTerminal } = require('../../__tests__/render-terminal.js');

test('ScreenFrame bounds dashboard content to its terminal dimensions', async () => {
  const { Text } = await import('ink');
  const { ScreenFrame } = await import('../screen-frame.mjs');
  const frame = await renderTerminal(
    React.createElement(
      ScreenFrame,
      { columns: 28, rows: 5 },
      React.createElement(Text, null, 'bounded dashboard content'),
    ),
    { columns: 28, rows: 5 },
  );
  assert.ok(frame.includes('bounded dashboard content'));
  const terminalRows = frame.split('\n').filter((line) => line.length > 0);
  assert.ok(terminalRows.length <= 5);
});
