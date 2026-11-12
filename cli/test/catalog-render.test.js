"use strict";

const assert = require("node:assert/strict");
const React = require("react");
const { test } = require("node:test");


function childText(node) {
  if (Array.isArray(node)) return node.map(childText).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (React.isValidElement(node)) return childText(node.props.children);
  return "";
}

function visibleInkText(node, InkText, output = []) {
  if (Array.isArray(node)) {
    for (const child of node) visibleInkText(child, InkText, output);
  } else if (React.isValidElement(node)) {
    if (node.type === InkText) {
      output.push(childText(node.props.children));
      return output;
    }
    visibleInkText(node.props.children, InkText, output);
  }
  return output;
}

async function captureDashboardFrame(
  resources,
  actions = {},
  keys = [],
  dimensions = { columns: 120, rows: 56 },
  cleanupKeys = [],
) {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = dimensions.columns;
  output.rows = dimensions.rows;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const done = runDashboard(resources, input, output, [], actions);
  let completed = false;
  const latestFrame = () => {
    const start = rendered.lastIndexOf("\u001b[?2026h");
    const end = rendered.indexOf("\u001b[?2026l", start);
    return start >= 0 && end > start
      ? rendered.slice(start, end)
        .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
        .replace(/\u001b\]8;;[^\u001b]*(?:\u0007|\u001b\\)/g, "")
      : "";
  };
  const waitForFrame = async (predicate, description) => {
    const deadline = Date.now() + 5_000;
    while (!predicate(latestFrame())) {
      if (Date.now() >= deadline) throw new Error(`Dashboard did not render ${description}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return latestFrame();
  };
  try {
    await waitForFrame((frame) => Boolean(frame), "initial dashboard");
    for (const key of keys) {
      const previousFrame = latestFrame();
      input.write(key);
      await waitForFrame((frame) => frame !== previousFrame, `the frame after ${JSON.stringify(key)}`);
    }
    const frame = latestFrame();
    for (const key of cleanupKeys) {
      const previousFrame = latestFrame();
      input.write(key);
      await waitForFrame((nextFrame) => nextFrame !== previousFrame, "dashboard cleanup");
    }
    input.write("q");
    assert.equal(await done, true);
    completed = true;
    return frame;
  } finally {
    input.destroy();
    output.destroy();
  }
}

function separatedPanelFrame(frame, title, hasMetadata = false) {
  const lines = frame.split(/\r?\n/);
  const titleIndex = lines.findIndex((line) => line.includes(`│ ${title}`));
  assert.ok(titleIndex > 0, `${title} has a visible title row`);
  const left = lines[titleIndex].indexOf(title) - 2;
  const right = lines[titleIndex].indexOf("│", left + 1);
  const panelRow = (index) => lines[index].slice(left, right + 1);
  assert.match(panelRow(titleIndex - 1), /^┌─+┐$/, `${title} has an unlabeled top border`);
  assert.equal(panelRow(titleIndex), `│ ${title}${" ".repeat(right - left - title.length - 2)}│`);
  const bottomIndex = lines.findIndex((line, index) =>
    index > titleIndex && line[left] === "└" && line[right] === "┘");
  assert.ok(bottomIndex > titleIndex + 2, `${title} has a visible body and bottom border`);
  const dividerIndices = lines.flatMap((line, index) =>
    index > titleIndex && index < bottomIndex && /^│ ─+ │$/.test(panelRow(index)) ? [index] : []);
  assert.equal(dividerIndices.length, 1, `${title} has exactly one shared header divider`);
  const dividerIndex = dividerIndices[0];
  const header = lines.slice(titleIndex + 1, dividerIndex).map((line) => line.slice(left + 2, right - 1));
  assert.equal(header.length > 0, hasMetadata, `${title} keeps only its existing metadata above the divider`);
  assert.ok(dividerIndex + 1 < bottomIndex, `${title} has a visible body below its divider`);
  return {
    topIndex: titleIndex - 1,
    titleIndex,
    bottomIndex,
    dividerIndex,
    left,
    right,
    header,
    body: lines.slice(dividerIndex + 1, bottomIndex).map((line) => line.slice(left + 2, right - 1)),
  };
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
    licenseFilter: "all",
    selectedIndex: 0,
    versionLabel: "test",
    screenName: "Catalog",
    showDetails: true,
    columns: 300,
    rows: 40,
  };
}

test("dashboard exits and unmounts when its input stream closes", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 80;
  output.rows = 24;
  const done = runDashboard([], input, output);

  input.destroy();
  assert.equal(await done, false);
  output.destroy();
});

test("dashboard colors rows by kind and selection in ANSI", async () => {
  const { execFileSync } = require("node:child_process");
  const { pathToFileURL } = require("node:url");
  const screens = pathToFileURL(require.resolve("../dist/dashboard/screens.mjs")).href;
  const env = { ...process.env, FORCE_COLOR: "1", TERM: "xterm" };
  delete env.NO_COLOR;
  const script = `
    import React from "react";
    import { render } from "ink";
    import { PassThrough } from "node:stream";
    const { CatalogScreen, InventoryScreen } = await import(process.argv[1]);
    const { DASHBOARD_THEME } = await import(new URL("./colors.js", process.argv[1]));
    const resources = [
      { kind: "skill", status: "unmanaged" },
      { kind: "agent", status: "attention", license_status: "Proprietary" },
      { kind: "instruction", status: "unmanaged", managed: false },
      { kind: "other", status: "current", license_status: "Proprietary" },
    ].map((resource) => ({
      catalog: "sample", scope: "project", id: resource.kind + "-one", ...resource,
    }));
    const common = {
      query: "", filterMode: false, catalogFilter: "all", kindFilter: "all",
      versionLabel: "test", showDetails: false, columns: 120, rows: 40,
    };
    const frames = [];
    for (const [component, props] of [
      [CatalogScreen, { candidates: resources, resources: [], catalogs: [], screenName: "Catalog",
        licenseFilter: "all" }],
      [InventoryScreen, { resources, errors: [], actionMessage: "", catalogAvailable: true, canExecute: true }],
    ]) {
      for (let selectedIndex = 0; selectedIndex < resources.length; selectedIndex++) {
        const output = new PassThrough();
        output.isTTY = true;
        output.columns = 120;
        output.rows = 40;
        let frame = "";
        output.on("data", (chunk) => { frame += chunk.toString(); });
        const instance = render(React.createElement(component, { ...common, ...props, selectedIndex }), {
          stdout: output, stdin: new PassThrough(), stderr: output, exitOnCtrlC: false,
        });
        await new Promise((resolve) => setTimeout(resolve, 120));
        instance.unmount();
        frames.push(frame);
      }
    }
    process.stdout.write(JSON.stringify({
      frames,
      selectedAnsi: DASHBOARD_THEME.terminalAnsi[DASHBOARD_THEME.semantic.selected],
    }));
  `;
  const { frames, selectedAnsi } = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script, screens], {
    env, encoding: "utf8", timeout: 10000,
  }));
  const selectedColor = new RegExp(`\\x1b\\[1m\\x1b\\[${selectedAnsi}m`);
  const ansi = /\x1b\[[0-?]*[ -/]*[@-~]/g;
  for (let screen = 0; screen < 2; screen++) {
    for (let selectedIndex = 0; selectedIndex < 4; selectedIndex++) {
      const frame = frames[screen * 4 + selectedIndex];
      const lines = frame.split("\n");
      const rows = ["skill", "agent", "instruction", "other"].map((kind) => {
        const row = lines.find((line) => line.includes(`${kind}-one`));
        assert.ok(row, `missing ${kind} row on screen ${screen}`);
        return row;
      });
      const selectedRow = rows[selectedIndex];
      assert.match(selectedRow, selectedColor);
      const unselectedKindColors = [[33, "skill"], [36, "agent"], [32, screen ? "instr" : "instruction"]];
      for (const [index, [code, label]] of unselectedKindColors.entries()) {
        if (index === selectedIndex) {
          assert.doesNotMatch(rows[index], new RegExp(`\\x1b\\[${code}m`));
          continue;
        }
        assert.match(rows[index], new RegExp(`\\x1b\\[${code}m`));
        assert.match(rows[index], new RegExp(`\\x1b\\[${code}m[\\s\\S]*${label}`));
      }
      if (selectedIndex !== 3) assert.doesNotMatch(rows[3], selectedColor);
      if (screen) {
        if (selectedIndex !== 1) assert.doesNotMatch(rows[1], /\x1b\[33m/);
        if (selectedIndex !== 2) assert.doesNotMatch(rows[2], /\x1b\[90m/);
        if (selectedIndex !== 3) assert.match(rows[3], /\x1b\[32m/);
        else assert.match(rows[3], selectedColor);
      } else if (selectedIndex !== 3) {
        assert.match(rows[3], /\x1b\[33m/);
      } else {
        assert.match(rows[3], selectedColor);
      }
      const plain = rows.map((row) => row.replace(ansi, ""));
      for (const [index, row] of plain.entries()) {
        assert.equal((row.match(/›/g) || []).length, index === selectedIndex ? 1 : 0);
      }
      assert.equal(plain[0].indexOf("skill"), plain[1].indexOf("agent"));
      assert.equal(plain[1].indexOf("agent"), plain[2].indexOf(screen ? "instr " : "instruction "));
      assert.equal(plain[2].indexOf("instruction-one"), plain[3].indexOf("other-one"));
    }
  }
  const { CatalogManagementScreen } = await import(screens);
  const catalogs = [
    { name: "catalog-one", repository: "example/one" },
    { name: "catalog-two", repository: "example/two" },
  ];
  for (let selectedIndex = 0; selectedIndex < catalogs.length; selectedIndex++) {
    const tree = CatalogManagementScreen({
      catalogs, catalogResources: [], installedResources: [], selectedIndex, freshness: {},
      canAdd: true, canRemove: true, canEdit: true, canRefresh: true, canTransfer: true,
      versionLabel: "test", showDetails: false, columns: 120, rows: 40,
    });
    const rendered = childText(tree);
    assert.ok(rendered.includes(catalogs[selectedIndex].name));
    assert.equal((rendered.match(/›/g) || []).length, 1);
  }
});

test("CatalogScreen exposes source license and pin only when provenance exists", async () => {
  const { Text } = await import("ink");
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
  const sourceText = visibleInkText(sourceTree, Text);
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
  const localText = visibleInkText(localTree, Text);
  assert.ok(localText.includes("LICENSE"));
  assert.ok(localText.includes("not declared"));
  assert.ok(!localText.includes("PINNED SOURCE"));
  assert.ok(!localText.some((text) => text.includes("@0123456789abcdef0123456789abcdef01234567")));
});

test("CatalogScreen wraps complete descriptions and pinned sources at narrow widths", async () => {
  const { Text } = await import("ink");
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
    const text = visibleInkText(tree, Text).join("");
    assert.ok(text.replace(/\s/g, "").includes(description.replace(/\s/g, "")));
    assert.ok(text.includes(source));
  }
});

test("InventoryScreen wraps complete locations and descriptions at narrow widths", async () => {
  const { Text } = await import("ink");
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
    const text = visibleInkText(tree, Text).join("");
    assert.ok(text.replace(/\s/g, "").includes(description.replace(/\s/g, "")));
    assert.ok(text.includes(location));
    assert.ok(text.includes("https://github.com/example/long-repository-name"));
    assert.ok(text.replace(/\s/g, "").includes(sourceRef));
  }
});
test("inventory uses wide-screen context while preserving compact layout", async () => {
  const id = "release-assistant-resource-v2";
  const catalog = "platform-team";
  const resource = {
    catalog,
    kind: "skill",
    id,
    scope: "project",
    status: "current",
    source_repository: "example/platform-team",
  };
  const wideFrame = await captureDashboardFrame([resource]);
  const wideRow = wideFrame.split(/\r?\n/).find((line) =>
    line.includes(id) && line.includes(catalog));
  assert.ok(wideRow, "inventory row should show the complete ID and catalog label");
  assert.ok(wideRow.length >= 70, "inventory columns should use most of the list panel width");
  const largeResource = {
    ...resource,
    category: "Release Engineering",
    tags: ["automation", "deployments"],
    use_when: "Prepare production releases.",
    example: "Run release checks.",
    prerequisites: ["Release approval", "Git access"],
  };
  const largeFrame = await captureDashboardFrame(
    [largeResource], {}, [], { columns: 120, rows: 60 },
  );
  const largeLines = largeFrame.split(/\r?\n/);
  assert.ok(largeLines.some((line) =>
    line.includes(id) && line.includes(catalog) && line.length >= 70));
  assert.ok(largeFrame.includes("Release Engineering"));
  assert.ok(largeFrame.includes("USE WHEN"));
  assert.ok(largeFrame.includes("Run release checks."));
  assert.ok(largeFrame.includes("PREREQUISITES"));

  const narrowFrame = await captureDashboardFrame(
    [{ ...resource, id: "short-id" }],
    {},
    [],
    { columns: 56, rows: 56 },
  );
  const narrowLines = narrowFrame.split(/\r?\n/);
  const narrowHeader = narrowLines.find((line) => line.includes("STATUS") && line.includes("SCOPE"));
  assert.ok(narrowHeader);
  assert.equal(narrowHeader.includes("CATALOG"), false);
  assert.ok(narrowLines.some((line) => line.includes("short-id")));
});
test("inventory table fills the available list panel at 80, 120, and 160 columns", async () => {
  const id = "assistant";
  const catalog = "platform-team";
  const resource = {
    id,
    catalog,
    kind: "skill",
    scope: "project",
    status: "current",
    source_repository: "example/platform-team",
  };
  const { tableColumns } = await import("../dist/dashboard/helpers.mjs");
  for (const dimensions of [
    { columns: 80, rows: 56 },
    { columns: 120, rows: 60 },
    { columns: 160, rows: 60 },
  ]) {
    const frame = await captureDashboardFrame([resource], {}, [], dimensions);
    const lines = frame.split(/\r?\n/);
    const panel = separatedPanelFrame(frame, "INVENTORY", true);
    assert.deepEqual(panel.header.map((line) => line.trim()), [
      "RESOURCES 1/1 · 1-1",
      "Filter (F to filter) · Catalog ALL · Kind ALL · License ALL",
    ]);
    assert.match(panel.body[0], /STATUS.*SCOPE.*KIND.*ID.*CATALOG/);
    assert.ok(panel.body.slice(1).some((line) => line.includes(id) && line.includes(catalog)),
      "inventory column labels and data stay below the metadata divider");
    const row = lines.find((line) => line.includes(id) && line.includes(catalog));
    const header = lines.find((line) => line.includes("STATUS") && line.includes("CATALOG"));
    assert.ok(header && row, `inventory row should render at ${dimensions.columns} columns`);
    assert.equal(header.indexOf("CATALOG"), row.indexOf(catalog));
    assert.equal(header.indexOf("STATUS"), row.indexOf("CURRENT"));
    assert.equal(header.indexOf("SCOPE"), row.indexOf("PROJECT"));
    assert.equal(header.indexOf("KIND"), row.indexOf("skill"));
    const listContentWidth = dimensions.columns < 112
      ? dimensions.columns - 6
      : Math.floor((dimensions.columns - 3) * (dimensions.columns >= 132 ? 0.64 : 0.68)) - 4;
    const layout = tableColumns(listContentWidth, id.length, catalog.length);
    const layoutWidth = layout.marker + layout.status + layout.scope + layout.kind +
      layout.id + layout.catalog + 5;
    assert.equal(layoutWidth, listContentWidth);
    assert.ok(row.length >= layoutWidth && row.length <= dimensions.columns);
  }
});
test("catalog browser and connected-catalog tables use available panel width", async () => {
  const dimensions = [
    { columns: 80, rows: 56 },
    { columns: 120, rows: 60 },
    { columns: 160, rows: 60 },
  ];
  const description = "A reusable assistant workflow that prepares consistent release notes from repository changes.";
  const candidate = {
    catalog: "platform-team",
    kind: "skill",
    id: "assistant-helper",
    description,
    source_repository: "example/platform-team",
    source_path: "skills/assistant-helper",
    source_ref: "a".repeat(40),
  };
  const catalogActions = { catalogResources: [candidate] };
  const { catalogTableColumns } = await import("../dist/dashboard/helpers.mjs");
  for (const size of dimensions) {
    const frame = await captureDashboardFrame([], catalogActions, ["a"], size);
    const lines = frame.split(/\r?\n/);
    const panel = separatedPanelFrame(frame, "CATALOG RESOURCES", true);
    assert.deepEqual(panel.header.map((line) => line.trim()), [
      "RESOURCES 1/1 · 1-1",
      "Filter (F to filter) · Catalog ALL · Kind ALL · License ALL",
    ]);
    assert.match(panel.body[0], /INSTALLED.*SOURCE.*KIND.*ID/);
    assert.ok(panel.body.slice(1).some((line) => line.includes(candidate.id) && line.includes(candidate.catalog)),
      "catalog column labels and data stay below the metadata divider");
    const header = lines.find((line) => line.includes("SOURCE") && line.includes("INSTALLED"));
    const row = lines.find((line) => line.includes(candidate.id) && line.includes(candidate.catalog));
    assert.ok(header && row, `catalog table should render at ${size.columns} columns`);
    const installedOffset = header.indexOf("INSTALLED");
    assert.equal(row.slice(installedOffset, installedOffset + "INSTALLED".length).trim(), "no");
    assert.ok(header.indexOf("SOURCE") - installedOffset <= "INSTALLED".length + 3);
    assert.equal(header.indexOf("SOURCE"), row.indexOf(candidate.catalog));
    assert.equal(header.indexOf("KIND"), row.indexOf(candidate.kind));
    assert.ok(header.indexOf("ID") - header.indexOf("KIND") <= candidate.kind.length + 3);
    assert.equal(header.indexOf("ID"), row.indexOf(candidate.id));
    const listContentWidth = size.columns < 112
      ? size.columns - 6
      : Math.floor((size.columns - 3) * 0.68) - 4;
    const layout = catalogTableColumns(
      listContentWidth,
      candidate.catalog.length,
      candidate.id.length,
      candidate.kind.length,
    );
    const layoutWidth = layout.marker + layout.installed + layout.source +
      layout.kind + layout.id + 4;
    assert.equal(layoutWidth, listContentWidth);
    assert.ok(row.length >= layoutWidth && row.length <= size.columns);
  }

  const catalogName = "tooling";
  const repository = "example/tool-catalog";
  const managementActions = {
    userCatalogs: [{ name: catalogName, repository }],
  };
  for (const size of dimensions) {
    const frame = await captureDashboardFrame([], managementActions, ["m"], size);
    const lines = frame.split(/\r?\n/);
    const panel = separatedPanelFrame(frame, "CONNECTED CATALOGS 1");
    assert.deepEqual(panel.header, [], "connected catalogs has no metadata separate from its title count");
    assert.match(panel.body[0], /CATALOG.*REPOSITORY.*RESOURCES.*INSTALLED.*FRESHNESS/);
    assert.ok(panel.body.slice(1).some((line) => line.includes(catalogName) && line.includes(repository)),
      "connected catalog column labels and data remain below the title divider");
    const header = lines.find((line) => line.includes("REPOSITORY") && line.includes("FRESHNESS"));
    const row = lines.find((line) => line.includes(catalogName) && line.includes(repository));
    assert.ok(header && row, `catalog management table should render at ${size.columns} columns`);
    assert.equal(header.indexOf("CATALOG"), row.indexOf(catalogName));
    assert.equal(header.indexOf("REPOSITORY"), row.indexOf(repository));
    assert.equal(row.slice(header.indexOf("RESOURCES"), header.indexOf("RESOURCES") + "RESOURCES".length).trim(), "0");
    assert.equal(row.slice(header.indexOf("INSTALLED"), header.indexOf("INSTALLED") + "INSTALLED".length).trim(), "0");
    assert.ok(header.indexOf("INSTALLED") - header.indexOf("RESOURCES") <= "RESOURCES".length + 3);
    assert.ok(header.indexOf("FRESHNESS") - header.indexOf("INSTALLED") <= "INSTALLED".length + 3);
    assert.equal(row.slice(header.indexOf("FRESHNESS"), header.indexOf("FRESHNESS") + "FRESHNESS".length).trim(), "UNKNOWN");
    const listContentWidth = size.columns < 112
      ? size.columns - 6
      : Math.floor((size.columns - 3) * 0.68) - 4;
    const tableStart = header.indexOf("CATALOG") - 3; // Two marker cells and one separator.
    const freshnessOffset = header.indexOf("FRESHNESS") - tableStart;
    assert.ok(freshnessOffset + "FRESHNESS".length >= Math.floor(listContentWidth * 0.8));
    assert.ok(freshnessOffset + "FRESHNESS".length <= listContentWidth);
    if (size.columns >= 112) {
      assert.ok(frame.split(repository).length - 1 >= 2, "details remain in a separate right-hand panel");
    }
  }
  const compact = await captureDashboardFrame([], catalogActions, ["a"], { columns: 56, rows: 56 });
  const compactHeader = compact.split(/\r?\n/).find((line) =>
    line.includes("SOURCE") && line.includes("ID"));
  assert.ok(compactHeader);
});

test("catalog tables make long names readable as the viewport grows", async () => {
  const source = "platform-engineering-team";
  const id = "deployment-automation-assistant";
  const repository = "github.com/platform-engineering/automation-catalog";
  const candidate = {
    catalog: source, kind: "instruction", id, source_repository: "example/platform",
    source_path: "instructions/deploy.md", source_ref: "a".repeat(40),
  };
  const managementActions = { userCatalogs: [{ name: source, repository }] };
  const narrowBrowser = await captureDashboardFrame([], { catalogResources: [candidate] }, ["a"], { columns: 56, rows: 56 });
  const narrowHeader = narrowBrowser.split(/\r?\n/).find((line) => line.includes("INST") && line.includes("SOURCE"));
  assert.ok(narrowHeader);
  assert.ok(narrowHeader.indexOf("SOURCE") - narrowHeader.indexOf("INST") <= 7);

  for (const columns of [80, 120, 160]) {
    const size = { columns, rows: 60 };
    const keys = columns === 160 ? ["a", "d"] : ["a"];
    const browser = await captureDashboardFrame([], { catalogResources: [candidate] }, keys, size);
    const browserRow = browser.split(/\r?\n/).find((line) => line.includes("instruction") && line.includes("platform"));
    assert.ok(browserRow, `browser row should be visible at ${columns}`);
    const management = await captureDashboardFrame([], managementActions, columns === 160 ? ["m", "d"] : ["m"], size);
    assert.ok(management.split(/\r?\n/).some((line) =>
      line.includes("RESOURCES") && line.includes("INSTALLED") && line.includes("FRESHNESS")),
      `management headers should remain readable at ${columns}`);
    const managementRow = management.split(/\r?\n/).find((line) => line.includes("platform") && line.includes("github"));
    assert.ok(managementRow, `management row should be visible at ${columns}`);
    if (columns === 160) {
      assert.ok(browserRow.includes(source) && browserRow.includes(id));
      assert.ok(managementRow.includes(source) && managementRow.includes(repository));
    } else {
      assert.ok(browserRow.includes("..."), "long browser values truncate in the narrow viewport");
      assert.ok(managementRow.includes("..."), "long repository or name truncates in the narrow viewport");
    }
  }
});

test("dashboard tables expand their columns when details are hidden", async () => {
  const size = { columns: 160, rows: 60 };
  const resource = {
    catalog: "platform-team", kind: "skill", id: "assistant-helper",
    scope: "project", status: "current", source_repository: "example/platform-team",
    source_path: "skills/assistant-helper", source_ref: "a".repeat(40),
  };
  const cases = [
    { resources: [resource], actions: {}, keys: [], label: "CATALOG" },
    { resources: [], actions: { catalogResources: [resource] }, keys: ["a"], label: "ID" },
    { resources: [], actions: { userCatalogs: [{ name: "tooling", repository: "example/tool-catalog" }] }, keys: ["m"], label: "FRESHNESS" },
  ];
  for (const entry of cases) {
    const withDetails = await captureDashboardFrame(entry.resources, entry.actions, entry.keys, size);
    const withoutDetails = await captureDashboardFrame(entry.resources, entry.actions, [...entry.keys, "d"], size);
    const header = (frame) => frame.split(/\r?\n/).find((line) =>
      line.includes(entry.label) && (line.includes("STATUS") || line.includes("INSTALLED")));
    const splitHeader = header(withDetails);
    const fullHeader = header(withoutDetails);
    assert.ok(splitHeader && fullHeader, `${entry.label} header should render in both modes`);
    assert.ok(fullHeader.indexOf(entry.label) > splitHeader.indexOf(entry.label),
      `${entry.label} should move right as the list expands`);
  }
});
test("source-version picker adapts SHA, date, and subject columns at 80 and 120 columns", async () => {
  const resource = {
    catalog: "platform-team",
    kind: "skill",
    id: "assistant-helper",
    scope: "project",
    status: "current",
    source_repository: "example/platform-team",
    source_path: "skills/assistant-helper",
    source_ref: "a".repeat(40),
  };
  const versions = [
    { sha: "a".repeat(40), prefix: "abcdef0", date: "2025-04-03T12:13:14Z", subject: "Add TUI table sizing" },
    { sha: "b".repeat(40), prefix: "fedcba987", date: "2025-04-04T12:13:14Z", subject: "Fix adaptive columns in terminal frames" },
  ];
  for (const dimensions of [
    { columns: 80, rows: 56 },
    { columns: 120, rows: 60 },
  ]) {
    const frame = await captureDashboardFrame([resource], {
      listSourceVersions: () => versions,
    }, ["v"], dimensions, ["\u001b"]);
    const lines = frame.split(/\r?\n/);
    const revisions = separatedPanelFrame(frame, "RESOURCE REVISIONS", true);
    const shortcuts = separatedPanelFrame(frame, "SHORTCUTS");
    assert.deepEqual(revisions.header.map((line) => line.trim()), [
      "platform-team / skill:assistant-helper",
      "Select a commit to update; the catalog pin remains unchanged.",
    ]);
    assert.equal(revisions.body[0].trim(), "", "the existing gap stays in the revision body");
    assert.equal(revisions.body.length, versions.length + 1, "moving metadata preserves both revision rows and the body gap");
    assert.equal(revisions.topIndex, Math.floor((dimensions.rows - 18) / 2),
      "category headings count in the complete modal height");
    assert.equal(shortcuts.topIndex, revisions.bottomIndex + 2, "modal frames have one gap row");
    assert.deepEqual(shortcuts.body.map((line) => line.trim()), [
      "Actions",
      "ENTER UPDATE",
      "Navigation",
      "↑↓ SELECT · ESC BACK",
    ]);
    assert.ok(revisions.body.some((line) => line.startsWith(`› ${versions[0].prefix}`)),
      "the selected revision marker remains visible");
    const first = lines.find((line) => line.includes(versions[0].prefix) && line.includes(versions[0].subject));
    const second = lines.find((line) => line.includes(versions[1].prefix) && line.includes(versions[1].subject));
    assert.ok(first && second, `revision rows should render at ${dimensions.columns} columns`);
    assert.equal(first.indexOf("2025-04-03"), second.indexOf("2025-04-04"));
    assert.equal(first.indexOf(versions[0].subject), second.indexOf(versions[1].subject));
    assert.ok(first.length <= dimensions.columns);
  }
});

test("revision viewport keeps the selected commit and separated shortcuts bounded on narrow short terminals", async () => {
  const resource = {
    catalog: "platform-team",
    kind: "skill",
    id: "assistant-helper",
    scope: "project",
    status: "current",
    source_repository: "example/platform-team",
    source_path: "skills/assistant-helper",
    source_ref: "a".repeat(40),
  };
  const versions = Array.from({ length: 18 }, (_, index) => ({
    sha: index.toString(16).padStart(40, "0"),
    prefix: index.toString(16).padStart(7, "0"),
    date: "2025-04-03T12:13:14Z",
    subject: `Revision ${index + 1} with a complete subject`,
  }));
  for (const dimensions of [
    { columns: 40, rows: 16 },
    { columns: 80, rows: 18 },
  ]) {
    const selectedIndex = 9;
    const frame = await captureDashboardFrame([resource], {
      listSourceVersions: () => versions,
    }, ["v", ...Array(selectedIndex).fill("\u001b[B")], dimensions, ["\u001b"]);
    const lines = frame.split(/\r?\n/);
    const revisions = separatedPanelFrame(frame, "RESOURCE REVISIONS", true);
    const shortcuts = separatedPanelFrame(frame, "SHORTCUTS");
    assert.equal(lines.length, dimensions.rows, "the overlay stays inside the terminal height");
    assert.equal(revisions.topIndex, 0, "the unchanged revision viewport uses the full short-terminal height");
    assert.ok(shortcuts.bottomIndex < dimensions.rows, "the complete shortcut frame stays visible");
    assert.equal(shortcuts.topIndex, revisions.bottomIndex + 2);
    assert.ok(revisions.body.some((line) => line.startsWith(`› ${versions[selectedIndex].prefix}`)),
      `selection stays in the revision viewport at ${dimensions.columns}x${dimensions.rows}`);
    assert.ok(revisions.header.map((line) => line.trim()).join(" ")
      .includes("platform-team / skill:assistant-helper"));
    assert.equal(revisions.header.length, dimensions.columns === 40 ? 2 : 1,
      "short layouts keep the resource label visible without optional metadata");
    assert.doesNotMatch(revisions.body.join("\n"), /Showing|Select a commit|platform-team/);
    const revisionRows = revisions.body.filter((line) => /^\s*(?:› )?[0-9a-f]{7}(?:\s|$)/.test(line));
    assert.equal(revisionRows.length, dimensions.columns === 40 ? 1 : 3,
      "metadata relocation preserves the selected revision viewport count");
    assert.equal(revisions.body.length, revisionRows.length + (dimensions.columns === 40 ? 0 : 1),
      "only the existing optional gap remains alongside commit rows below the divider");
    for (const hint of ["↑↓ SELECT", "ENTER UPDATE", "ESC BACK"]) {
      assert.ok(shortcuts.body.join(" ").includes(hint), `the complete ${hint} hint stays visible`);
    }
    for (const panel of [revisions, shortcuts]) {
      assert.ok(panel.right < dimensions.columns);
      for (const line of lines.slice(panel.topIndex, panel.bottomIndex + 1)) {
        assert.equal(line[panel.left], line === lines[panel.topIndex] ? "┌"
          : line === lines[panel.bottomIndex] ? "└" : "│");
        assert.ok(line.length <= dimensions.columns);
      }
    }
  }
});
test("CLI catalog and installed-resource tables adapt to terminal width without truncating piped output", async () => {
  const {
    formatCatalogTable,
    renderInstalledResources,
    selectCatalogResource,
  } = require("../dist/dashboard/terminal.js");
  const description = "A complete description retained for piped terminal output.";
  const resources = [
    {
      catalog: "platform-team",
      kind: "skill",
      id: "assistant-helper",
      status: "stable",
      scope: "project",
      description,
      source_repository: "example/platform-team",
    },
    {
      catalog: "personal-tools",
      kind: "skill",
      id: "assistant-helper",
      status: "stable",
      scope: "project",
      description,
      source_repository: "example/personal-tools",
    },
  ];
  for (const columns of [80, 120]) {
    const terminal = { isTTY: true, columns };
    const catalogLines = formatCatalogTable(resources, terminal).split("\n")
      .map((line) => line.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, ""));
    const catalogHeader = catalogLines[0];
    const catalogRow = catalogLines[1];
    assert.equal(catalogRow.slice(0, catalogHeader.indexOf("KIND")).trim(), resources[0].catalog);
    assert.equal(catalogHeader.indexOf("CATALOG"), catalogRow.indexOf(resources[0].catalog));
    assert.equal(catalogHeader.indexOf("KIND"), catalogRow.indexOf(resources[0].kind));
    assert.equal(catalogHeader.indexOf("ID"), catalogRow.indexOf(resources[0].id));
    assert.equal(catalogHeader.indexOf("STATUS"), catalogRow.indexOf(resources[0].status));
    assert.ok(catalogRow.length <= columns);
    assert.equal(catalogHeader.indexOf("DESCRIPTION"), catalogRow.indexOf(description.slice(0, 12)));

    const installed = renderInstalledResources(resources, terminal).split("\n")
      .map((line) => line.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, ""));
    assert.equal(installed[1].slice(
      installed[0].indexOf("CATALOG"), installed[0].indexOf("KIND") - 1,
    ).trim(), resources[0].catalog);
    assert.equal(installed[0].indexOf("CATALOG"), installed[1].indexOf(resources[0].catalog));
    assert.equal(installed[0].indexOf("ID"), installed[1].indexOf(resources[0].id));
    assert.equal(installed[0].indexOf("SCOPE"), installed[1].indexOf(resources[0].scope));
    assert.equal(installed[0].indexOf("KIND"), installed[1].indexOf(resources[0].kind));
    assert.equal(installed[0].indexOf("STATUS"), installed[1].indexOf(resources[0].status));
    assert.equal(installed[0].indexOf("DESCRIPTION"), installed[1].indexOf(description.slice(0, 12)));
    assert.ok(installed[1].length <= columns);
  }

  const nonInteractive = { isTTY: false };
  assert.ok(formatCatalogTable(resources.slice(0, 1), nonInteractive).includes(description));
  assert.ok(renderInstalledResources(resources.slice(0, 1), nonInteractive).includes(description));

  const { PassThrough } = require("node:stream");
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.isRaw = false;
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 120;
  output.rows = 30;
  let frame = "";
  output.on("data", (chunk) => { frame += chunk.toString(); });
  const selected = selectCatalogResource(resources, input, output);
  input.emit("keypress", "\r", { name: "return" });
  assert.equal(await selected, resources[0]);
  const plain = frame.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  const [header, row] = plain.split(/\r?\n/).filter((line) => line.includes("CATALOG") || line.includes(resources[0].catalog));
  assert.ok(header && row);
  assert.equal(header.indexOf("CATALOG"), row.indexOf(resources[0].catalog));
  assert.equal(header.indexOf("KIND"), row.indexOf(resources[0].kind));
  assert.equal(header.indexOf("ID"), row.indexOf(resources[0].id));
  assert.equal(header.indexOf("STATUS"), row.indexOf(resources[0].status));
  assert.equal(header.indexOf("DESCRIPTION"), row.indexOf(description.slice(0, 12)));
  input.destroy();
  output.destroy();
});
test("narrow inventory terminal links wrapped URL fragments to the complete location", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 40;
  output.rows = 80;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const url = "https://github.com/grasdouble/AI-Kit";
  const done = runDashboard([{
    catalog: "AI-Kit",
    kind: "skill",
    id: "demo",
    scope: "project",
    status: "current",
    managed: true,
    source_repository: "grasdouble/AI-Kit",
    description: "Demo resource.",
  }], input, output);
  await new Promise((resolve) => setTimeout(resolve, 120));
  input.write("q");
  assert.equal(await done, true);
  input.destroy();
  output.destroy();

  const anchors = [...rendered.matchAll(/\u001b\]8;;([^\u001b]*)\u001b\\([^\u001b]*)\u001b\]8;;\u001b\\/g)];
  const locationAnchors = anchors.filter(([, href]) => href === url);
  assert.ok(locationAnchors.length > 1, "the narrow location URL wraps into hyperlink fragments");
  assert.ok(locationAnchors.every(([, href]) => href === url), "every fragment targets the complete URL");
  assert.ok(locationAnchors.map(([, , text]) => text).join("").includes(url),
    "the linked visible fragments retain the complete URL");
  assert.ok(locationAnchors.some(([, , text]) => text === "AI-Kit"),
    "URL wrapping preserves the complete final repository segment");
});
test("inventory detail keeps update paths complete within narrow and short layouts", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const path = ".agents/skills/engineering/a-resource-with-a-deliberately-long-name/SKILL.md";
  const issue = `Update available: ${path}`;
  for (const { columns, rows } of [{ columns: 40, rows: 36 }, { columns: 100, rows: 56 }]) {
    const input = new PassThrough();
    input.isTTY = true;
    input.setRawMode = () => {};
    input.ref = () => {};
    input.unref = () => {};
    const output = new PassThrough();
    output.isTTY = true;
    output.columns = columns;
    output.rows = rows;
    let rendered = "";
    output.on("data", (chunk) => { rendered += chunk.toString(); });
    const done = runDashboard([{
      catalog: "engineering",
      kind: "skill",
      id: "long-update",
      scope: "project",
      status: "attention",
      issues: [{ code: "UPDATE_AVAILABLE", paths: [path] }],
    }], input, output);
    await new Promise((resolve) => setTimeout(resolve, 120));
    input.write("q");
    assert.equal(await done, true);
    input.destroy();
    output.destroy();

    const frameStart = rendered.lastIndexOf("\u001b[?2026h");
    assert.notEqual(frameStart, -1, "Ink should emit a complete synchronized terminal frame");
    const frameEnd = rendered.indexOf("\u001b[?2026l", frameStart);
    assert.notEqual(frameEnd, -1, "the synchronized terminal frame should be closed");
    const frame = rendered.slice(frameStart, frameEnd)
      .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(/\u001b\]8;;[^\u001b]*(?:\u0007|\u001b\\)/g, "");
    const frameLines = frame.split(/\r?\n/);
    assert.equal(frameLines.length, rows, `the rendered frame should occupy ${rows} rows`);
    assert.ok(frameLines[rows - 1].includes("└"),
      `the final rendered row should remain occupied by the shortcut-panel border at ${columns}x${rows}: ${JSON.stringify(frameLines[rows - 1])}`);
    assert.ok(frame.includes("SHORTCUTS"), "the compact layout retains its framed shortcut panel");
    const updateText = frame.replace(/[│\s]/g, "");
    assert.ok(updateText.includes(issue.replace(/\s/g, "")),
      `complete update path should remain available at ${columns}x${rows}`);
    if (columns === 40) assert.ok(frame.includes("SUMMARY"), "short layouts retain a compact summary panel");
  }
});

test("update confirmation distinguishes GH-backed skills and other resources", async () => {
  const { confirmationModal } = await import("../dist/dashboard/modals.mjs");
  const base = {
    catalog: "Test", id: "update-me", scope: "user", status: "update", managed: true,
    source_repository: "example/repo",
  };
  const confirmationText = (resource) => confirmationModal({
    confirmation: { action: "update", resource },
    selectedButton: 1,
    stage: 1,
    columns: 120,
  }).lines.map(({ bodyText, text }) => bodyText || text).join(" ");
  const ghText = confirmationText({ ...base, kind: "skill" });
  assert.ok(ghText.includes("first gh skill install runs without --force"));
  assert.ok(ghText.includes("If GH says overwrite requires --force, Kitia asks before retrying"));
  const ghRetryText = confirmationModal({
    confirmation: {
      action: "update",
      resource: { ...base, kind: "skill" },
      forceRetry: true,
      ghForceRetry: true,
      ghForceAgent: "github-copilot",
      conflict: {
        category: "github-force-required",
        paths: [],
        message: "GitHub CLI says the skill already exists and requires --force.",
      },
    },
    selectedButton: 0,
    stage: 1,
    columns: 120,
  }).lines.map(({ bodyText, text }) => bodyText || text).join(" ");
  assert.ok(ghRetryText.includes("GH REQUESTS OVERWRITE"));
  assert.ok(ghRetryText.includes("requires --force"));
  assert.ok(ghRetryText.includes("for github-copilot"));
  assert.ok(ghRetryText.includes("Kitia's local-modification and untracked-content checks still apply"));
  assert.ok(ghRetryText.includes("NO / CANCEL"));
  assert.ok(ghRetryText.includes("YES, RETRY WITH --FORCE"));
  const agentText = confirmationText({ ...base, kind: "agent" });
  assert.ok(agentText.includes("does not use gh --force"));
  assert.ok(!agentText.includes("gh skill install --force"));
});

test("managed inventory U confirms an update and renders the successful result", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const resource = {
    catalog: "Test",
    kind: "skill",
    id: "update-me",
    scope: "project",
    status: "attention",
    managed: true,
    issues: [{ code: "UPDATE_AVAILABLE", paths: [".agents/skills/update-me/SKILL.md"] }],
    source_repository: "example/repo",
    source_path: "skills/update-me/SKILL.md",
    source_ref: "a".repeat(40),
    description: "A managed resource with an available update.",
  };
  const updatedResource = { ...resource, status: "current", issues: [] };
  const executions = [];
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 120;
  output.rows = 56;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const done = runDashboard([resource], input, output, [], {
    showOnboarding: false,
    execute: async (...args) => {
      executions.push(args);
      return {
        code: 0,
        messages: ["Update complete"],
        resources: [updatedResource],
        errors: [],
      };
    },
  });
  let finished = false;
  const latestFrame = () => {
    const start = rendered.lastIndexOf("\u001b[?2026h");
    const end = rendered.indexOf("\u001b[?2026l", start);
    return start >= 0 && end > start
      ? rendered.slice(start, end)
        .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
        .replace(/\u001b\]8;;[^\u001b]*(?:\u0007|\u001b\\)/g, "")
      : "";
  };
  const waitForFrame = async (predicate, description) => {
    const deadline = Date.now() + 5_000;
    while (!predicate(latestFrame())) {
      if (Date.now() >= deadline) throw new Error(`Dashboard did not render ${description}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return latestFrame();
  };

  try {
    await waitForFrame((frame) => frame.includes("SHORTCUTS"), "the Inventory screen");
    input.write("u");
    const confirmation = await waitForFrame((frame) => frame.includes("CONFIRM UPDATE"),
      "the update confirmation");
    const confirmationText = confirmation.replace(/[│]/g, " ").replace(/\s+/g, " ");
    assert.ok(confirmationText.includes("first gh skill install runs without --force"));
    assert.ok(confirmationText.includes("Kitia asks before retrying"));
    assert.ok(confirmationText.includes("local safety checks apply"));
    assert.ok(confirmation.includes("Y/N SHORTCUTS"));
    assert.equal(executions.length, 0, "U must request confirmation, not execute immediately");

    input.write("y");
    const completed = await waitForFrame((frame) =>
      frame.includes("Update complete") && frame.includes("CURRENT"), "the successful update result");
    assert.equal(executions.length, 1);
    assert.equal(executions[0][0], "update");
    assert.deepEqual(executions[0][1], resource);
    assert.deepEqual(executions[0][2], { scope: undefined, tool: undefined });
    assert.ok(completed.includes("Update complete"));
    assert.ok(completed.includes("CURRENT"), "the returned refreshed resource replaces its old status");
    input.write("q");
    assert.equal(await done, true);
    finished = true;
  } finally {
    if (!finished) {
      input.write("\x1b");
      await new Promise((resolve) => setTimeout(resolve, 20));
      input.write("q");
    }
    await done;
    input.destroy();
    output.destroy();
  }
});

test("managed inventory U selects Update and Enter executes the confirmed action", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const resource = {
    catalog: "Test",
    kind: "skill",
    id: "enter-update",
    scope: "project",
    status: "attention",
    managed: true,
    issues: [{ code: "UPDATE_AVAILABLE", paths: [".agents/skills/enter-update/SKILL.md"] }],
  };
  const updatedResource = { ...resource, status: "current", issues: [] };
  const executions = [];
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 120;
  output.rows = 56;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const done = runDashboard([resource], input, output, [], {
    showOnboarding: false,
    execute: async (...args) => {
      executions.push(args);
      return {
        code: 0,
        messages: ["Update complete"],
        resources: [updatedResource],
        errors: [],
      };
    },
  });
  let finished = false;
  const latestFrame = () => {
    const start = rendered.lastIndexOf("\u001b[?2026h");
    const end = rendered.indexOf("\u001b[?2026l", start);
    return start >= 0 && end > start
      ? rendered.slice(start, end)
        .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
        .replace(/\u001b\]8;;[^\u001b]*(?:\u0007|\u001b\\)/g, "")
      : "";
  };
  const waitForFrame = async (predicate, description) => {
    const deadline = Date.now() + 5_000;
    while (!predicate(latestFrame())) {
      if (Date.now() >= deadline) throw new Error(`Dashboard did not render ${description}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return latestFrame();
  };

  try {
    await waitForFrame((frame) => frame.includes("SHORTCUTS"), "the Inventory screen");
    input.write("u");
    const confirmation = await waitForFrame((frame) => frame.includes("CONFIRM UPDATE"),
      "the update confirmation");
    assert.ok(confirmation.includes("‹ UPDATE ›"), "Update is selected by default");
    assert.equal(executions.length, 0, "U must not execute before confirmation");

    input.write("\r");
    const completed = await waitForFrame((frame) =>
      frame.includes("Update complete") && frame.includes("CURRENT"), "the successful update result");
    assert.equal(executions.length, 1);
    assert.equal(executions[0][0], "update");
    assert.deepEqual(executions[0][1], resource);
    assert.deepEqual(executions[0][2], { scope: undefined, tool: undefined });
    assert.ok(completed.includes("Update complete"));
    assert.ok(completed.includes("CURRENT"), "the refreshed resource replaces its old status");
    input.write("q");
    assert.equal(await done, true);
    finished = true;
  } finally {
    if (!finished) {
      input.write("\x1b");
      await new Promise((resolve) => setTimeout(resolve, 20));
      input.write("q");
    }
    await done;
    input.destroy();
    output.destroy();
  }
});

test("local conflicts and GH force-required updates require explicit retry consent", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const resource = {
    catalog: "Test", kind: "skill", id: "conflicted-skill",
    scope: "project", status: "update", managed: true,
  };

  for (const category of [
    "tracked-modification", "untracked-skill-content", "github-force-required",
    "github-next-agent", "github-repeated-agent",
  ]) {
    const ghForceRequired = category.startsWith("github-");
    const responses = ghForceRequired ? ["no", "escape", "yes"] : ["no", "yes"];
    for (const response of responses) {
      const accept = response === "yes";
      const input = new PassThrough();
      input.isTTY = true;
      input.setRawMode = () => {};
      input.ref = () => {};
      input.unref = () => {};
      const output = new PassThrough();
      output.isTTY = true;
      output.columns = 100;
      output.rows = 48;
      let rendered = "";
      output.on("data", (chunk) => { rendered += chunk.toString(); });
      const calls = [];
      const done = runDashboard([resource], input, output, [], {
        showOnboarding: false,
        execute: async (...args) => {
          calls.push(args);
          if (calls.length === 1 && ghForceRequired) {
            const error = new Error("raw GH overwrite diagnostic");
            error.code = "GH_FORCE_REQUIRED";
            error.category = "github-force-required";
            error.paths = [];
            error.recoverable = true;
            error.agent = "github-copilot";
            error.userMessage = "GitHub CLI says this skill is already installed and requires --force.";
            error.technicalDetail = "raw secret diagnostic: token=secret-value";
            throw error;
          }
          if (calls.length === 1) {
            const error = new Error("local conflict");
            error.code = "LOCAL_CONFLICT";
            error.category = category;
            error.paths = [category === "tracked-modification"
              ? ".agents/skills/conflicted-skill/SKILL.md"
              : ".agents/skills/conflicted-skill/local-note.txt"];
            error.recoverable = true;
            throw error;
          }
          if (calls.length === 2 && category === "github-next-agent") {
            const error = new Error("raw GH overwrite diagnostic for another agent");
            error.code = "GH_FORCE_REQUIRED";
            error.category = "github-force-required";
            error.paths = [];
            error.recoverable = true;
            error.agent = "claude-code";
            error.userMessage = "GitHub CLI says this skill is already installed and requires --force for claude-code.";
            throw error;
          }
          if (calls.length === 2 && category === "github-repeated-agent") {
            const error = new Error("raw GH overwrite diagnostic repeated");
            error.code = "GH_FORCE_REQUIRED";
            error.category = "github-force-required";
            error.paths = [];
            error.recoverable = true;
            error.agent = "github-copilot";
            error.userMessage = "GitHub CLI says this skill is already installed and requires --force.";
            throw error;
          }
          return { code: 0, messages: ["Update complete"], resources: [resource], errors: [] };
        },
      });
      const latestFrame = () => {
        const start = rendered.lastIndexOf("\u001b[?2026h");
        const end = rendered.indexOf("\u001b[?2026l", start);
        return start >= 0 && end > start
          ? rendered.slice(start, end)
            .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
            .replace(/\u001b\]8;;[^\u001b]*(?:\u0007|\u001b\\)/g, "")
          : "";
      };
      const waitForFrame = async (predicate, label) => {
        const deadline = Date.now() + 5_000;
        while (!predicate(latestFrame())) {
          if (Date.now() >= deadline) throw new Error(`Dashboard did not render ${label}`);
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return latestFrame();
      };

      try {
        await waitForFrame((frame) => frame.includes("SHORTCUTS"), "inventory");
        input.write("u");
        await waitForFrame((frame) => frame.includes("CONFIRM UPDATE"), "update confirmation");
        input.write("\r");
        const promptTitle = ghForceRequired ? "GH REQUESTS OVERWRITE" : "LOCAL CONFLICT";
        const conflict = await waitForFrame((frame) => frame.includes(promptTitle), "force confirmation");
        const promptText = conflict.replace(/[│─]/g, " ").replace(/\s+/g, " ");
        assert.ok(conflict.includes("conflicted-skill"));
        assert.ok(conflict.includes("catalog Test"));
        assert.ok(conflict.includes("scope project"));
        if (ghForceRequired) {
          assert.ok(promptText.includes("already installed and requires --force"));
          assert.ok(promptText.includes("github-copilot"), `missing retry target in modal: ${promptText}`);
          assert.ok(promptText.includes("local-modification and untracked-content checks still apply"));
          assert.ok(!promptText.includes("secret-value"));
        } else {
          assert.ok(conflict.includes(category === "tracked-modification"
            ? ".agents/skills/conflicted-skill/SKILL.md"
            : ".agents/skills/conflicted-skill/local-note.txt"));
        }
        assert.ok(conflict.includes("YES, RETRY WITH --FORCE"));
        assert.equal(calls.length, 1, "the first update attempt has no retry flag");
        assert.deepEqual(calls[0][2], { scope: undefined, tool: undefined });

        if (accept) {
          input.write("\x1b[C");
          await waitForFrame((frame) => frame.includes("‹ YES, RETRY WITH --FORCE ›"), "force selection");
          input.write("\r");
          if (category === "github-next-agent") {
            const nextPrompt = await waitForFrame(
              (frame) => {
                const text = frame.replace(/[│]/g, " ").replace(/\s+/g, " ");
                return text.includes("GH REQUESTS OVERWRITE") && text.includes("for claude-code");
              },
              "second agent force confirmation",
            );
            const nextPromptText = nextPrompt.replace(/[│]/g, " ").replace(/\s+/g, " ");
            assert.ok(nextPromptText.includes("already installed and requires --force"));
            assert.equal(calls.length, 2);
            assert.deepEqual(calls[1][2], {
              scope: undefined, tool: undefined, ghForce: true, ghForceAgent: "github-copilot",
            });
            input.write("\x1b[C");
            await waitForFrame((frame) => frame.includes("‹ YES, RETRY WITH --FORCE ›"), "second agent force selection");
            input.write("\r");
            await waitForFrame((frame) => frame.includes("Update complete"), "second agent forced update");
            assert.equal(calls.length, 3);
            assert.deepEqual(calls[2][2], {
              scope: undefined, tool: undefined, ghForce: true, ghForceAgent: "claude-code",
            });
            input.write("q");
            assert.equal(await done, true);
          } else if (category === "github-repeated-agent") {
            const failure = await waitForFrame((frame) => frame.includes("UPDATE FAILED"), "same-agent retry failure");
            assert.ok(!failure.includes("GH REQUESTS OVERWRITE"), "the same agent must not get an endless force prompt");
            assert.equal(calls.length, 2);
            input.write("\x1b");
            await waitForFrame((frame) => !frame.includes("UPDATE FAILED"), "dismissed same-agent failure");
            input.write("q");
            assert.equal(await done, false);
          } else {
            await waitForFrame((frame) => frame.includes("Update complete"), "forced update result");
            assert.equal(calls.length, 2);
            assert.deepEqual(calls[1][2], ghForceRequired
              ? { scope: undefined, tool: undefined, ghForce: true, ghForceAgent: "github-copilot" }
              : { scope: undefined, tool: undefined, force: true });
            input.write("q");
            assert.equal(await done, true);
          }
        } else {
          input.write(response === "escape" ? "\x1b" : "\r");
          await waitForFrame((frame) => !frame.includes(promptTitle), "cancelled force prompt");
          assert.equal(calls.length, 1, "declining must not retry");
          input.write("q");
          assert.equal(await done, false);
        }
      } finally {
        input.write("\x1b");
        await new Promise((resolve) => setTimeout(resolve, 20));
        input.write("q");
        await Promise.race([
          done.catch(() => {}),
          new Promise((resolve) => setTimeout(resolve, 100)),
        ]);
        input.destroy();
        output.destroy();
      }
    }
  }
});


test("failed managed updates show an actionable error modal in compact and normal layouts", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const resource = {
    catalog: "AI-Kit",
    kind: "skill",
    id: "conventional-commits",
    scope: "project",
    status: "update",
    managed: true,
  };
  const actualError = "Could not update AI-Kit catalog skill conventional-commits for github-copilot: gh exited with status 1. GitHub reports an API rate limit; wait for the limit to reset, then retry. No agents were confirmed updated before this failure.";

  for (const rows of [36, 56]) {
    const input = new PassThrough();
    input.isTTY = true;
    input.setRawMode = () => {};
    input.ref = () => {};
    input.unref = () => {};
    const output = new PassThrough();
    output.isTTY = true;
    output.columns = 80;
    output.rows = rows;
    let rendered = "";
    output.on("data", (chunk) => { rendered += chunk.toString(); });
    let executions = 0;
    const done = runDashboard([resource], input, output, [], {
      execute: async () => {
        executions += 1;
        if (rows === 36) {
          const error = new Error(`${actualError} gh diagnostic: GitHub API rate limit exceeded; ghp_secret_token_value`);
          error.userMessage = actualError;
          error.technicalDetail = "GitHub API rate limit exceeded; ghp_secret_token_value";
          throw error;
        }
        return {
          code: 1,
          messages: ["GitHub API rate limit exceeded; ghp_secret_token_value"],
          failure: { code: "GH_UPDATE_FAILED", userMessage: actualError },
          resources: [resource],
          errors: [],
        };
      },
    });
    const latestFrame = () => {
      const start = rendered.lastIndexOf("\u001b[?2026h");
      const end = rendered.indexOf("\u001b[?2026l", start);
      return start >= 0 && end > start
        ? rendered.slice(start, end)
          .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
          .replace(/\u001b\]8;;[^\u001b]*(?:\u0007|\u001b\\)/g, "")
        : "";
    };
    const waitForFrame = async (predicate, description) => {
      const deadline = Date.now() + 5_000;
      while (!predicate(latestFrame())) {
        if (Date.now() >= deadline) throw new Error(`Dashboard did not render ${description}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return latestFrame();
    };
    const waitForDone = async () => {
      let timer;
      try {
        return await Promise.race([
          done,
          new Promise((resolve) => { timer = setTimeout(() => resolve(null), 1_000); }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };

    try {
      await waitForFrame((frame) => frame.includes("SHORTCUTS"), "the Inventory screen");
      input.write("u");
      await waitForFrame((frame) => frame.includes("CONFIRM UPDATE"), "the update confirmation");
      input.write("y");
      const failed = await waitForFrame((frame) => frame.includes("UPDATE FAILED"),
        "the failed update modal");
      const normalized = failed.replace(/[│]/g, "").replace(/\s+/g, " ");
      assert.ok(normalized.includes(actualError), `the modal must show the safe actionable error:\n${failed}`);
      assert.doesNotMatch(failed, /gh diagnostic|ghp_secret_token_value|GitHub API rate limit exceeded;/);
      assert.ok(failed.includes("SHORTCUTS"));
      assert.equal(executions, 1);

      input.write("\x1b");
      const dismissed = await waitForFrame((frame) =>
        !frame.includes("UPDATE FAILED") && frame.includes("Action failed"),
      "the dashboard after dismissing the error");
      assert.ok(dismissed.includes("Action failed"));
      input.write("q");
      assert.equal(await waitForDone(), false, "a failed CLI status must remain nonzero after dismissal");
    } finally {
      if (executions) {
        input.write("\x1b");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      input.write("\x03");
      await waitForDone();
      input.destroy();
      output.destroy();
    }
  }
});


test("side-by-side inventory keeps list viewport stable across detail lengths", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const resources = [
    { catalog: "sample", kind: "skill", id: "short-detail", scope: "project", status: "current", description: "Short." },
    {
      catalog: "sample",
      kind: "skill",
      id: "long-detail",
      scope: "project",
      status: "update",
      issues: [{ code: "UPDATE_AVAILABLE", paths: [".agents/skills/example/SKILL.md"] }],
      description: "Long description for the selected resource. ".repeat(5),
    },
    ...["third", "fourth", "fifth"].map((id) => ({
      catalog: "sample", kind: "skill", id, scope: "project", status: "current",
    })),
  ];
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 120;
  output.rows = 56;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const done = runDashboard(resources, input, output);
  const waitForFrame = async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    const start = rendered.lastIndexOf("\u001b[?2026h");
    const end = rendered.indexOf("\u001b[?2026l", start);
    return rendered.slice(start, end)
      .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(/\u001b\]8;;[^\u001b]*(?:\u0007|\u001b\\)/g, "");
  };
  const visibleInventory = (frame, selectedId) => {
    const lines = frame.split(/\r?\n/);
    const range = frame.match(/RESOURCES 5\/5 · (\d+-\d+)/)?.[1];
    const ids = ["short-detail", "long-detail", "third", "fourth", "fifth"];
    const detailsTitle = lines.findIndex((line) => line.includes(`SKILL - ${selectedId}`));
    const shortcutsTitle = lines.findIndex((line) => line.includes("SHORTCUTS"));
    const inventoryTitle = lines.findIndex((line) => /│ INVENTORY\s+│/.test(line));
    const rightLeft = lines[detailsTitle]?.indexOf(`SKILL - ${selectedId}`) - 2;
    const rightRight = lines[detailsTitle]?.lastIndexOf("│");
    const detailsBottom = lines.findIndex((line, index) =>
      index > detailsTitle && index < shortcutsTitle && line.indexOf("└", rightLeft) === rightLeft);
    const shortcutsBottom = lines.findIndex((line, index) =>
      index > shortcutsTitle && line.indexOf("└", rightLeft) === rightLeft);
    return {
      range,
      count: ids.filter((id) => frame.includes(id)).length,
      panelBottom: lines.findIndex((line) => /^ └─{50,}┘/.test(line)),
      height: lines.length,
      inventoryTop: inventoryTitle - 1,
      detailsTop: detailsTitle - 1,
      detailsBottom,
      shortcutsTop: shortcutsTitle - 1,
      shortcutsBottom,
      rightLeft,
      detailsRight: rightRight,
      shortcutsLeft: lines[shortcutsTitle]?.indexOf("SHORTCUTS") - 2,
      shortcutsRight: lines[shortcutsTitle]?.lastIndexOf("│"),
    };
  };
  const shortFrame = await waitForFrame();
  input.write("\x1b[B");
  const longFrame = await waitForFrame();
  input.write("q");
  assert.equal(await done, true);
  input.destroy();
  output.destroy();

  const shortViewport = visibleInventory(shortFrame, "short-detail");
  const longViewport = visibleInventory(longFrame, "long-detail");
  assert.deepEqual(longViewport, shortViewport,
    "changing the right-hand detail must not change left-hand page range or visible row count");
  assert.deepEqual(
    { range: shortViewport.range, count: shortViewport.count },
    { range: "1-5", count: 5 },
    "the stable list should show all five inventory rows",
  );
  assert.equal(shortViewport.height, 56);
  assert.equal(longViewport.height, 56);
  assert.equal(shortViewport.panelBottom, 55,
    "the inventory border should fill the final terminal row");
  assert.equal(longViewport.panelBottom, 55,
    "long selected details must not pull the inventory border upward");
  for (const viewport of [shortViewport, longViewport]) {
    assert.equal(viewport.detailsTop, viewport.inventoryTop,
      "DETAILS and INVENTORY top borders align");
    assert.equal(viewport.shortcutsLeft, viewport.rightLeft,
      "DETAILS and SHORTCUTS share a left border");
    assert.equal(viewport.shortcutsRight, viewport.detailsRight,
      "DETAILS and SHORTCUTS share a right border");
    assert.equal(viewport.detailsBottom + 2, viewport.shortcutsTop,
      "DETAILS fills the column gap up to the one-row panel separation");
    assert.equal(viewport.shortcutsBottom, viewport.panelBottom,
      "SHORTCUTS bottom aligns with the Inventory panel bottom");
  }

  const extremeDetails = resources.map((resource) => resource.id === "long-detail"
    ? { ...resource, description: "Long description for the selected resource. ".repeat(25) }
    : resource);
  const extremeFrame = await captureDashboardFrame(
    extremeDetails,
    {},
    ["\x1b[B"],
    { columns: 120, rows: 56 },
  );
  assert.equal(
    extremeFrame.match(/RESOURCES 5\/5 · (\d+-\d+)/)?.[1],
    shortViewport.range,
    "very long selected details must leave the viewport unchanged too",
  );
});

test("InventoryScreen renders supported shortcuts in the spacious details column", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 120;
  output.rows = 56;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const resource = {
    catalog: "engineering",
    kind: "skill",
    id: "long-update",
    scope: "project",
    status: "attention",
    issues: [{
      code: "UPDATE_AVAILABLE",
      paths: [".agents/skills/engineering/a-resource-with-a-deliberately-long-name/SKILL.md"],
    }],
  };
  const done = runDashboard([resource], input, output, [], {
    catalogResources: [{ catalog: "engineering", kind: "skill", id: "available" }],
    execute: async () => ({ success: true }),
  });
  await new Promise((resolve) => setTimeout(resolve, 120));
  input.write("q");
  assert.equal(await done, true);
  input.destroy();
  output.destroy();

  const plain = rendered.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  for (const shortcut of ["SHORTCUTS", "A install", "U update", "Delete uninstall",
    "M catalogs", "F filter", "C catalog", "K kind", "D details", "↑↓ navigate",
    "? guide", "Q quit"]) {
    assert.ok(plain.includes(shortcut), `missing rendered shortcut: ${shortcut}`);
  }
  assert.ok(plain.includes("INVENTORY"));
  assert.ok(plain.includes("Update available:"));
});

test("InventoryScreen omits action shortcuts that are unavailable in this inventory", async () => {
  const { Text } = await import("ink");
  const { InventoryScreen } = await import("../dist/dashboard/screens.mjs");
  const tree = InventoryScreen({
    resources: [],
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
    columns: 120,
    rows: 40,
  });
  const text = visibleInkText(tree, Text).join("");
  assert.ok(!text.includes("A install"));
  assert.ok(!text.includes("U update"));
  assert.ok(!text.includes("Delete uninstall"));
});

test("all dashboard modes show a dedicated shortcut frame for active controls", async () => {
  const candidate = {
    catalog: "sample",
    kind: "skill",
    id: "candidate",
    description: "A catalog candidate.",
    license_status: "MIT",
    source_repository: "org/repo",
    source_path: "skills/candidate",
    source_ref: "0123456789abcdef0123456789abcdef01234567",
  };
  const actions = {
    catalogResources: [candidate],
    userCatalogs: [{ name: "sample", repository: "https://github.com/org/repo" }],
    addCatalog: async () => ({ success: true }),
    removeCatalog: async () => ({ success: true }),
    updateCatalog: async () => ({ success: true }),
    refreshCatalog: async () => ({ success: true }),
    transferCatalogs: async () => ({ success: true }),
    checkCatalogFreshness: async () => [],
  };
  const compactDimensions = { columns: 80, rows: 80 };

  const inventory = await captureDashboardFrame([], actions, [], compactDimensions);
  separatedPanelFrame(inventory, "SHORTCUTS");
  assert.ok(inventory.includes("A install"));
  assert.ok(inventory.includes("M catalogs"));

  const catalog = await captureDashboardFrame([], actions, ["a"], compactDimensions);
  separatedPanelFrame(catalog, "SHORTCUTS");
  assert.ok(catalog.includes("ENTER install"));
  assert.ok(catalog.includes("C catalog"));
  assert.ok(!catalog.includes("A install"));

  const installOptions = await captureDashboardFrame([], actions, ["a", "\r"], compactDimensions);
  const installShortcuts = separatedPanelFrame(installOptions, "SHORTCUTS");
  assert.equal(installShortcuts.body.length, 4,
    "modal shortcut body includes the Actions and Navigation headings and their rows");
  assert.match(installOptions, /┌─ INSTALL OPTIONS /, "non-table modal title bars stay unchanged");
  assert.ok(installOptions.includes("SHORTCUTS"));
  assert.ok(installOptions.includes("FIELD"));
  assert.ok(installOptions.includes("ENTER REVIEW"));
  assert.ok(installOptions.includes("ESC BACK"));
  assert.ok(!installOptions.includes("ENTER select"));
  assert.ok(!installOptions.includes("C catalog"));

  const catalogManagement = await captureDashboardFrame([], actions, ["m"], compactDimensions);
  separatedPanelFrame(catalogManagement, "SHORTCUTS");
  for (const shortcut of ["A add", "P presets", "Delete remove", "E edit",
    "R refresh", "I import", "X export", "D details", "ESC inventory"]) {
    assert.ok(catalogManagement.includes(shortcut), `missing management shortcut: ${shortcut}`);
  }
});

test("wide catalog management fills the terminal and wraps every active shortcut", async () => {
  const dimensions = { columns: 120, rows: 56 };
  const actions = {
    userCatalogs: [{ name: "sample", repository: "https://github.com/org/repo" }],
    addCatalog: async () => ({}),
    removeCatalog: async () => ({}),
    updateCatalog: async () => ({}),
    refreshCatalog: async () => ({}),
    transferCatalogs: async () => ({}),
  };
  const panelBottom = (frame) => {
    const lines = frame.split(/\r?\n/);
    return lines.findLastIndex((line) => /^ └─+┘/.test(line));
  };
  const management = await captureDashboardFrame([], actions, ["m"], dimensions);
  const managementLines = management.split(/\r?\n/);
  const catalogTitle = managementLines.findIndex((line) => line.includes("CONNECTED CATALOGS"));
  const detailsTitle = managementLines.findIndex((line) => line.includes("CATALOG - sample"));
  const shortcutsTitle = managementLines.findIndex((line) => line.includes("SHORTCUTS"));
  const detailsLeft = managementLines[detailsTitle].indexOf("CATALOG - sample") - 2;
  const detailsRight = managementLines[detailsTitle].lastIndexOf("│");
  const shortcutsLeft = managementLines[shortcutsTitle].indexOf("SHORTCUTS") - 2;
  const shortcutsRight = managementLines[shortcutsTitle].lastIndexOf("│");
  const detailsBottom = managementLines.findIndex((line, index) =>
    index > detailsTitle && index < shortcutsTitle && line[detailsLeft] === "└");
  const shortcutsBottom = managementLines.findIndex((line, index) =>
    index > shortcutsTitle && line[shortcutsLeft] === "└" && line[shortcutsRight] === "┘");
  const shortcutsFrame = managementLines.slice(shortcutsTitle, shortcutsBottom + 1).join("\n");

  assert.equal(managementLines.length, dimensions.rows);
  assert.equal(catalogTitle, detailsTitle, "catalog and detail frames start at the same row");
  assert.equal(detailsLeft, shortcutsLeft, "right panels share one left edge");
  assert.equal(detailsRight, shortcutsRight, "right panels share one right edge");
  assert.equal(panelBottom(management), dimensions.rows - 1,
    "catalog list frame should reach the bottom row like Inventory");
  assert.equal(detailsBottom + 2, shortcutsTitle - 1,
    "DETAILS fills the column above the one-row panel separation");
  assert.equal(separatedPanelFrame(management, "SHORTCUTS").body.length, 9,
    "the panel counts category headings and each wrapped active shortcut row");
  assert.equal(shortcutsBottom, dimensions.rows - 1,
    "management shortcuts should stay bottom-anchored to the full-height panel");
  for (const shortcut of ["A add", "P presets", "Delete remove", "E edit",
    "R refresh", "I import", "X export", "D details", "ESC inventory", "Q quit"]) {
    assert.ok(shortcutsFrame.includes(shortcut),
      `missing visible management shortcut: ${shortcut}\n${shortcutsFrame}`);
  }
  assert.ok(shortcutsFrame.split(/\r?\n/).some((line) => line.includes("I import / X export")),
    "Import and Export stay together on one visible shortcut row");
  assert.doesNotMatch(shortcutsFrame, /(?:\.\.\.|…)/,
    "the shortcut frame must wrap, not truncate, active controls");

  const inventory = await captureDashboardFrame([], actions, [], dimensions);
  assert.equal(panelBottom(inventory), dimensions.rows - 1,
    "Inventory continues to fill the same terminal height");
});

