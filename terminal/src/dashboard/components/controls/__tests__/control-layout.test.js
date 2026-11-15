"use strict";

const assert = require("node:assert/strict");
const React = require("react");
const { test } = require("node:test");
const { renderTerminal } = require("../../__tests__/render-terminal.js");

test("ControlLayout composes planned tabs, filter fields, and toolbar actions", async () => {
  const { ControlLayout } = await import("../../../../../dist/dashboard/components/controls/control-layout.mjs");
  const { dashboardControlsLayout } = await import("../../../../../dist/dashboard/components/controls/control-layout-plan.mjs");
  const controls = {
    columns: 88,
    rows: 30,
    section: "browse",
    sectionCounts: { inventory: 4, browse: 7, catalogs: 2 },
    focus: "search",
    query: "repo",
    searchActive: true,
    filters: [{ id: "kind", value: "all", options: ["all", "skill"] }],
    layout: "toolbar",
    actionsInToolbar: true,
    actions: [{ id: "install", label: "Install" }],
    actionIndex: 0,
  };
  const plan = dashboardControlsLayout(controls);
  const regions = [];
  const children = ControlLayout({
    controls,
    layout: plan,
    onRegion: (item, x, top, bottom) => regions.push({ target: item.target, x, top, bottom }),
  });
  const frame = await renderTerminal(React.createElement(React.Fragment, null, ...children), { columns: 88, rows: 30 });
  assert.ok(frame.includes("Browse resources 7"));
  assert.ok(frame.includes("repo▏"));
  assert.ok(frame.includes("All kinds▾"));
  assert.ok(frame.includes("Install"));
  assert.ok(regions.some(({ target }) => target.type === "section" && target.section === "browse"));
  assert.ok(regions.some(({ target }) => target.type === "focus" && target.focus === "search"));
  assert.ok(regions.some(({ target }) => target.type === "filter-open" && target.filter === "kind"));
  assert.ok(regions.some(({ target }) => target.type === "action" && target.action === "install"));
});
