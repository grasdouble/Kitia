'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { renderTerminal } = require('../../../__tests__/render-terminal.js');

test('action button preserves clipping, border glyphs, and active/selected colors', async () => {
  const { ActionButton } = await import('../button.mjs');
  const selected = ActionButton({
    id: 'remove',
    label: 'Delete uninstall',
    width: 9,
    active: false,
    color: 'redBright',
    activeColor: 'blue',
    selectedForeground: 'whiteBright',
    selectedSurface: true,
  });
  const selectedFrame = await renderTerminal(selected, { columns: 12, rows: 4 });
  assert.ok(selectedFrame.includes('╭'));
  assert.ok(selectedFrame.includes('╰'));
  assert.ok(selectedFrame.includes('Dele…'));
  const selectedText = selected.props.children[1];
  assert.equal(selectedText.props.color, 'whiteBright');
  assert.equal(selectedText.props.bold, false);
  assert.equal(selectedText.props.underline, false);
  assert.equal(selected.props.children[0].props.color, 'redBright');

  const active = ActionButton({
    id: 'install',
    label: 'Install',
    width: 12,
    active: true,
    color: 'cyan',
    activeColor: 'blue',
    selectedForeground: 'whiteBright',
  });
  const activeText = active.props.children[1];
  assert.equal(activeText.props.color, 'cyan');
  assert.equal(activeText.props.bold, true);
  assert.equal(activeText.props.underline, true);
  assert.equal(active.props.children[0].props.color, 'blue');
});
