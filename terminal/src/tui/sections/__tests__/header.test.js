'use strict';

const assert = require('node:assert/strict');
const React = require('react');
const { test } = require('node:test');
const { renderTerminal } = require('../../__tests__/render-terminal.js');

test('DashboardHeader shows the mascot, wordmark and version at wide and compact widths', async () => {
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

  for (const [columns, title] of [[80, '█'], [34, 'KITIA']]) {
    const frame = await renderTerminal(
      React.createElement(DashboardHeader, { versionLabel: '2.0.0', columns }),
      { columns, rows: 8 },
    );
    assert.ok(frame.includes('(=o.o=)'));
    assert.ok(frame.includes(title));
    assert.match(frame, /Version 2\.0\.0[ \t]*$/m);
    const lines = frame.trimEnd().split(/\r?\n/);
    if (columns === 80) {
      assert.equal(lines.filter((line) => /[█▀▄]/.test(line)).length, 4);
      assert.match(lines[DASHBOARD_HEADER_ROWS - 1], /Version 2\.0\.0[ \t]*$/);
    }
  }
});
