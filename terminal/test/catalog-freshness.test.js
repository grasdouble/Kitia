"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { updateCatalogFreshness } = require("../dist/dashboard/catalog-freshness.mjs");

function stateUpdater(state) {
  return (update) => { state.current = update(state.current); };
}

test("catalog freshness marks missing handlers and failed checks as unknown", async () => {
  const state = { current: { Removed: "current" } };
  const requests = new Map();
  await updateCatalogFreshness([{ name: "Alpha" }], ["Alpha"], requests, stateUpdater(state));
  assert.deepEqual(state.current, { Alpha: "unknown" });
  await updateCatalogFreshness([{ name: "Alpha" }], ["Alpha"], requests, stateUpdater(state), async () => {
    throw new Error("network unavailable");
  });
  assert.deepEqual(state.current, { Alpha: "unknown" });
});

test("catalog freshness ignores stale responses for overlapping requests", async () => {
  const state = { current: {} };
  const requests = new Map();
  let finishFirst;
  let finishSecond;
  const first = updateCatalogFreshness([{ name: "Alpha" }], ["Alpha"], requests, stateUpdater(state), () =>
    new Promise((resolve) => { finishFirst = resolve; }));
  const second = updateCatalogFreshness([{ name: "Alpha" }], ["Alpha"], requests, stateUpdater(state), () =>
    new Promise((resolve) => { finishSecond = resolve; }));
  assert.deepEqual(state.current, { Alpha: "checking" });
  finishSecond([{ name: "Alpha", status: "current" }]);
  await second;
  finishFirst([{ name: "Alpha", status: "outdated" }]);
  await first;
  assert.deepEqual(state.current, { Alpha: "current" });
});
