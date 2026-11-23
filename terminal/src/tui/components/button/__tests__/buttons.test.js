'use strict';

const assert = require('node:assert/strict');
const React = require('react');
const { test } = require('node:test');
const { renderTerminal } = require('../../../__tests__/render-terminal.js');

test('action button rows and contextual buttons share layout and register hit regions', async () => {
  const { ActionButtonRow } = await import('../button-row.mjs');
  const { ActionButtons } = await import('../button-layout.mjs');
  const controls = {
    columns: 64,
    section: 'inventory',
    focus: 'actions',
    query: '',
    searchActive: false,
    actions: [
      { id: 'remove', label: 'Remove' },
      { id: 'preview', label: 'Preview' },
    ],
    actionIndex: 0,
    actionPairs: true,
    selectedSurface: true,
  };
  const { dashboardActionButtonLines } = await import('../../controls/control-layout-plan.mjs');
  const lines = dashboardActionButtonLines(controls, 40);
  assert.equal(lines.length, 1);
  const rowFrame = await renderTerminal(
    ActionButtonRow({
      line: lines[0],
      controls,
      width: 40,
      selectedSurface: true,
    }),
    { columns: 44, rows: 5 },
  );
  assert.ok(rowFrame.includes('Remove'));
  assert.ok(rowFrame.includes('Preview'));

  const calls = [];
  const contextualFrame = await renderTerminal(
    React.createElement(ActionButtons, {
      controls: {
        ...controls,
        mouse: { replace: (owner, regions) => calls.push({ owner, regions }) },
      },
      width: 40,
    }),
    { columns: 44, rows: 8 },
  );
  assert.ok(contextualFrame.includes('ACTIONS'));
  assert.ok(contextualFrame.includes('Remove'));
  assert.ok(
    calls.some(({ owner, regions }) => owner === 'actions' && regions.some(({ target }) => target.type === 'action')),
  );
});
