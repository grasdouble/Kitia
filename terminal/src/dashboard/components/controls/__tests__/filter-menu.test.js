"use strict";

const React = require("react");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { renderTerminal } = require("../../__tests__/render-terminal.js");

test("FilterMenu renders selected and active options with dismissal and option regions", async () => {
  const { FilterMenu } = await import("../../../../../dist/dashboard/components/controls/filter-menu.mjs");
  const { Box } = await import("ink");
  const regions = [];
  const menu = FilterMenu({
    menu: { left: 2, top: 4, width: 18, first: 0, count: 3, selectedValue: "skill", allLabel: "All kinds" },
    filter: "kind",
    options: ["all", "agent", "skill"],
    menuIndex: 1,
    onRegion: (item, x, top, bottom) => regions.push({ target: item.target, x, top, bottom }),
  });
  const frame = await renderTerminal(React.createElement(Box, {
    position: "relative", width: 24, height: 10,
  }, menu), { columns: 24, rows: 10 });
  assert.ok(frame.includes("╭"));
  assert.ok(frame.includes("╰"));
  assert.ok(frame.includes("All kinds"));
  assert.ok(frame.includes("›"));
  assert.ok(frame.includes("✓"));
  assert.equal(regions.filter(({ target }) => target.type === "filter-dismiss").length, 2);
  assert.deepEqual(regions.filter(({ target }) => target.type === "filter-option")
    .map(({ target }) => target.value), ["all", "agent", "skill"]);
});
