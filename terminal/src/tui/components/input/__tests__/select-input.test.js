'use strict';

const assert = require('node:assert/strict');
const React = require('react');
const { test } = require('node:test');
const { renderTerminal } = require('../../../__tests__/render-terminal.js');

test('select input renders its supplied value in compact and normal frames', async () => {
  const { SelectInput } = await import('../select-input.mjs');
  const compact = await renderTerminal(
    SelectInput({
      value: 'All kinds▾',
      width: 16,
      focused: true,
      compact: true,
      focusedColor: 'cyan',
      unfocusedColor: 'gray',
      labelColor: 'white',
    }),
    { columns: 20, rows: 2 },
  );
  assert.ok(compact.includes('│'));
  assert.ok(compact.includes('All kinds▾'));
  assert.ok(!compact.includes('╭') && !compact.includes('╰'));

  const normalProps = {
    value: 'MIT▾',
    width: 12,
    focused: false,
    compact: false,
    focusedColor: 'cyan',
    unfocusedColor: 'gray',
    labelColor: 'white',
  };
  const normal = await renderTerminal(
    React.createElement(
      React.Fragment,
      null,
      ...['top', 'middle', 'bottom'].map((side) => SelectInput({ ...normalProps, side })),
    ),
    { columns: 16, rows: 5 },
  );
  assert.ok(normal.includes('╭'));
  assert.ok(normal.includes('╰'));
  assert.ok(normal.includes('MIT▾'));
});
