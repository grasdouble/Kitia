'use strict';

const assert = require('node:assert/strict');
const React = require('react');
const { test } = require('node:test');
const { renderTerminal } = require('../../__tests__/render-terminal.js');

test('PanelHeader renders its title and optional header content', async () => {
  const { Text } = await import('ink');
  const { PanelHeader } = await import('../panel-header.mjs');
  const frame = await renderTerminal(
    React.createElement(PanelHeader, { title: 'SOURCE FILE' }, React.createElement(Text, null, 'src/main.ts')),
    { columns: 40, rows: 6 },
  );
  assert.ok(frame.includes('SOURCE FILE'));
  assert.ok(frame.includes('src/main.ts'));
  assert.ok(frame.includes('─'));
});
