"use strict";

const assert = require("node:assert/strict");
const React = require("react");
const { test } = require("node:test");
const { renderTerminal } = require("../../__tests__/render-terminal.js");

test("SectionTabs renders planned section labels and reports tab hit regions", async () => {
  const { SectionTabs } = await import("../../../../../dist/dashboard/components/controls/section-tabs.mjs");
  const { dashboardControlsLayout } = await import("../../../../../dist/dashboard/components/controls/control-layout-plan.mjs");
  const plan = dashboardControlsLayout({
    columns: 60,
    part: "tabs",
    section: "browse",
    sectionCounts: { inventory: 4, browse: 7, catalogs: 2 },
    focus: "tabs",
    query: "",
    searchActive: false,
  });
  const regions = [];
  const tabs = plan.lines.map((line) => SectionTabs({
    line,
    width: plan.width,
    section: "browse",
    focus: "tabs",
    onRegion: (item, x, top, bottom) => regions.push({ id: item.id, x, top, bottom }),
  }));
  const frame = await renderTerminal(React.createElement(React.Fragment, null, ...tabs), { columns: 60, rows: 8 });
  assert.ok(frame.includes("Inventory 4"));
  assert.ok(frame.includes("Browse resources 7"));
  assert.ok(frame.includes("Catalogs 2"));
  assert.deepEqual(regions.map(({ id }) => id), ["inventory", "browse", "catalogs"]);
  assert.ok(regions.every(({ top, bottom }) => bottom === top + 1));
});
