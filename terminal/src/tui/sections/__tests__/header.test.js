'use strict';

const assert = require('node:assert/strict');
const React = require('react');
const { test } = require('node:test');
const { renderTerminal } = require('../../__tests__/render-terminal.js');

test('DashboardHeader retains cat frames, header height, and screen metadata', async () => {
  const { DashboardHeader, DASHBOARD_HEADER_ROWS, dashboardCatArt } = await import('../header.mjs');
  assert.equal(DASHBOARD_HEADER_ROWS, 5);
  assert.deepEqual(dashboardCatArt('idle', 0), [
    '       /\\_/\\',
    '      (=o.o=)',
    '      /:>^<:\\    )',
    '     / .| |. \\  /',
    '     \\__|_|__/_/',
  ]);
  assert.equal(dashboardCatArt('wink', 0)[1], '      (=o.-=)');
  assert.notDeepEqual(dashboardCatArt('lick', 0), dashboardCatArt('lick', 1));
  assert.notDeepEqual(dashboardCatArt('scratch', 0), dashboardCatArt('scratch', 1));

  const frame = await renderTerminal(
    React.createElement(DashboardHeader, {
      versionLabel: 'v-test',
      screenName: 'BROWSE',
      metadata: 'AVAILABLE 2/5',
      columns: 80,
    }),
    { columns: 80, rows: 8 },
  );
  assert.ok(frame.includes('BROWSE'));
  assert.ok(frame.includes('AVAILABLE 2/5'));
});
