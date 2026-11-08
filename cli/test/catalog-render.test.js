"use strict";

const assert = require("node:assert/strict");
const React = require("react");
const { test } = require("node:test");
let InkText;

function childText(node) {
  if (Array.isArray(node)) return node.map(childText).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (React.isValidElement(node)) return childText(node.props.children);
  return "";
}

function visibleInkText(node, output = []) {
  if (Array.isArray(node)) {
    for (const child of node) visibleInkText(child, output);
  } else if (React.isValidElement(node)) {
    if (node.type === InkText) output.push(childText(node.props.children));
    visibleInkText(node.props.children, output);
  }
  return output;
}

function catalogProps(resource) {
  return {
    candidates: [resource],
    resources: [],
    catalogs: [],
    query: "",
    filterMode: false,
    catalogFilter: "all",
    kindFilter: "all",
    selectedIndex: 0,
    versionLabel: "test",
    screenName: "Catalog",
    showDetails: true,
    columns: 300,
    rows: 40,
  };
}

test("CatalogScreen exposes source license and pin only when provenance exists", async () => {
  const { Text } = await import("ink");
  InkText = Text;
  const { CatalogScreen } = await import("../dist/dashboard/screens.mjs");
  const source = {
    catalog: "sample",
    kind: "skill",
    id: "demo",
    description: "A test resource.",
    license_status: "MIT",
    source_repository: "org/repo",
    source_path: "skills/demo",
    source_ref: "0123456789abcdef0123456789abcdef01234567",
  };
  const sourceTree = CatalogScreen(catalogProps(source));
  const sourceText = visibleInkText(sourceTree);
  assert.ok(sourceText.includes("LICENSE"));
  assert.ok(sourceText.includes("MIT"));
  assert.ok(sourceText.includes("PINNED SOURCE"));
  assert.ok(sourceText.includes("org/repo/skills/demo@0123456789abcdef0123456789abcdef01234567"));

  const localTree = CatalogScreen(catalogProps({
    catalog: "local",
    kind: "skill",
    id: "local-demo",
    description: "A local resource.",
  }));
  const localText = visibleInkText(localTree);
  assert.ok(localText.includes("LICENSE"));
  assert.ok(localText.includes("not declared"));
  assert.ok(!localText.includes("PINNED SOURCE"));
  assert.ok(!localText.some((text) => text.includes("@0123456789abcdef0123456789abcdef01234567")));
});
