"use strict";

const assert = require("node:assert/strict");
const React = require("react");
const { test } = require("node:test");
const { renderTerminal } = require("../../__tests__/render-terminal.js");

function colorsIn(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(colorsIn);
  return [node.props?.color, ...colorsIn(node.props?.children)].filter(Boolean);
}

test("text input renders focused normal and unfocused compact fields", async () => {
  const { TextInput } = await import("../../../../../dist/dashboard/components/controls/text-input.mjs");
  const focusedProps = {
    value: "Search term▏",
    width: 18,
    focused: true,
    compact: false,
    focusedColor: "cyan",
    unfocusedColor: "gray",
    labelColor: "white",
  };
  const focused = React.createElement(React.Fragment, null,
    ...["top", "middle", "bottom"].map((side) =>
      TextInput({ ...focusedProps, side })));
  const focusedFrame = await renderTerminal(focused, { columns: 22, rows: 5 });
  assert.ok(focusedFrame.includes("╭"));
  assert.ok(focusedFrame.includes("╰"));
  assert.ok(focusedFrame.includes("Search term▏"));
  assert.ok(colorsIn(focused).includes("cyan"));
  assert.ok(colorsIn(focused).includes("white"));

  const unfocused = TextInput({
    value: "query",
    width: 12,
    focused: false,
    compact: true,
    focusedColor: "cyan",
    unfocusedColor: "gray",
    labelColor: "white",
  });
  const compactFrame = await renderTerminal(unfocused, { columns: 16, rows: 2 });
  assert.ok(compactFrame.includes("│"));
  assert.ok(compactFrame.includes("query"));
  assert.ok(!compactFrame.includes("╭") && !compactFrame.includes("╰"));
  assert.ok(colorsIn(unfocused).includes("gray"));
});
