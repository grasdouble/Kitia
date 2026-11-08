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

test("CatalogScreen wraps complete descriptions and pinned sources at narrow widths", async () => {
  const { CatalogScreen } = await import("../dist/dashboard/screens.mjs");
  const description = "A long description with enough detail to wrap across several narrow terminal lines without losing any words.";
  const sourcePath = "skills/long-resource-folder/with-an-extraordinarily-long-unbroken-source-path-segment";
  const sourceRef = "0123456789abcdef0123456789abcdef01234567";
  const source = `org/very-long-example-repository/${sourcePath}@${sourceRef}`;
  for (const columns of [56, 120]) {
    const tree = CatalogScreen({
      ...catalogProps({
        catalog: "sample",
        kind: "skill",
        id: "long-resource",
        description,
        license_status: "MIT",
        source_repository: "org/very-long-example-repository",
        source_path: sourcePath,
        source_ref: sourceRef,
      }),
      columns,
    });
    const text = visibleInkText(tree).join("");
    assert.ok(text.replace(/\s/g, "").includes(description.replace(/\s/g, "")));
    assert.ok(text.includes(source));
  }
});

test("InventoryScreen wraps complete locations and descriptions at narrow widths", async () => {
  const { InventoryScreen } = await import("../dist/dashboard/screens.mjs");
  const description = "A long inventory description that must remain complete when shown in a narrow terminal.";
  const location = "/workspace/projects/a-resource-folder/with-an-extraordinarily-long-unbroken-path-segment";
  const sourceRef = "0123456789abcdef0123456789abcdef01234567";
  for (const columns of [56, 120]) {
    const tree = InventoryScreen({
      resources: [{
        catalog: "local",
        kind: "skill",
        id: "long-resource",
        scope: "project",
        status: "current",
        managed: false,
        paths: [location],
        source_repository: "example/long-repository-name",
        description,
        source_ref: sourceRef,
      }],
      errors: [],
      query: "",
      filterMode: false,
      catalogFilter: "all",
      kindFilter: "all",
      selectedIndex: 0,
      versionLabel: "test",
      actionMessage: "",
      catalogAvailable: false,
      canExecute: false,
      showDetails: true,
      columns,
      rows: 40,
    });
    const text = visibleInkText(tree).join("");
    assert.ok(text.replace(/\s/g, "").includes(description.replace(/\s/g, "")));
    assert.ok(text.includes(location));
    assert.ok(text.includes("https://github.com/example/long-repository-name"));
    assert.ok(text.includes(sourceRef));
  }
});
