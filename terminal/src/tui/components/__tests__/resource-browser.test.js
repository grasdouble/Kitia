'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

test('resource browser plan preserves responsive thresholds and warning reservations', async () => {
  const { resourceBrowserPlan } = await import('../resource-browser.mjs');
  const controls = {
    columns: 120,
    section: 'inventory',
    focus: 'list',
    query: '',
    searchActive: false,
    filters: [],
    actions: [{ id: 'install', label: 'Install' }],
  };
  const plan = (columns, rows, warningRows = 0) =>
    resourceBrowserPlan({
      controls,
      modalActive: false,
      columns,
      rows,
      warningRows,
      footerRows: 2,
      showDetails: true,
    });

  const ultraCompact = plan(120, 39);
  const compactHeight = plan(120, 40);
  assert.equal(ultraCompact.summaryRows, 1);
  assert.equal(compactHeight.summaryRows, 4);
  assert.equal(plan(75, 50).compactSummary, true);
  assert.equal(plan(76, 50).compactSummary, false);
  assert.equal(plan(75, 50).workspaceGap, 0);
  assert.equal(plan(76, 50).workspaceGap, 1);
  assert.equal(plan(93, 50).workspaceLayout.detailsWidth, 0);
  assert.ok(plan(94, 50).workspaceLayout.detailsWidth > 0);

  const normal = plan(94, 50);
  const withWarnings = plan(94, 50, 3);
  assert.equal(withWarnings.workspaceHeight, normal.workspaceHeight - 3);
  assert.equal(normal.filterProps.rowOffset, normal.tabsHeight + normal.summaryRows);
  assert.ok(normal.actionRows > 0, 'detail action rows participate in the final workspace layout');
  assert.equal(normal.workspaceLayout.detailsContentRows, normal.workspaceLayout.detailsRows - normal.actionRows);
});
