"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

test("shortcut line helpers order categories and wrap content to available widths", async () => {
  const {
    categorizedShortcutLines, wrappedShortcutLines, shortcutFooterLines,
  } = await import("../../../../../dist/dashboard/components/shortcuts/shortcut-lines.mjs");
  const categorized = categorizedShortcutLines({
    Navigation: ["↑↓ navigate"],
    Actions: ["ENTER install", "V revisions"],
    Filters: [],
    Display: ["D details"],
  });
  assert.deepEqual(categorized, [
    "Actions",
    "ENTER install · V revisions",
    "Display",
    "D details",
    "Navigation",
    "↑↓ navigate",
  ]);
  const wrapped = wrappedShortcutLines(categorized, 20);
  assert.ok(wrapped.includes("Actions"));
  assert.ok(wrapped.every((line) => line.length <= 16));
  assert.ok(wrapped.some((line) => line.includes("ENTER install")));

  const footer = shortcutFooterLines(categorized, 14);
  assert.ok(footer.every((line) => line.length <= 14));
  assert.deepEqual(footer.flatMap((line) => line.split(" · ")), [
    "ENTER install", "V revisions", "D details", "↑↓ navigate",
  ]);
});
