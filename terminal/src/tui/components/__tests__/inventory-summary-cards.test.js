"use strict";

const assert = require("node:assert/strict");
const React = require("react");
const { test } = require("node:test");
const { renderTerminal } = require("../../__tests__/render-terminal.js");

test("InventorySummaryCards reflects scope and update counts in normal and compact layouts", async () => {
  const { InventorySummaryCards } = await import("../inventory-summary-cards.mjs");
  const resources = [
    { id: "a", scope: "project", status: "current" },
    { id: "b", scope: "user", status: "update" },
    { id: "c", scope: "project", managed: false, status: "unmanaged" },
  ];
  const normal = await renderTerminal(React.createElement(InventorySummaryCards, { resources, width: 120 }), {
    columns: 120, rows: 12,
  });
  assert.ok(normal.includes("1 managed · 1 unmanaged") && normal.includes("1 managed · 0 unmanaged"));
  const compact = await renderTerminal(React.createElement(InventorySummaryCards, {
    resources, width: 90, compact: true,
  }), { columns: 90, rows: 8 });
  assert.ok(compact.includes("PROJECT") && compact.includes("USER") && compact.includes("UPDATES"));
  const ultraCompact = await renderTerminal(React.createElement(InventorySummaryCards, {
    resources, width: 90, ultraCompact: true,
  }), { columns: 90, rows: 3 });
  assert.ok(ultraCompact.includes("PROJECT 2") && ultraCompact.includes("USER 1") && ultraCompact.includes("UPDATES 1"));
});
