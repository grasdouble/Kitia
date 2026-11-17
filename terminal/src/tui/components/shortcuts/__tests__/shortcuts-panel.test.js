"use strict";

const assert = require("node:assert/strict");
const React = require("react");
const { test } = require("node:test");
const { renderTerminal } = require("../../../__tests__/render-terminal.js");

test("ShortcutsPanel renders categorized, wrapped shortcut lines", async () => {
  const { ShortcutsPanel } = await import("../shortcuts-panel.mjs");
  const frame = await renderTerminal(React.createElement(ShortcutsPanel, {
    lines: ["Actions", "ENTER install · P preview", "Navigation", "↑↓ move"],
    width: 34,
  }), { columns: 40, rows: 12 });
  assert.ok(frame.includes("SHORTCUTS"));
  assert.ok(frame.includes("Actions"));
  assert.ok(frame.includes("ENTER install"));
  assert.ok(frame.includes("Navigation"));
  assert.ok(frame.includes("↑↓ move"));
});
