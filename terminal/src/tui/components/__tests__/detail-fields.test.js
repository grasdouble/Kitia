"use strict";

const assert = require("node:assert/strict");
const React = require("react");
const { renderTerminal } = require("../../__tests__/render-terminal.js");
const { test } = require("node:test");

test("detail fields render labels, values, and wrapped hyperlinks", async () => {
  const { detailField, detailLocations } = await import("../detail-fields.mjs");
  const frame = await renderTerminal(React.createElement(React.Fragment, null, ...[
    ...detailField("name", "NAME", "Example value", 40),
    ...detailLocations("locations", [{ text: "https://example.test/a-long-resource-path", href: "https://example.test/a-long-resource-path" }], 14),
  ]));

  assert.match(frame, /NAME/);
  assert.match(frame, /Example value/);
  assert.match(frame, /\u001b\]8;;https:\/\/example\.test\/a-long-resource-path\u001b\\/);
  assert.match(frame, /\u001b\]8;;\u001b\\/);
  assert.ok(frame.includes("https://example.test/"));
  assert.ok(frame.includes("a-long-resource-path"));
});
