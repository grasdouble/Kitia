"use strict";

const assert = require("node:assert/strict");
const React = require("react");
const { test } = require("node:test");
const { renderTerminal } = require("../../__tests__/render-terminal.js");

test("JoinedWorkspace renders list and details in split and stacked layouts", async () => {
  const { Text } = await import("ink");
  const { JoinedWorkspace, joinedWorkspaceLayout } = await import("../joined-workspace.mjs");
  const splitLayout = joinedWorkspaceLayout(80, 18, false, true, 0);
  assert.deepEqual(splitLayout, {
    innerWidth: 78,
    listWidth: 58,
    detailsWidth: 19,
    dividerWidth: 1,
    contentHeight: 16,
    listRows: 13,
    detailsRows: 14,
    detailsContentRows: 14,
    firstResourceRowOffset: 4,
  });
  const stackedLayout = joinedWorkspaceLayout(80, 18, true, true, 2);
  assert.equal(stackedLayout.detailsRows, 6);
  assert.equal(stackedLayout.detailsContentRows, 4);
  assert.equal(stackedLayout.listRows, 4);
  const renderWorkspace = (stacked) => React.createElement(JoinedWorkspace, {
    width: 80,
    height: 18,
    layout: joinedWorkspaceLayout(80, 18, stacked, true, 0),
    showDetails: true,
    listTitle: "RESOURCE LIST",
    listMeta: "1 result",
    listHeader: "RESOURCE KIND",
    listRows: [React.createElement(Text, { key: "resource" }, "release-helper skill")],
    detailsTitle: "SELECTION DETAILS",
    details: [React.createElement(Text, { key: "detail" }, "selected helper")],
  });
  for (const stacked of [false, true]) {
    const frame = await renderTerminal(renderWorkspace(stacked), { columns: 84, rows: 20 });
    assert.ok(frame.includes("RESOURCE LIST"));
    assert.ok(frame.includes("release-helper skill"));
    assert.ok(frame.includes("SELECTION DETAILS"));
    assert.ok(frame.includes("selected helper"));
  }
});
