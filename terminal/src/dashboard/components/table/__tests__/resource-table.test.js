"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

test("resource table windows keep the selected row visible and retain absolute indices", async () => {
  const { resourceTableWindow, resourceTableRows } = await import("../../../../../dist/dashboard/components/table/resource-table.mjs");
  const items = ["zero", "one", "two", "three", "four"];
  const window = resourceTableWindow(items, 3, 2);
  assert.deepEqual(window, { first: 2, items: ["two", "three"] });
  const rows = resourceTableRows({
    window,
    selectedIndex: 3,
    emptyMessage: "empty",
    renderRow: (item, selected, index) => ({ key: item, color: "white", text: `${index}:${item}:${selected}` }),
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].key, "two");
  assert.equal(rows[1].key, "three");
  assert.equal(rows[1].props.selected, true);
  assert.equal(rows[0].props.selected, false);
  assert.equal(rows[0].props.row.text, "2:two:false");
  assert.equal(rows[1].props.row.text, "3:three:true");
  const emptyRows = resourceTableRows({
    window: { first: 0, items: [] },
    selectedIndex: 0,
    emptyMessage: "nothing here",
    renderRow: () => assert.fail("empty windows must not render rows"),
  });
  assert.equal(emptyRows[0].props.children, "nothing here");
});

test("resource table rows centralize selection styling and empty state", async () => {
  const { ResourceTableRow, resourceTableRows, resourceTableWindow } =
    await import("../../../../../dist/dashboard/components/table/resource-table.mjs");
  const { DASHBOARD_THEME } = await import("../../../../../dist/dashboard/colors.js");
  const items = ["one", "two", "three", "four"];
  const window = resourceTableWindow(items, 2, 2);
  assert.equal(window.first, 1);
  assert.deepEqual(window.items, ["two", "three"]);

  const rendered = resourceTableRows({
    window,
    selectedIndex: 2,
    emptyMessage: "No matching resources.",
    renderRow: (item) => ({ key: item, color: "kind-color", text: item }),
  });
  const [previousElement, selectedElement] = rendered;
  assert.equal(previousElement.type, ResourceTableRow);
  assert.equal(previousElement.key, "two");
  assert.equal(selectedElement.type, ResourceTableRow);
  assert.equal(selectedElement.key, "three");
  const previous = previousElement.type(previousElement.props);
  const selected = selectedElement.type(selectedElement.props);
  assert.equal(previous.props.color, "kind-color");
  assert.equal(previous.props.backgroundColor, undefined);
  assert.equal(previous.props.bold, false);
  assert.equal(selected.props.color, DASHBOARD_THEME.semantic.selectedForeground);
  assert.equal(selected.props.backgroundColor, DASHBOARD_THEME.semantic.selected);
  assert.equal(selected.props.bold, true);

  const empty = resourceTableRows({
    window: resourceTableWindow([], 0, 2),
    selectedIndex: 0,
    emptyMessage: "No matching resources.",
    renderRow: () => assert.fail("empty table must not render a row"),
  });
  assert.equal(empty.length, 1);
  assert.equal(empty[0].props.dimColor, true);
  assert.equal(empty[0].props.children, "No matching resources.");
});
