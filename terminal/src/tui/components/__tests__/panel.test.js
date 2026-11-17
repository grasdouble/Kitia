'use strict';

const assert = require('node:assert/strict');
const React = require('react');
const { test } = require('node:test');
const { renderTerminal } = require('../../__tests__/render-terminal.js');

test('Panel keeps its title, border, and child content together', async () => {
  const { Text } = await import('ink');
  const { Panel } = await import('../panel.mjs');
  const frame = await renderTerminal(
    React.createElement(
      Panel,
      { title: 'RESOURCE DETAILS', width: 32 },
      React.createElement(Text, null, 'selected item'),
    ),
    { columns: 36, rows: 8 },
  );
  assert.ok(frame.includes('RESOURCE DETAILS'));
  assert.ok(frame.includes('selected item'));
  assert.ok(frame.includes('┌') && frame.includes('└'));
});
