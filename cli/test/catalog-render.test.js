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
function waitForOutput(output, read, predicate, description, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    let timeout;
    const cleanup = () => {
      clearTimeout(timeout);
      output.off("data", onData);
      output.off("end", onEnd);
      output.off("close", onClose);
      output.off("error", onError);
    };
    const check = () => {
      const value = read();
      if (!predicate(value)) return;
      cleanup();
      resolve(value);
    };
    const onData = () => { check(); };
    const onEnd = () => {
      cleanup();
      reject(new Error(`Output ended before ${description}`));
    };
    const onClose = () => {
      cleanup();
      reject(new Error(`Output closed before ${description}`));
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    output.on("data", onData);
    output.once("end", onEnd);
    output.once("close", onClose);
    output.once("error", onError);
    timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${description}`));
    }, timeoutMs);
    check();
  });
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
  const waitForDashboardExit = async () => {
    let timeout;
    try {
      return await Promise.race([
        done,
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("Dashboard did not exit after q within 5 seconds")), 5_000);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  };
  const latestFrame = () => {
    const start = rendered.lastIndexOf("\u001b[?2026h");
    const end = rendered.indexOf("\u001b[?2026l", start);
    return start >= 0 && end > start
      ? rendered.slice(start, end)
        .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
        .replace(/\u001b\]8;;[^\u001b]*(?:\u0007|\u001b\\)/g, "")
      : "";
  };
  const waitForFrame = (predicate, description) => new Promise((resolve, reject) => {
    let timeout;
    const cleanup = () => {
      clearTimeout(timeout);
      output.off("data", onData);
      output.off("end", onEnd);
      output.off("close", onClose);
      output.off("error", onError);
    };
    const check = () => {
      const frame = latestFrame();
      if (!predicate(frame)) return false;
      cleanup();
      resolve(frame);
      return true;
    };
    const onData = () => { check(); };
    const onEnd = () => {
      cleanup();
      reject(new Error(`Dashboard output ended before rendering ${description}`));
    };
    const onClose = () => {
      cleanup();
      reject(new Error(`Dashboard output closed before rendering ${description}`));
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    if (check()) return;
    output.on("data", onData);
    output.once("end", onEnd);
    output.once("close", onClose);
    output.once("error", onError);
    timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Dashboard did not render ${description}`));
    }, 5_000);
  });
  try {
    await waitForFrame((frame) => Boolean(frame), "initial dashboard");
    for (const key of keys) {
      const previousFrame = latestFrame();
      input.write(key);
      const expectedScreen = key === "v" ? "RESOURCE REVISIONS"
        : key === "1" ? "INVENTORY"
          : key === "2" ? "CATALOG RESOURCES"
            : key === "3" ? "CONNECTED CATALOGS" : null;
      await waitForFrame((frame) => frame !== previousFrame &&
        (!expectedScreen || frame.includes(expectedScreen)),
      `the frame after ${JSON.stringify(key)}`);
    }
    const frame = latestFrame();
    for (const key of cleanupKeys) {
      const previousFrame = latestFrame();
      input.write(key);
      await waitForFrame((nextFrame) => nextFrame !== previousFrame &&
        nextFrame.includes("INVENTORY") && !nextFrame.includes("RESOURCE REVISIONS"),
      "the inventory frame after dashboard cleanup");
    }
    input.write("q");
    assert.equal(await waitForDashboardExit(), true);
    return frame;
  } finally {
    input.destroy();
    let cleanupTimeout;
    try {
      await Promise.race([
        done.then(() => {}, () => {}),
        new Promise((resolve) => { cleanupTimeout = setTimeout(resolve, 1_000); }),
      ]);
    } finally {
      clearTimeout(cleanupTimeout);
      output.destroy();
    }
}

}

function latestDashboardRawFrame(rendered) {
  const end = rendered.lastIndexOf("\u001b[?2026l");
  const start = rendered.lastIndexOf("\u001b[?2026h", end);
  return start >= 0 && end > start ? rendered.slice(start, end) : "";
}

function latestDashboardFrame(rendered) {
  return latestDashboardRawFrame(rendered)
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b\]8;;[^\u001b]*(?:\u0007|\u001b\\)/g, "");
}

function selectedDetailsFrame(frame) {
  const start = frame.indexOf("SELECTION DETAILS");
  return start < 0 ? "" : frame.slice(start);
}

async function startInteractiveDashboard(resources, actions = {}, dimensions = { columns: 120, rows: 56 }) {
  const { PassThrough } = require("node:stream");
  const { render } = await import("ink");
  const { createDashboardInputTransport } = await import("../dist/dashboard/input-transport.mjs");
  const { Dashboard } = await import("../dist/dashboard/dashboard.mjs");
  const input = new PassThrough();
  Object.assign(input, { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  const output = new PassThrough();
  Object.assign(output, { isTTY: true, columns: dimensions.columns, rows: dimensions.rows });
  const transport = createDashboardInputTransport(input, output);
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  let resolveDone;
  let rejectDone;
  let app;
  let finished = false;
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  const onFinish = (success) => {
    if (finished) return;
    finished = true;
    try { app?.unmount(); } finally {
      transport.dispose();
      resolveDone(success);
    }
  };
  app = render(React.createElement(Dashboard, { resources, actions, onFinish, mouse: transport.mouse }), {
    stdin: transport.stdin, stdout: output, exitOnCtrlC: false, alternateScreen: true, interactive: true,
  });
  transport.enableMouse();
  app.waitUntilExit().catch((error) => {
    if (finished) return;
    finished = true;
    transport.dispose();
    rejectDone(error);
  });
  const frame = () => latestDashboardFrame(rendered);
  const rawFrame = () => latestDashboardRawFrame(rendered);
  const waitRaw = (predicate, description) => waitForOutput(output, rawFrame, predicate, description);
  const wait = (predicate, description) => waitForOutput(output, frame, predicate, description);
  const stop = async () => {
    input.write("\u001b");
    input.write("q");
    let timeout;
    try { await Promise.race([done, new Promise((resolve) => { timeout = setTimeout(resolve, 1_000); })]); }
    finally { clearTimeout(timeout); input.destroy(); output.destroy(); }
  };
  input.once("close", () => onFinish(false));
  await wait((value) => Boolean(value), "initial interactive frame");
  return { input, output, done, frame, rawFrame, wait, waitRaw, stop, mouse: transport.mouse };
}

function clickMouseTarget(dashboard, matchesTarget) {
  const region = dashboard.mouse.getRegions().find(({ target }) => matchesTarget(target));
  assert.ok(region, "the rendered control has a mouse hit region");
  const x = Math.floor((region.left + region.right) / 2);
  const y = Math.floor((region.top + region.bottom) / 2);
  clickAt(dashboard.input, { x, y });
  return { x, y, region };
}
function clickAt(input, { x, y }) {
  input.write(`\u001b[<0;${x};${y}M\u001b[<0;${x};${y}m`);
}
function renderedTextCell(frame, text) {
  const lines = frame.split(/\r?\n/);
  const row = lines.findIndex((line) => line.includes(text));
  assert.notEqual(row, -1, `visible clickable text ${JSON.stringify(text)}`);
  const start = lines[row].indexOf(text);
  const column = start + Math.floor(text.length / 2);
  return { row, start, column, x: column + 1, y: row + 1 };
}
function clickRenderedText(input, frame, text) {
  const { x, y } = renderedTextCell(frame, text);
  clickAt(input, { x, y });
  return { x, y };
}
function clickRenderedTarget(dashboard, matchesTarget, text, exact = false) {
  const frame = dashboard.frame();
  const cell = renderedTextCell(frame, text);
  const overlappingRegions = dashboard.mouse.getRegions().filter(({ left, right, top, bottom }) =>
    cell.x >= left && cell.x <= right && cell.y >= top && cell.y <= bottom);
  const regions = overlappingRegions.filter(({ target }) => matchesTarget(target));
  const region = regions[0];
  assert.ok(region,
    `visible ${JSON.stringify(text)} cell ${cell.x},${cell.y} has a matching hit region: ${JSON.stringify(regions)}`);
  if (exact) {
    assert.deepEqual([region.left, region.right, region.top, region.bottom], [
      cell.start + 1,
      cell.start + text.length,
      cell.y,
      cell.y,
    ], `${JSON.stringify(text)} hit region ${JSON.stringify(region)} must match rendered cell ${cell.x},${cell.y}`);
  }
  clickAt(dashboard.input, { x: cell.x, y: cell.y });
  return { x: cell.x, y: cell.y, region, overlappingRegions };
}
function clickRenderedButtonRow(dashboard, matchesTarget, text, rowOffset) {
  const cell = renderedTextCell(dashboard.frame(), text);
  const x = cell.x;
  const y = cell.y + rowOffset;
  const overlappingRegions = dashboard.mouse.getRegions().filter(({ left, right, top, bottom }) =>
    x >= left && x <= right && y >= top && y <= bottom);
  const region = overlappingRegions.find(({ target }) => matchesTarget(target));
  assert.ok(region,
    `rendered ${JSON.stringify(text)} cell at ${x},${y} is covered by its measured button region ${JSON.stringify(region)}`);
  clickAt(dashboard.input, { x, y });
  return { x, y, region, overlappingRegions };
}
function assertFocusedInput(dashboard, label) {
  const plainLines = dashboard.frame().split(/\r?\n/);
  assert.ok(plainLines.some((line) => line.includes(`› ${label}`)),
    `${label} focus is distinct in monochrome terminals as well as color terminals`);
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
    controls: { columns: 300, section: "browse", focus: "list", query: "", searchActive: false, filters: [], actions: [] },
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
    const { CatalogManagementScreen, CatalogScreen, InventoryScreen } = await import(process.argv[1]);
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
        licenseFilter: "all", controls: { columns: 120, section: "browse", focus: "list", query: "", searchActive: false, filters: [], actions: [] } }],
      [InventoryScreen, { resources, errors: [], actionMessage: "", catalogAvailable: true, canExecute: true,
        controls: { columns: 120, section: "inventory", focus: "list", query: "", searchActive: false, filters: [], actions: [] } }],
    ]) {
      for (let selectedIndex = 0; selectedIndex < resources.length; selectedIndex++) {
        const output = new PassThrough();
        output.isTTY = true;
        output.columns = 120;
        output.rows = 40;
        let frame = "";
        let resolveFrame;
        const frameReady = new Promise((resolve) => { resolveFrame = resolve; });
        const write = output.write.bind(output);
        output.write = (chunk, ...args) => {
          frame += chunk.toString();
          const result = write(chunk, ...args);
          return result;
        };
        const instance = render(React.createElement(component, { ...common, ...props, selectedIndex }), {
          stdout: output, stdin: new PassThrough(), stderr: output, exitOnCtrlC: false,
          onRender: resolveFrame,
        });
        await frameReady;
        instance.unmount();
        frames.push(frame);
      }
    }
    const catalogManagementFrames = [];
    const catalogs = [
      { name: "catalog-one", repository: "example/one" },
      { name: "catalog-two", repository: "example/two" },
    ];
    for (let selectedIndex = 0; selectedIndex < catalogs.length; selectedIndex++) {
      const output = new PassThrough();
      output.isTTY = true;
      output.columns = 120;
      output.rows = 40;
      let frame = "";
      let resolveFrame;
      const frameReady = new Promise((resolve) => { resolveFrame = resolve; });
      const write = output.write.bind(output);
      output.write = (chunk, ...args) => {
        frame += chunk.toString();
        const result = write(chunk, ...args);
        return result;
      };
      const input = new PassThrough();
      const instance = render(React.createElement(CatalogManagementScreen, {
        catalogs, catalogResources: [], installedResources: [], selectedIndex, freshness: {},
        canAdd: true, canRemove: true, canEdit: true, canRefresh: true, canTransfer: true,
        versionLabel: "test", showDetails: false, columns: 120, rows: 40,
        controls: {
          columns: 120, section: "catalogs", focus: "list", query: "", searchActive: false,
          showSearch: false, filters: [], actions: [],
        },
      }), {
        stdout: output, stdin: input, stderr: output, exitOnCtrlC: false, onRender: resolveFrame,
      });
      await frameReady;
      instance.unmount();
      input.destroy();
      output.destroy();
      catalogManagementFrames.push(frame);
    }
    process.stdout.write(JSON.stringify({
      frames,
      catalogManagementFrames,
      selectedAnsi: DASHBOARD_THEME.terminalAnsi[DASHBOARD_THEME.semantic.selected],
      selectedForeground: DASHBOARD_THEME.semantic.selectedForeground,
    }));
  `;
  const { frames, catalogManagementFrames, selectedAnsi, selectedForeground } = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script, screens], {
    env, encoding: "utf8", timeout: 10000,
  }));
  const selectedBackgroundAnsi = String(Number(selectedAnsi) + 10);
  const selectedBackground = new RegExp(`\\x1b\\[${selectedBackgroundAnsi}m`);
  const ansi = /\x1b\[[0-?]*[ -/]*[@-~]/g;
  for (let screen = 0; screen < 2; screen++) {
    const initialFrame = frames[screen * 4];
    const plainFrame = initialFrame.replace(ansi, "");
    assert.match(plainFrame, /Inventory \d+.*Browse resources \d+.*Catalogs \d+/);
    const lines = initialFrame.split(/\r?\n/);
    const tabRow = lines.findIndex((line) => line.includes(screen ? "Inventory" : "Browse resources"));
    const activeTab = lines[tabRow];
    assert.ok(activeTab);
    assert.doesNotMatch(activeTab, selectedBackground, "active tabs do not use a solid selected background");
    assert.match(lines[tabRow + 1], /\u001b\[36m─/, "the active section has a thin primary underline");
  }
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
      assert.match(selectedRow, selectedBackground);
      const unselectedKindColors = [[33, "skill"], [36, "agent"], [32, screen ? "instr" : "instruction"]];
      for (const [index, [code, label]] of unselectedKindColors.entries()) {
        if (index === selectedIndex) {
          assert.doesNotMatch(rows[index], new RegExp(`\\x1b\\[${code}m`));
          continue;
        }
        assert.match(rows[index], new RegExp(`\\x1b\\[${code}m`));
        assert.match(rows[index], new RegExp(`\\x1b\\[${code}m[\\s\\S]*${label}`));
      }
      if (selectedIndex !== 3) assert.doesNotMatch(rows[3], selectedBackground);
      if (screen) {
        if (selectedIndex !== 1) assert.doesNotMatch(rows[1], /\x1b\[33m/);
        if (selectedIndex !== 2) assert.doesNotMatch(rows[2], /\x1b\[90m/);
        if (selectedIndex !== 3) assert.match(rows[3], /\x1b\[32m/);
        else assert.match(rows[3], selectedBackground);
      } else if (selectedIndex !== 3) {
        assert.match(rows[3], /\x1b\[33m/);
      } else {
        assert.match(rows[3], selectedBackground);
      }
      const plain = rows.map((row) => row.replace(ansi, ""));
      for (const [index, row] of plain.entries()) {
        assert.equal((row.match(/›/g) || []).length, index === selectedIndex ? 1 : 0);
      }
      const screenPlain = frame.replace(ansi, "");
      const screenHeader = screenPlain.split(/\r?\n/).find((line) => screen
        ? /RESOURCE\s+KIND\s+SCOPE\s+STATUS/.test(line)
        : /RESOURCE\s+KIND\s+CATALOG\s+INSTALLED/.test(line));
      assert.ok(screenHeader);
      assert.ok(screenHeader.indexOf("RESOURCE") < screenHeader.indexOf("KIND"));
      for (const [index, kind] of ["skill", "agent", "instruction", "other"].entries()) {
        assert.equal(plain[index].indexOf(`${kind}-one`), screenHeader.indexOf("RESOURCE"));
        assert.equal(plain[index].indexOf(kind, plain[index].indexOf(`${kind}-one`) + kind.length), screenHeader.indexOf("KIND"));
      }
    }
  }
  const inventoryPlain = frames[4].replace(ansi, "");
  assert.match(inventoryPlain, /PROJECT/);
  assert.match(inventoryPlain, /USER/);
  assert.match(inventoryPlain, /UPDATES/);
  const selectedSurfaceForeground = /\x1b\[[0-9;]*97[0-9;]*m/;
  assert.equal(selectedForeground, "whiteBright");
  const catalogNames = ["catalog-one", "catalog-two"];
  for (let selectedIndex = 0; selectedIndex < catalogManagementFrames.length; selectedIndex += 1) {
    const lines = catalogManagementFrames[selectedIndex].split("\n");
    const selectedRow = lines.find((line) => line.includes(catalogNames[selectedIndex]));
    const unselectedRow = lines.find((line) => line.includes(catalogNames[1 - selectedIndex]));
    assert.ok(selectedRow, "the selected catalog card is visible in the Ink-rendered frame");
    assert.ok(unselectedRow, "the unselected catalog card is visible in the Ink-rendered frame");
    assert.match(selectedRow, selectedBackground, "the selected catalog card uses the selection background");
    assert.match(selectedRow, selectedSurfaceForeground, "the selected catalog card uses the selection foreground");
    assert.doesNotMatch(unselectedRow, selectedBackground, "the unselected catalog card keeps its normal surface");
  }
});

test("dashboard mouse transport strips fragmented reports without corrupting search input", async () => {
  const { PassThrough } = require("node:stream");
  const { createDashboardInputTransport } = await import("../dist/dashboard/input-transport.mjs");
  const input = new PassThrough();
  Object.assign(input, { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  const output = new PassThrough();
  output.isTTY = true;
  let terminalModes = "";
  output.on("data", (chunk) => { terminalModes += chunk.toString(); });
  let text = "";
  let mouseClicks = 0;
  const transport = createDashboardInputTransport(input, output);
  transport.stdin.on("data", (chunk) => { text += chunk.toString(); });
  transport.mouse.setHandler(() => { mouseClicks += 1; });
  transport.mouse.replace("test", [{
    left: 2, right: 2, top: 6, bottom: 6, target: { type: "focus", focus: "search" },
  }]);
  transport.enableMouse();
  input.write("type[");
  input.write("\u001b");
  input.write("[<0;2;6");
  input.write("M");
  input.write("\u001b[<0;2;6m");
  try {
    await waitForOutput(transport.stdin, () => text, (value) => value === "type[", "literal search text");
    assert.equal(mouseClicks, 1);
    transport.dispose();
    assert.match(terminalModes, /\u001b\[\?1006l\u001b\[\?1000l/);
  } finally {
    transport.dispose();
    input.destroy();
    output.destroy();
  }
});

test("dashboard section shortcuts switch directly between inventory, catalog, and catalog management", async () => {
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
    checkCatalogFreshness: async () => [],
  };
  const dimensions = { columns: 120, rows: 56 };

  const browse = await captureDashboardFrame([], actions, ["2"], dimensions);
  assert.ok(browse.includes("CATALOG RESOURCES"));
  const catalogs = await captureDashboardFrame([], actions, ["3"], dimensions);
  assert.ok(catalogs.includes("CONNECTED CATALOGS"));
  const inventory = await captureDashboardFrame([], actions, ["3", "2", "1"], dimensions);
  assert.ok(inventory.includes("INVENTORY"));
});

test("dashboard keyboard focus follows Search, Kind, Catalog, and License controls", async () => {
  const resources = [
    { catalog: "alpha", kind: "skill", id: "alpha-skill", scope: "project", managed: true, status: "current", license_status: "MIT", license_spdx: "MIT" },
    { catalog: "alpha", kind: "agent", id: "alpha-agent", scope: "project", managed: true, status: "current", license_status: "Apache-2.0", license_spdx: "Apache-2.0" },
    { catalog: "beta", kind: "skill", id: "beta-skill", scope: "project", managed: true, status: "current", license_status: "GPL-3.0-only", license_spdx: "GPL-3.0-only" },
  ];
  const dashboard = await startInteractiveDashboard(resources);
  try {
    dashboard.input.write("f");
    await dashboard.wait((frame) => frame.includes("Search") && frame.includes("▏"), "focused search input");
    assertFocusedInput(dashboard, "Search");
    let beforeFocus = dashboard.rawFrame();
    dashboard.input.write("\t");
    await dashboard.waitRaw((frame) => frame !== beforeFocus, "Kind focus after Search");
    assertFocusedInput(dashboard, "Kind");
    dashboard.input.write("\r");
    await dashboard.wait((frame) => frame.includes("Choose kind"), "kind option list");
    dashboard.input.write("\u001b[B");
    await dashboard.wait((frame) => frame.includes("› agent"), "kind option highlighted");
    dashboard.input.write("\r");
    await dashboard.wait((frame) => frame.includes("KIND AGENT"), "kind filter committed");

    beforeFocus = dashboard.rawFrame();
    dashboard.input.write("\t");
    await dashboard.waitRaw((frame) => frame !== beforeFocus, "Catalog focus after Kind");
    assertFocusedInput(dashboard, "Catalog");
    dashboard.input.write("\r");
    await dashboard.wait((frame) => frame.includes("Choose catalog"), "catalog option list");
    dashboard.input.write("\u001b[B");
    await dashboard.wait((frame) => frame.includes("› alpha"), "catalog option highlighted");
    dashboard.input.write("\r");
    await dashboard.wait((frame) => frame.includes("CATALOG ALPHA"), "catalog filter committed");

    beforeFocus = dashboard.rawFrame();
    dashboard.input.write("\t");
    await dashboard.waitRaw((frame) => frame !== beforeFocus, "License focus after Catalog");
    assertFocusedInput(dashboard, "License");
    dashboard.input.write("\r");
    await dashboard.wait((frame) => frame.includes("Choose license"), "license option list");
    dashboard.input.write("\u001b[B");
    await dashboard.wait((frame) => frame.includes("› Apache-2.0"), "license option highlighted");
    dashboard.input.write("\r");
    await dashboard.wait((frame) => frame.includes("Apache-2.0▾"), "license filter committed");
    dashboard.input.write("f");
    await dashboard.wait((frame) => frame.includes("Search") && frame.includes("▏"), "search input focus");
    assertFocusedInput(dashboard, "Search");
    dashboard.input.write("alpha-agent");
    await dashboard.wait((frame) => frame.includes("alpha-agent▏"), "typed search text");
  } finally {
    await dashboard.stop();
  }
});

test("narrow inventory preserves direct C/K/L filters and visible control focus", async () => {
  const resources = [
    { catalog: "alpha", kind: "agent", id: "alpha-agent", scope: "project", managed: true, status: "current", license_status: "Apache-2.0", license_spdx: "Apache-2.0", source_repository: "org/alpha" },
    { catalog: "alpha", kind: "agent", id: "alpha-agent-mit", scope: "project", managed: true, status: "current", license_status: "MIT", license_spdx: "MIT", source_repository: "org/alpha" },
    { catalog: "alpha", kind: "skill", id: "alpha-skill", scope: "project", managed: true, status: "current", license_status: "MIT", license_spdx: "MIT", source_repository: "org/alpha" },
    { catalog: "beta", kind: "skill", id: "beta-skill", scope: "project", managed: true, status: "current", license_status: "GPL-3.0-only", license_spdx: "GPL-3.0-only", source_repository: "org/beta" },
  ];
  const dashboard = await startInteractiveDashboard(resources, {
    userCatalogs: [
      { name: "alpha", repository: "org/alpha" },
      { name: "beta", repository: "org/beta" },
    ],
  }, { columns: 47, rows: 60 });
  try {
    dashboard.input.write("c");
    await dashboard.wait((frame) => frame.includes("alpha▾"), "direct C catalog filter");
    assert.ok(dashboard.frame().includes("3 results"), `direct C result set:\n${dashboard.frame()}`);
    let beforeShortcut = dashboard.rawFrame();
    dashboard.input.write("k");
    await dashboard.waitRaw((frame) => frame !== beforeShortcut, "direct K shortcut redraw");
    const kindFrame = dashboard.frame();
    assert.ok(kindFrame.includes("agent▾") && kindFrame.includes("2 results"), `direct K kind filter:\n${kindFrame}`);
    beforeShortcut = dashboard.rawFrame();
    dashboard.input.write("l");
    await dashboard.waitRaw((frame) => frame !== beforeShortcut, "direct L shortcut redraw");
    const licenseFrame = dashboard.frame();
    assert.ok(licenseFrame.includes("Apache-2.0▾") && licenseFrame.includes("1 results"),
      `direct L license filter:\n${licenseFrame}`);
    assert.ok(dashboard.frame().includes("Inventory 4"), "direct filters leave the unfiltered count intact");

    dashboard.input.write("f");
    await dashboard.wait((frame) => frame.includes("▏"), "compact search focus");
    assertFocusedInput(dashboard, "Search");
    const beforeFocus = dashboard.rawFrame();
    dashboard.input.write("\t");
    await dashboard.waitRaw((frame) => frame !== beforeFocus, "compact Kind focus after Search");
    assertFocusedInput(dashboard, "Kind");
  } finally {
    await dashboard.stop();
  }
});
test("tabs, bordered filters, and menus stay clickable across responsive widths", async () => {
  const resources = [
    { catalog: "alpha", kind: "skill", id: "alpha-skill", scope: "project", managed: true, status: "current" },
    { catalog: "beta", kind: "agent", id: "beta-agent", scope: "project", managed: true, status: "current" },
  ];
  for (const dimensions of [
    { columns: 160, rows: 40 },
    { columns: 120, rows: 56 },
    { columns: 94, rows: 56 },
    { columns: 93, rows: 56 },
    { columns: 47, rows: 60 },
  ]) {
    const dashboard = await startInteractiveDashboard(resources, {}, dimensions);
    try {
      const frame = dashboard.frame();
      assert.ok(["Inventory 2", "Browse resources 0", "Catalogs 0"].every((label) => frame.includes(label)),
        "tabs show current unfiltered section counts");
      assert.ok(["Search resources…", "All kinds", "All catalogs", "All licenses"].every((value) => frame.includes(value)),
        `bordered input values remain visible at ${dimensions.columns} columns`);
      const labels = ["Search", "Kind", "Catalog", "License"].map((label) => {
        const row = frame.split(/\r?\n/).findIndex((line) => new RegExp(`\\b${label}\\b`).test(line));
        assert.notEqual(row, -1, `${label} label remains visible`);
        return { row, column: frame.split(/\r?\n/)[row].indexOf(label) };
      });
      assert.deepEqual(labels, [...labels].sort((left, right) => left.row - right.row || left.column - right.column),
        "focus and visual order stays Search, Kind, Catalog, License");

      for (const rowOffset of [-1, 0, 1]) {
        clickRenderedButtonRow(dashboard,
          (target) => target.type === "focus" && target.focus === "search", "Search resources", rowOffset);
        await dashboard.wait((next) => next.includes("▏"), `Search border row ${rowOffset} receives focus`);
        dashboard.input.write("\u001b");
        await dashboard.wait((next) => !next.includes("▏"), `Search border row ${rowOffset} releases focus`);
      }
      for (const rowOffset of [-1, 0, 1]) {
        clickRenderedButtonRow(dashboard,
          (target) => target.type === "filter-open" && target.filter === "catalog", "All catalogs", rowOffset);
        await dashboard.wait((next) => next.includes("Choose catalog"), `Catalog border row ${rowOffset} opens menu`);
        dashboard.input.write("\u001b");
        await dashboard.wait((next) => !next.includes("Choose catalog"), `Catalog border row ${rowOffset} closes menu`);
      }
      clickRenderedTarget(dashboard,
        (target) => target.type === "filter-open" && target.filter === "catalog", "All catalogs");
      await dashboard.wait((next) => next.includes("Choose catalog"), "catalog menu after summary cards");
      clickRenderedTarget(dashboard,
        (target) => target.type === "filter-option" && target.filter === "catalog" && target.value === "alpha", "alpha");
      await dashboard.wait((next) => next.includes("alpha▾"), "catalog option selected by its visible cell");
      assert.ok(dashboard.frame().includes("Inventory 2"), "filtering never changes the unfiltered installed tab count");

      clickRenderedTarget(dashboard,
        (target) => target.type === "filter-open" && target.filter === "kind", "All kinds");
      await dashboard.wait((next) => next.includes("Choose kind"), "kind menu opens from its bordered field");
      dashboard.input.write("\u001b");
      await dashboard.wait((next) => !next.includes("Choose kind"), "kind menu closes with Escape");

      clickRenderedButtonRow(dashboard,
        (target) => target.type === "section" && target.section === "browse", "Browse resources 0", 0);
      await dashboard.wait((next) => next.includes("CATALOG RESOURCES"), "Browse tab label click");
      clickRenderedButtonRow(dashboard,
        (target) => target.type === "section" && target.section === "inventory", "Inventory 2", 1);
      await dashboard.wait((next) => next.includes("INSTALLED RESOURCES"), "Inventory tab underline click");
      clickRenderedButtonRow(dashboard,
        (target) => target.type === "section" && target.section === "browse", "Browse resources 0", 1);
      await dashboard.wait((next) => next.includes("CATALOG RESOURCES"), "Browse tab underline click");
      clickRenderedButtonRow(dashboard,
        (target) => target.type === "section" && target.section === "inventory", "Inventory 2", 0);
      await dashboard.wait((next) => next.includes("INSTALLED RESOURCES"), "Inventory tab label click");
    } finally {
      await dashboard.stop();
    }
  }
});
test("Inventory detail paging reveals every metadata field at narrow and short sizes without stealing action focus", async () => {
  const resource = {
    catalog: "pager-catalog",
    kind: "skill",
    id: "paged-resource",
    scope: "project",
    status: "current",
    source_repository: "example/pager",
    source_path: "skills/paged-resource",
    source_ref: "0123456789abcdef0123456789abcdef01234567",
    description: Array.from({ length: 12 }, (_, index) => `Segment ${index + 1}: complete details remain available across pages.`).join(" "),
    category: "Pager category",
    tags: ["Pager tags"],
    use_when: "Pager use when",
    example: "Pager example",
    prerequisites: ["Pager prerequisite"],
    owner: "Pager owner",
    expected_output: "Pager expected output",
    limitations: ["Pager limitation"],
    deprecation_reason: "Pager deprecation reason",
    replacement: "Pager replacement",
    apply_to: ["**/*.ts"],
  };
  for (const dimensions of [
    { columns: 47, rows: 60 },
    { columns: 160, rows: 40 },
  ]) {
    const dashboard = await startInteractiveDashboard([resource], {
      execute: async () => ({ code: 0, resources: [] }),
      listSourceVersions: async () => [{ sha: resource.source_ref, date: "2026-01-01", subject: "Current" }],
    }, dimensions);
    try {
      let frame = dashboard.frame();
      assert.ok(frame.includes("SELECTION DETAILS"));
      assert.ok(frame.includes("PgUp/PgDn"), "clipped details expose a visible page-key hint");
      assert.ok(frame.includes("Update resource"), "contextual actions remain inside the details surface");
      assert.ok(!frame.includes("Pager replacement"), "later metadata starts outside the first detail page");

      let pages = 0;
      while (!frame.includes("APPLIES TO") && pages < 8) {
        const previousDetails = selectedDetailsFrame(frame);
        dashboard.input.write("\u001b[6~");
        try {
          frame = await dashboard.wait((next) => selectedDetailsFrame(next) !== previousDetails,
            "PageDown reveals the next detail slice");
        } catch (error) {
          throw new Error(`${error.message}\nLast detail frame:\n${selectedDetailsFrame(dashboard.frame())}`);
        }
        pages += 1;
      }
      assert.ok(frame.includes("APPLIES TO"), `the final detail field is visible at ${dimensions.columns}×${dimensions.rows}`);
      assert.ok(frame.includes("Pager replacement"));

      for (let index = 0; index < 6; index += 1) {
        dashboard.input.write("\t");
        await new Promise((resolve) => setImmediate(resolve));
      }
      const actionFocusFrame = dashboard.frame();
      dashboard.input.write("\u001b[5~");
      await dashboard.wait((next) => next !== actionFocusFrame, "PageUp scrolls while contextual actions retain focus");
      dashboard.input.write("\r");
      await dashboard.wait((next) => next.includes("CONFIRM UPDATE"),
        "PageUp leaves Update focused and Enter remains actionable");
    } finally {
      await dashboard.stop();
    }
  }
});

test("detail paging hints follow list focus without taking search input", async () => {
  const resource = {
    catalog: "page-hint-catalog",
    kind: "skill",
    id: "page-hint-resource",
    scope: "project",
    status: "current",
    managed: true,
    source_repository: "example/page-hint",
    source_path: "skills/page-hint-resource/SKILL.md",
    source_ref: "0123456789abcdef0123456789abcdef01234567",
    description: "Visible details stay pageable while search retains its input focus. ".repeat(8),
  };
  for (const screen of ["inventory", "browse"]) {
    const actions = screen === "browse" ? { catalogResources: [resource] } : {};
    const dashboard = await startInteractiveDashboard(
      screen === "inventory" ? [resource] : [], actions, { columns: 120, rows: 40 },
    );
    try {
      if (screen === "browse") {
        dashboard.input.write("2");
        await dashboard.wait((frame) => frame.includes("CATALOG RESOURCES") && frame.includes("SELECTION DETAILS"),
          "Browse section and details");
      } else {
        await dashboard.wait((frame) => frame.includes("INVENTORY") && frame.includes("SELECTION DETAILS"),
          "Inventory details");
      }
      assert.ok(dashboard.frame().includes("PgUp/PgDn"), `${screen} advertises clipped details while list-focused`);

      dashboard.input.write("f");
      const searchFrame = await dashboard.wait((frame) => frame.includes("Search") && frame.includes("▏"),
        `${screen} search focus`);
      assert.ok(!searchFrame.includes("PgUp/PgDn"), `${screen} hides page hints while search owns the keyboard`);
      const searchDetails = selectedDetailsFrame(searchFrame);
      dashboard.input.write("\u001b[6~");
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(selectedDetailsFrame(dashboard.frame()), searchDetails,
        `${screen} PageDown does not steal active search input`);

      dashboard.input.write("\x1b");
      const restored = await dashboard.wait((frame) => frame.includes("PgUp/PgDn") && !frame.includes("▏"),
        `${screen} list pager hint after leaving search`);
      const previousDetails = selectedDetailsFrame(restored);
      dashboard.input.write("\u001b[6~");
      await dashboard.wait((frame) => selectedDetailsFrame(frame) !== previousDetails,
        `${screen} PageDown after list focus returns`);
    } finally {
      await dashboard.stop();
    }
  }
});

test("mouse selects rendered resources and modal buttons preserve install safety", async () => {
  const candidates = ["candidate-one", "candidate-two"].map((id) => ({
    catalog: "sample", kind: "skill", id, description: "A catalog candidate.",
    source_repository: "org/repo", source_path: `skills/${id}`, source_ref: "abcdef0123456789abcdef0123456789abcdef01",
  }));
  const calls = [];
  const dashboard = await startInteractiveDashboard([], {
    catalogResources: candidates,
    execute: async (operation, resource, options) => {
      calls.push({ operation, id: resource.id, options });
      return {
        code: 0,
        resources: [{ ...resource, scope: options.scope, managed: true, status: "current" }],
      };
    },
  });
  try {
    const browseTab = clickRenderedTarget(dashboard,
      (target) => target.type === "section" && target.section === "browse", "Browse resources 2");
    await dashboard.wait((frame) => frame.includes("CATALOG RESOURCES"), "Browse after tab click");
    clickRenderedTarget(dashboard,
      (target) => target.type === "row" && target.screen === "browse" && target.index === 1, "candidate-two");
    await dashboard.wait((frame) => frame.includes("skill · candidate-two"), "second resource selected by row click");
    clickRenderedTarget(dashboard,
      (target) => target.type === "action" && target.action === "install", "Install resource");
    await dashboard.wait((frame) => frame.includes("INSTALL OPTIONS"), "install options modal");
    await new Promise((resolve) => setImmediate(resolve));
    clickRenderedTarget(dashboard,
      (target) => target.type === "modal-option" && target.group === "scope", "│ USER │");
    await dashboard.wait((frame) => frame.includes("│ USER │"), "user scope selected by click");
    await new Promise((resolve) => setImmediate(resolve));
    clickRenderedTarget(dashboard,
      (target) => target.type === "modal-option" && target.group === "client", "│ CLAUDE │");
    await dashboard.wait((frame) => frame.includes("│ CLAUDE │"), "Claude client selected by click");
    await new Promise((resolve) => setImmediate(resolve));
    dashboard.input.write("\r");
    await dashboard.wait((frame) => frame.includes("CONFIRM INSTALL"), "install confirmation");
    clickAt(dashboard.input, browseTab);
    clickRenderedTarget(dashboard,
      (target) => target.type === "modal-choice" && target.index === 1, "│ INSTALL │");
    await dashboard.wait((frame) => frame.includes("Inventory 1") && !frame.includes("CONFIRM INSTALL"),
      "confirmed install updates the live installed tab count");
    assert.deepEqual(calls.map(({ operation, id, options }) => ({ operation, id, scope: options.scope, tool: options.tool })), [
      { operation: "install", id: "candidate-two", scope: "user", tool: "claude" },
    ]);
  } finally {
    await dashboard.stop();
  }
});

test("Inventory Remove button accepts the production xterm cell click", async () => {
  const calls = [];
  const dashboard = await startInteractiveDashboard([{
    catalog: "local", kind: "skill", id: "local-testing", scope: "project", managed: false,
    status: "unmanaged", paths: [".agents/skills/local-testing"],
  }], {
    catalogResources: [{ catalog: "sample", kind: "skill", id: "candidate" }],
    execute: async (operation) => { calls.push(operation); return { code: 0, resources: [] }; },
  }, { columns: 159, rows: 48 });
  try {
    const position = clickRenderedTarget(dashboard,
      (target) => target.type === "action" && target.action === "remove", "Remove");
    await dashboard.wait((frame) => frame.includes("CONFIRM REMOVE"),
      `Remove confirmation from rendered cell ${position.x},${position.y}`);
    assert.equal(dashboard.mouse.getRegions().some(({ target }) => target.type === "action"), false,
      "modal choices replace underlying action hit regions");
    assert.deepEqual(calls, [], "the button opens confirmation rather than executing immediately");
  } finally {
    await dashboard.stop();
  }
});

test("inventory action hitboxes follow Ink layout across descriptions, focus, and widths", async () => {
  const cases = [
    { columns: 160, rows: 40, description: "Preview this resource.", focusActions: true },
    { columns: 160, rows: 48, description: "A longer description for layout measurement. ".repeat(5) },
    { columns: 47, rows: 60, description: "A longer description for layout measurement. ".repeat(5) },
    { columns: 40, rows: 36, description: "Preview this resource." },
  ];
  for (const { columns, rows, description, focusActions } of cases) {
    const calls = [];
    const resource = {
      catalog: "sample", kind: "skill", id: "local-testing", scope: "project", managed: true,
      status: "current", description, source_repository: "org/repo",
      source_path: "skills/local-testing", source_ref: "abcdef0123456789abcdef0123456789abcdef01",
    };
    const dashboard = await startInteractiveDashboard([resource], {
      execute: async (operation, selected) => {
        calls.push({ operation, id: selected.id });
        return { code: 0, messages: ["source content"] };
      },
      listSourceVersions: async () => [{
        sha: resource.source_ref, prefix: resource.source_ref.slice(0, 7), date: "2026-01-01", subject: "Current",
      }],
    }, { columns, rows });
    try {
      const initial = dashboard.frame();
      assert.ok(initial.includes("Preview / audit"), `Preview remains visible at ${columns}×${rows}`);
      if (focusActions) {
        const beforeFocus = dashboard.rawFrame();
        dashboard.input.write("\t".repeat(6));
        await dashboard.waitRaw((frame) => frame !== beforeFocus, "keyboard Tab focus updates the action layout");
      }
      const position = clickRenderedTarget(dashboard,
        (target) => target.type === "action" && target.action === "preview", "Preview / audit");
      await dashboard.wait((frame) => calls.length === 1,
        `preview click at ${position.x},${position.y}, region ${JSON.stringify(position.region)}`);
      assert.deepEqual(calls, [{ operation: "preview", id: "local-testing" }]);
      if (focusActions) {
        dashboard.input.write("\u001b");
        await dashboard.wait((frame) => frame.includes("SELECTION DETAILS") && frame.includes("ACTIONS"),
          "Preview closes back to contextual actions");
        clickRenderedTarget(dashboard,
          (target) => target.type === "action" && target.action === "update", "Update resource");
        await dashboard.wait((frame) => frame.includes("CONFIRM UPDATE"), "Update button preserves confirmation");
        dashboard.input.write("\u001b");
        await dashboard.wait((frame) => !frame.includes("CONFIRM UPDATE"), "Update confirmation cancels safely");

        clickRenderedTarget(dashboard,
          (target) => target.type === "action" && target.action === "revision", "Revisions");
        await dashboard.wait((frame) => frame.includes("RESOURCE REVISIONS"), "Revisions button opens source choices");
        dashboard.input.write("\u001b");
        await dashboard.wait((frame) => !frame.includes("RESOURCE REVISIONS"), "Revision picker cancels safely");

        clickRenderedTarget(dashboard,
          (target) => target.type === "action" && target.action === "remove", "Uninstall");
        await dashboard.wait((frame) => frame.includes("CONFIRM UNINSTALL"), "Uninstall button preserves confirmation");
        assert.deepEqual(calls, [{ operation: "preview", id: "local-testing" }],
          "update and uninstall buttons do not bypass their confirmation steps");
        dashboard.input.write("\u001b");
        await dashboard.wait((frame) => !frame.includes("CONFIRM UNINSTALL"), "Uninstall confirmation cancels safely");
      }
    } finally {
      await dashboard.stop();
    }
  }
});

test("each wrapped Install resource button row opens install options rather than revisions", async () => {
  const candidate = {
    catalog: "sample", kind: "skill", id: "candidate",
    description: "A source-backed resource.", source_repository: "org/repo",
    source_path: "skills/candidate", source_ref: "abcdef0123456789abcdef0123456789abcdef01",
  };
  for (const dimensions of [{ columns: 47, rows: 60 }, { columns: 160, rows: 48 }]) {
    const calls = [];
    const dashboard = await startInteractiveDashboard([], {
      catalogResources: [candidate],
      execute: async (...args) => { calls.push(args); return { code: 0, resources: [] }; },
      listSourceVersions: async () => [{
        sha: candidate.source_ref, prefix: candidate.source_ref.slice(0, 7), date: "2026-01-01", subject: "Current",
      }],
    }, dimensions);
    try {
      dashboard.input.write("2");
      await dashboard.wait((frame) => frame.includes("CATALOG RESOURCES") && frame.includes("SELECTION DETAILS"),
        `Browse button panel at ${dimensions.columns}×${dimensions.rows}`);
      for (const rowOffset of [-1, 0, 1]) {
        clickRenderedButtonRow(dashboard,
          (target) => target.type === "action" && target.action === "install", "Install resource", rowOffset);
        await dashboard.wait((frame) => frame.includes("INSTALL OPTIONS"), `Install button row ${rowOffset}`);
        assert.equal(dashboard.frame().includes("RESOURCE REVISIONS"), false,
          "every visible Install border and label cell dispatches install, not revisions");
        assert.deepEqual(calls, [], "opening install options does not execute the installation");
        dashboard.input.write("\u001b");
        await dashboard.wait((frame) => frame.includes("CATALOG RESOURCES") && !frame.includes("INSTALL OPTIONS"),
          `Install options cancel after button row ${rowOffset}`);
      }
    } finally {
      await dashboard.stop();
    }
  }
});

test("mouse preserves cancel and two-stage unmanaged removal confirmations", async () => {
  const calls = [];
  const resource = {
    catalog: "unmanaged", kind: "skill", id: "orphan", scope: "project", managed: false,
    paths: [".agents/skills/orphan"], status: "unmanaged",
  };
  const dashboard = await startInteractiveDashboard([resource], {
    execute: async (operation) => { calls.push(operation); return { code: 0, resources: [] }; },
  }, { columns: 40, rows: 36 });
  try {
    clickRenderedTarget(dashboard,
      (target) => target.type === "action" && target.action === "remove", "Remove");
    await dashboard.wait((frame) => frame.includes("CONFIRM REMOVE"), "first unmanaged removal confirmation");
    clickRenderedTarget(dashboard,
      (target) => target.type === "modal-choice" && target.index === 0, "CANCEL");
    await dashboard.wait((frame) => frame.includes("INVENTORY") && !frame.includes("CONFIRM REMOVE"),
      "cancelled removal confirmation");
    assert.deepEqual(calls, [], "mouse cancel preserves the unmanaged resource");
    clickRenderedTarget(dashboard,
      (target) => target.type === "action" && target.action === "remove", "Remove");
    await dashboard.wait((frame) => frame.includes("CONFIRM REMOVE"), "reopened removal confirmation");
    clickRenderedTarget(dashboard,
      (target) => target.type === "modal-choice" && target.index === 1, "│ REMOVE │");
    await dashboard.wait((frame) => frame.includes("CONFIRM PERMANENT REMOVAL"), "second unmanaged removal confirmation");
    assert.deepEqual(calls, [], "the first mouse confirmation does not remove unmanaged content");
    clickRenderedTarget(dashboard,
      (target) => target.type === "modal-choice" && target.index === 1, "│ REMOVE PERMANENT │");
    await dashboard.wait((frame) => frame.includes("INVENTORY") && !frame.includes("CONFIRM PERMANENT REMOVAL"),
      "unmanaged removal completes after its second confirmation");
    assert.deepEqual(calls, ["remove-unmanaged"]);
  } finally {
    await dashboard.stop();
  }
});

test("Browse details expose license and pinned source only when provenance exists", async () => {
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
  const sourceFrame = (await captureDashboardFrame([], { catalogResources: [source] }, ["2"], { columns: 120, rows: 60 }))
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  assert.ok(sourceFrame.includes("LICENSE"));
  assert.ok(sourceFrame.includes("MIT"));
  assert.ok(sourceFrame.includes("PINNED SOURCE"));

  const localFrame = (await captureDashboardFrame([], { catalogResources: [{
    catalog: "local", kind: "skill", id: "local-demo", description: "A local resource.",
  }] }, ["a"], { columns: 120, rows: 60 })).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  assert.ok(localFrame.includes("LICENSE"));
  assert.ok(localFrame.includes("not declared"));
  assert.ok(!localFrame.includes("PINNED SOURCE"));
  assert.ok(!localFrame.includes("@0123456789abcdef0123456789abcdef01234567"));
});

test("Browse pages full descriptions, catalog/license values, and pinned sources at narrow widths", async () => {
  const description = "A long description with enough detail to wrap across several narrow terminal lines without losing any words.";
  const sourcePath = "skills/long-resource-folder/with-an-extraordinarily-long-unbroken-source-path-segment";
  const sourceRef = "0123456789abcdef0123456789abcdef01234567";
  const source = `org/very-long-example-repository/${sourcePath}@${sourceRef}`;
  const catalog = "very-long-custom-catalog-name-for-paged-browser-details";
  const license = "Apache-2.0 WITH a very-long-proprietary-license-exception-for-extended-metadata";
  const resource = {
    catalog,
    kind: "skill", id: "long-resource", description,
    license_status: license, source_repository: "org/very-long-example-repository", source_path: sourcePath, source_ref: sourceRef,
  };
  const strip = (frame) => frame.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b\]8;;/g, "").replace(/\u001b\\/g, "").replace(/│/g, "");
  for (const columns of [56, 120]) {
    const dashboard = await startInteractiveDashboard([], { catalogResources: [resource] }, { columns, rows: 40 });
    try {
      dashboard.input.write("2");
      await dashboard.wait((frame) => frame.includes("CATALOG RESOURCES") && frame.includes("SELECTION DETAILS") &&
        frame.includes("long-resource"), "Browse and selected details before reading pages");
      let allPages = "";
      let frame = dashboard.frame();
      for (let page = 0; page < 8; page += 1) {
        allPages += strip(frame).replace(/\s/g, "");
        if (allPages.includes(description.replace(/\s/g, "")) && allPages.includes(source.replace(/\s/g, "")) &&
            allPages.includes(catalog.replace(/\s/g, "")) && allPages.includes(license.replace(/\s/g, ""))) break;
        const previousDetails = selectedDetailsFrame(frame);
        dashboard.input.write("\u001b[6~");
        try {
          frame = await dashboard.wait((next) => selectedDetailsFrame(next) !== previousDetails,
            "Browse PageDown detail content");
        } catch (error) {
          if (error instanceof Error && error.message === "Timed out waiting for Browse PageDown detail content") break;
          throw error;
        }
      }
      allPages += strip(frame).replace(/\s/g, "");
      assert.ok(allPages.includes(description.replace(/\s/g, "")),
        `description remains complete at ${columns} columns`);
      assert.ok(allPages.includes(source.replace(/\s/g, "")),
        `pinned source remains complete at ${columns} columns`);
      assert.ok(allPages.includes(catalog.replace(/\s/g, "")), `catalog label remains complete at ${columns} columns`);
      assert.ok(allPages.includes(license.replace(/\s/g, "")), `license value remains complete at ${columns} columns`);
    } finally {
      await dashboard.stop();
    }
  }
});

test("Inventory pages complete locations, descriptions, catalog labels, and licenses at narrow widths", async () => {
  const description = "A long inventory description that must remain complete when shown in a narrow terminal.";
  const location = "/workspace/projects/a-resource-folder/with-an-extraordinarily-long-unbroken-path-segment";
  const sourceRef = "0123456789abcdef0123456789abcdef01234567";
  const catalog = "very-long-custom-catalog-name-for-paged-inventory-details";
  const license = "Apache-2.0 WITH a very-long-proprietary-license-exception-for-extended-metadata";
  const resource = {
    catalog,
    kind: "skill",
    id: "long-resource",
    scope: "project",
    status: "current",
    managed: true,
    paths: [location],
    source_repository: "example/long-repository-name",
    description,
    source_ref: sourceRef,
    license_status: license,
  };
  const strip = (frame) => frame.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b\]8;;/g, "").replace(/\u001b\\/g, "").replace(/│/g, "");
  for (const columns of [56, 120]) {
    const dashboard = await startInteractiveDashboard([resource], {}, { columns, rows: 40 });
    try {
      let frame = dashboard.frame();
      let allPages = "";
      for (let page = 0; page < 8; page += 1) {
        allPages += strip(frame).replace(/\s/g, "");
        if (allPages.includes(description.replace(/\s/g, "")) && allPages.includes(location) &&
            allPages.includes("https://github.com/example/long-repository-name") && allPages.includes(sourceRef) &&
            allPages.includes(catalog.replace(/\s/g, "")) && allPages.includes(license.replace(/\s/g, ""))) break;
        const previousDetails = selectedDetailsFrame(frame);
        dashboard.input.write("\u001b[6~");
        try {
          frame = await dashboard.wait((next) => selectedDetailsFrame(next) !== previousDetails,
            "Inventory PageDown detail content");
        } catch (error) {
          if (error instanceof Error && error.message === "Timed out waiting for Inventory PageDown detail content") break;
          throw error;
        }
      }
      allPages += strip(frame).replace(/\s/g, "");
      assert.ok(allPages.includes(description.replace(/\s/g, "")));
      assert.ok(allPages.includes(location));
      assert.ok(allPages.includes("https://github.com/example/long-repository-name"));
      assert.ok(allPages.includes(sourceRef));
      assert.ok(allPages.includes(catalog.replace(/\s/g, "")));
      assert.ok(allPages.includes(license.replace(/\s/g, "")));
    } finally {
      await dashboard.stop();
    }
  }
});
test("inventory keeps full resource context available across viewport sizes", async () => {
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
  const ansi = /\x1b\[[0-?]*[ -/]*[@-~]/g;
  const wideFrame = await captureDashboardFrame([resource]);
  const widePlain = wideFrame.replace(ansi, "");
  const wideRow = widePlain.split(/\r?\n/).find((line) => line.includes(id));
  assert.ok(wideRow, "inventory row should show the complete resource ID");
  assert.ok(wideRow.length >= 70, "inventory columns should use most of the list panel width");
  assert.ok(widePlain.includes(`CATALOG ${catalog}`), "catalog stays in selection details");
  const largeResource = {
    ...resource,
    category: "Release Engineering",
    tags: ["automation", "deployments"],
    use_when: "Prepare production releases.",
    example: "Run release checks.",
    prerequisites: ["Release approval", "Git access"],
  };
  const dashboard = await startInteractiveDashboard([largeResource], {}, { columns: 120, rows: 60 });
  let largeFrame = "";
  try {
    await dashboard.wait((frame) => frame.includes("SELECTION DETAILS") && frame.includes(id),
      "selected Inventory details before reading context pages");
    let frame = dashboard.frame();
    const compactText = (value) => value.replace(ansi, "").replace(/│/g, "").replace(/\s/g, "");
    for (let page = 0; page < 8; page += 1) {
      const current = compactText(frame);
      largeFrame += current;
      if ([id, "ReleaseEngineering", "USEWHEN", "Runreleasechecks.", "PREREQUISITES"]
        .every((value) => largeFrame.includes(value))) break;
      const previousDetails = selectedDetailsFrame(frame);
      dashboard.input.write("\u001b[6~");
      try {
        frame = await dashboard.wait((next) => selectedDetailsFrame(next) !== previousDetails,
          "Inventory PageDown context content");
      } catch (error) {
        if (error instanceof Error && error.message === "Timed out waiting for Inventory PageDown context content") break;
        throw error;
      }
    }
  } finally {
    await dashboard.stop();
  }
  assert.ok(largeFrame.includes(id));
  assert.ok(largeFrame.includes("ReleaseEngineering"));
  assert.ok(largeFrame.includes("USEWHEN"));
  assert.ok(largeFrame.includes("Runreleasechecks."));
  assert.ok(largeFrame.includes("PREREQUISITES"));

  const narrowFrame = await captureDashboardFrame(
    [{ ...largeResource, id: "short-id" }],
    {},
    [],
    { columns: 56, rows: 56 },
  );
  const narrowPlain = narrowFrame.replace(ansi, "");
  const narrowHeader = narrowPlain.split(/\r?\n/).find((line) => line.includes("STATUS") && line.includes("SCOPE"));
  assert.ok(narrowHeader);
  assert.equal(narrowHeader.includes("CATALOG"), false);
  assert.ok(narrowPlain.includes("short-id"));
  assert.ok(narrowPlain.includes("PgUp/PgDn"), "clipped metadata exposes its detail paging hint");
});
test("inventory columns align in the joined workspace at 80, 120, and 160 columns", async () => {
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
  const ansi = /\x1b\[[0-?]*[ -/]*[@-~]/g;
  for (const dimensions of [
    { columns: 80, rows: 56 },
    { columns: 120, rows: 60 },
    { columns: 160, rows: 60 },
  ]) {
    const plain = (await captureDashboardFrame([resource], {}, [], dimensions)).replace(ansi, "");
    const lines = plain.split(/\r?\n/);
    assert.ok(plain.includes("INSTALLED RESOURCES"));
    assert.ok(plain.includes("Search resources"));
    assert.ok(plain.includes(`CATALOG ${catalog}`));
    const header = lines.find((line) =>
      line.includes("RESOURCE") && line.includes("KIND") && line.includes("SCOPE") && line.includes("STATUS"));
    const row = lines.find((line) => line.includes(id) && line.includes("project"));
    assert.ok(header && row, `inventory row should render at ${dimensions.columns} columns`);
    assert.equal(header.indexOf("RESOURCE"), row.indexOf(id));
    assert.equal(header.indexOf("KIND"), row.indexOf("skill"));
    assert.equal(header.indexOf("SCOPE"), row.indexOf("project"));
    assert.equal(header.indexOf("STATUS"), row.indexOf("Current"));
    const innerWidth = dimensions.columns - 4;
    const listWidth = dimensions.columns >= 94 ? Math.floor((innerWidth - 1) * 0.76) : innerWidth;
    assert.ok(row.length >= listWidth + 2, "table rows should fill the list column");
  }
});
test("Browse and Catalogs keep their table and card hierarchies at desktop and compact sizes", async () => {
  const dimensions = [
    { columns: 80, rows: 56 },
    { columns: 120, rows: 60 },
    { columns: 160, rows: 40 },
    { columns: 47, rows: 60 },
  ];
  const candidate = {
    catalog: "platform-team",
    kind: "skill",
    id: "assistant-helper",
    description: "A reusable assistant workflow that prepares consistent release notes from repository changes.",
    source_repository: "example/platform-team",
    source_path: "skills/assistant-helper",
    source_ref: "a".repeat(40),
  };
  const catalogActions = {
    catalogResources: [candidate],
    userCatalogs: [{ name: "platform-team", repository: "example/platform-team" }],
    execute: async () => ({ code: 0, resources: [] }),
    addCatalog: async () => ({}),
    updateCatalog: async () => ({}),
    refreshCatalog: async () => ({}),
    removeCatalog: async () => ({}),
    transferCatalogs: async () => ({}),
    checkCatalogFreshness: async () => [],
  };
  const ansi = /\x1b\[[0-?]*[ -/]*[@-~]/g;
  for (const size of dimensions) {
    const browseFrame = await captureDashboardFrame([], catalogActions, ["2"], size);
    const browsePlain = browseFrame.replace(ansi, "");
    const browseLines = browsePlain.split(/\r?\n/);
    assert.ok(browsePlain.includes("CATALOG RESOURCES"));
    assert.ok(["PROJECT", "USER", "UPDATES"].every((label) => browsePlain.includes(label)));
    assert.ok(browsePlain.includes("Search resources"));
    const browseHeader = browseLines.find((line) =>
      line.includes("RESOURCE") && line.includes("KIND") && line.includes("CATALOG") && /INST(?:ALLED|\.\.\.)/.test(line));
    const browseHeaderIndex = browseLines.indexOf(browseHeader);
    const browseRow = browseLines.slice(browseHeaderIndex + 1).find((line) => line.includes("›"));
    assert.ok(browseHeader && browseRow,
      `Browse row should render at ${size.columns} columns`);
    assert.ok(browseHeader.indexOf("RESOURCE") < browseHeader.indexOf("KIND") &&
      browseHeader.indexOf("KIND") < browseHeader.indexOf("CATALOG"), "Browse columns keep their visible order");
    if (size.columns >= 80) {
      assert.ok(browseRow.includes(candidate.id), "the resource column remains available when space allows");
      assert.equal(browseHeader.indexOf("RESOURCE"), browseRow.indexOf(candidate.id));
      assert.ok(browseRow.includes(candidate.kind));
      assert.equal(browseHeader.indexOf("KIND"), browseRow.indexOf(candidate.kind));
      assert.ok(browseRow.includes(candidate.catalog), "the catalog column remains available when space allows");
      assert.equal(browseHeader.indexOf("CATALOG"), browseRow.indexOf(candidate.catalog));
    } else {
      assert.ok(browseRow.includes("..."), "compact cells indicate values are truncated rather than lost");
    }
    assert.ok(browsePlain.includes(candidate.id) && browsePlain.includes(candidate.catalog),
      "Selection Details keep complete resource identity visible in compact mode");
    assert.ok(browsePlain.includes("SELECTION DETAILS"));
    assert.ok(browsePlain.includes("PINNED SOURCE"));
    const browseListWidth = size.columns >= 94 ? Math.floor((size.columns - 5) * 0.76) : size.columns - 4;
    assert.ok(browseRow.length >= browseListWidth + 2, "Browse rows should fill the list column");

    const catalogFrame = await captureDashboardFrame([], catalogActions, ["3"], size);
    const catalogPlain = catalogFrame.replace(ansi, "");
    assert.ok(catalogPlain.includes("CONNECTED CATALOGS 1"));
    assert.ok(["PROJECT", "USER", "UPDATES"].every((label) => catalogPlain.includes(label)));
    assert.ok(catalogPlain.includes("platform-team"));
    assert.ok(catalogPlain.includes("example/platform-team"));
    assert.ok(catalogPlain.includes("Add catalog"));
    assert.ok(catalogPlain.includes("Edit"));
    assert.ok(catalogPlain.includes("Refresh"));
    assert.ok(catalogPlain.includes("Remove"));
    assert.equal(catalogPlain.split(/\r?\n/).length, size.rows,
      `Catalogs should remain inside the ${size.columns}×${size.rows} terminal`);
  }
});

test("Browse details and Catalogs cards keep long resource values readable as the viewport grows", async () => {
  const source = "platform-engineering-team";
  const id = "deployment-automation-assistant";
  const repository = "github.com/platform-engineering/automation-catalog";
  const candidate = {
    catalog: source, kind: "instruction", id, source_repository: "example/platform",
    source_path: "instructions/deploy.md", source_ref: "a".repeat(40),
  };
  const ansi = /\x1b\[[0-?]*[ -/]*[@-~]/g;
  for (const columns of [80, 120, 160]) {
    const size = { columns, rows: columns === 160 ? 40 : 60 };
    const browser = (await captureDashboardFrame([], { catalogResources: [candidate] }, ["2"], size)).replace(ansi, "");
    assert.ok(browser.includes("RESOURCE") && browser.includes("KIND"));
    const compactBrowser = browser.replace(/\s/g, "");
    assert.ok(compactBrowser.includes(id), `full resource ID remains available in Browse details at ${columns}`);
    assert.ok(compactBrowser.includes(source), `catalog identity remains available at ${columns}`);

    const managementActions = { userCatalogs: [{ name: source, repository }] };
    const management = (await captureDashboardFrame([], managementActions, ["m"], size)).replace(ansi, "");
    assert.ok(management.includes("CONNECTED CATALOGS 1"));
    const compactManagement = management.replace(/\s/g, "");
    assert.ok(compactManagement.includes(source), `catalog name should remain visible at ${columns}`);
    assert.ok(compactManagement.includes(repository), `catalog repository should remain visible at ${columns}`);
  }
});

test("dashboard lists widen when detail columns are hidden", async () => {
  const size = { columns: 160, rows: 60 };
  const resource = {
    catalog: "platform-team", kind: "skill", id: "assistant-helper",
    scope: "project", status: "current", source_repository: "example/platform-team",
    source_path: "skills/assistant-helper", source_ref: "a".repeat(40),
  };
  for (const entry of [
    { resources: [resource], actions: {}, keys: [], label: "INVENTORY" },
    { resources: [], actions: { catalogResources: [resource] }, keys: ["2"], label: "CATALOG RESOURCES" },
  ]) {
    const withDetails = (await captureDashboardFrame(entry.resources, entry.actions, entry.keys, size))
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
    const withoutDetails = (await captureDashboardFrame(entry.resources, entry.actions, [...entry.keys, "d"], size))
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
    const header = (frame) => frame.split(/\r?\n/).find((line) => entry.resources.length
      ? /RESOURCE\s+KIND\s+SCOPE\s+STATUS/.test(line)
      : /RESOURCE\s+KIND\s+CATALOG\s+INSTALLED/.test(line));
    assert.ok(withDetails.includes(entry.label) && withoutDetails.includes(entry.label));
    const splitHeader = header(withDetails);
    const fullHeader = header(withoutDetails);
    assert.ok(splitHeader && fullHeader, `${entry.label} header should render in both modes`);
    assert.ok(fullHeader.indexOf("KIND") > splitHeader.indexOf("KIND"),
      `${entry.label} gives its resource column more room when details are hidden`);
  }

  const actions = { userCatalogs: [{ name: "tooling", repository: "example/tool-catalog" }] };
  const withDetails = await captureDashboardFrame([], actions, ["m"], size);
  const withoutDetails = await captureDashboardFrame([], actions, ["m", "d"], size);
  assert.ok(withDetails.includes("Refresh updates metadata only"));
  assert.ok(!withoutDetails.includes("Refresh updates metadata only"), "D hides Catalogs details");
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
  await waitForOutput(output, () => rendered, (text) => text.includes("\u001b[?2026l"),
    "the initial dashboard frame");
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
test("inventory detail pages preserve update paths and keep shortcuts inside short layouts", async () => {
  const path = ".agents/skills/engineering/a-resource-with-a-deliberately-long-name/SKILL.md";
  const issue = `Update available: ${path}`;
  const resource = {
    catalog: "engineering",
    kind: "skill",
    id: "long-update",
    scope: "project",
    status: "attention",
    issues: [{ code: "UPDATE_AVAILABLE", paths: [path] }],
  };
  const strip = (frame) => frame.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b\]8;;/g, "").replace(/\u001b\\/g, "").replace(/│/g, "");
  for (const { columns, rows } of [{ columns: 40, rows: 36 }, { columns: 100, rows: 56 }]) {
    const dashboard = await startInteractiveDashboard([resource], {}, { columns, rows });
    try {
      let frame = dashboard.frame();
      let allPages = "";
      for (let page = 0; page < 8; page += 1) {
        allPages += strip(frame).replace(/\s/g, "");
        if (allPages.includes(issue.replace(/\s/g, ""))) break;
        const previousDetails = selectedDetailsFrame(frame);
        dashboard.input.write("\u001b[6~");
        try {
          frame = await dashboard.wait((next) => selectedDetailsFrame(next) !== previousDetails,
            "update path detail page");
        } catch (error) {
          if (error instanceof Error && error.message === "Timed out waiting for update path detail page") break;
          throw error;
        }
      }
      allPages += strip(frame).replace(/\s/g, "");
      assert.ok(allPages.includes(issue.replace(/\s/g, "")),
        `complete update path remains available at ${columns}x${rows}`);
      const frameLines = frame.split(/\r?\n/);
      assert.equal(frameLines.length, rows, `the rendered frame should occupy ${rows} rows`);
      assert.ok(frame.includes("1/2/3 sections") && frame.includes("F filter"),
        "section and filter navigation stay visible");
      assert.match(frameLines[rows - 1], /Q quit/, "the horizontal footer stays bottom-anchored");
      if (columns === 40) {
        assert.ok(frame.includes("PROJECT") && frame.includes("USER") && frame.includes("UPDATES"),
          "short layouts retain compact summary cards");
      }
    } finally {
      await dashboard.stop();
    }
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
  const waitForFrame = (predicate, description) =>
    waitForOutput(output, latestFrame, predicate, `dashboard ${description}`);

  try {
    await waitForFrame((frame) => frame.includes("↑↓ navigate"), "the Inventory screen");
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
      frame.includes("Update complete") && frame.includes("Current"), "the successful update result");
    assert.equal(executions.length, 1);
    assert.equal(executions[0][0], "update");
    assert.deepEqual(executions[0][1], resource);
    assert.equal(executions[0][2].scope, undefined);
    assert.equal(executions[0][2].tool, undefined);
    assert.equal(typeof executions[0][2].onProgress, "function");
    assert.ok(completed.includes("Current"), "the returned refreshed resource replaces its old status");
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
  const waitForFrame = (predicate, description) =>
    waitForOutput(output, latestFrame, predicate, `dashboard ${description}`);

  try {
    await waitForFrame((frame) => frame.includes("↑↓ navigate"), "the Inventory screen");
    input.write("u");
    const confirmation = await waitForFrame((frame) => frame.includes("CONFIRM UPDATE"),
      "the update confirmation");
    assert.ok(confirmation.includes("‹ UPDATE ›"), "Update is selected by default");
    assert.equal(executions.length, 0, "U must not execute before confirmation");

    input.write("\r");
    const completed = await waitForFrame((frame) =>
      frame.includes("Update complete") && frame.includes("Current"), "the successful update result");
    assert.equal(executions.length, 1);
    assert.equal(executions[0][0], "update");
    assert.deepEqual(executions[0][1], resource);
    assert.equal(executions[0][2].scope, undefined);
    assert.equal(executions[0][2].tool, undefined);
    assert.equal(typeof executions[0][2].onProgress, "function");
    assert.ok(completed.includes("Update complete"));
    assert.ok(completed.includes("Current"), "the refreshed resource replaces its old status");
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
      const waitForFrame = (predicate, label) =>
        waitForOutput(output, latestFrame, predicate, `dashboard ${label}`);

      try {
        await waitForFrame((frame) => frame.includes("↑↓ navigate"), "inventory");
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
          assert.ok(promptText.includes("already installed"), `missing installation reason: ${promptText}`);
          assert.ok(promptText.includes("requires"), `missing GH force requirement: ${promptText}`);
          assert.ok(promptText.includes("--force"), `missing explicit force flag: ${promptText}`);
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
        assert.equal(calls[0][2].scope, undefined);
        assert.equal(calls[0][2].tool, undefined);
        assert.equal(typeof calls[0][2].onProgress, "function");

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
            assert.ok(nextPromptText.includes("already installed"), `missing second-agent reason: ${nextPromptText}`);
            assert.ok(nextPromptText.includes("requires"), `missing second-agent force requirement: ${nextPromptText}`);
            assert.ok(nextPromptText.includes("--force"), `missing second-agent force flag: ${nextPromptText}`);
            assert.equal(calls.length, 2);
            const { onProgress: firstProgress, ...firstRetryOptions } = calls[1][2];
            assert.equal(typeof firstProgress, "function");
            assert.deepEqual(firstRetryOptions, {
              scope: undefined, tool: undefined, ghForce: true, ghForceAgent: "github-copilot",
            });
            input.write("\x1b[C");
            await waitForFrame((frame) => frame.includes("‹ YES, RETRY WITH --FORCE ›"), "second agent force selection");
            input.write("\r");
            await waitForFrame((frame) => frame.replace(/[│]/g, " ").replace(/\s+/g, " ").includes("Update complete"),
              "second agent forced update");
            assert.equal(calls.length, 3);
            const { onProgress: secondProgress, ...secondRetryOptions } = calls[2][2];
            assert.equal(typeof secondProgress, "function");
            assert.deepEqual(secondRetryOptions, {
              scope: undefined, tool: undefined, ghForce: true, ghForceAgent: "claude-code",
            });
            input.write("q");
            assert.equal(await done, true);
          } else if (category === "github-repeated-agent") {
            const failure = await waitForFrame((frame) => frame.includes("UPDATE FAILED"), "same-agent retry failure");
            assert.ok(!failure.includes("GH REQUESTS OVERWRITE"), "the same agent must not get an endless force prompt");
            assert.equal(calls.length, 2);
            input.write("\x1b");
            await waitForFrame((frame) => frame.includes("INVENTORY") && frame.includes("↑↓ navigate") &&
              !frame.includes("UPDATE FAILED"), "dismissed same-agent failure");
            input.write("q");
            assert.equal(await done, false);
          } else {
            await waitForFrame((frame) => frame.replace(/[│]/g, " ").replace(/\s+/g, " ").includes("Update complete"),
              "forced update result");
            assert.equal(calls.length, 2);
            const { onProgress: retryProgress, ...retryOptions } = calls[1][2];
            assert.equal(typeof retryProgress, "function");
            assert.deepEqual(retryOptions, ghForceRequired
              ? { scope: undefined, tool: undefined, ghForce: true, ghForceAgent: "github-copilot" }
              : { scope: undefined, tool: undefined, force: true });
            input.write("q");
            assert.equal(await done, true);
          }
        } else {
          input.write(response === "escape" ? "\x1b" : "\r");
          await waitForFrame((frame) => frame.includes("INVENTORY") && frame.includes("↑↓ navigate") &&
            !frame.includes(promptTitle), "cancelled force prompt");
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
    const waitForFrame = (predicate, description) =>
      waitForOutput(output, latestFrame, predicate, `dashboard ${description}`);
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
      await waitForFrame((frame) => frame.includes("↑↓ navigate"), "the Inventory screen");
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
        !frame.includes("UPDATE FAILED") && frame.includes("INVENTORY"),
      "the dashboard after dismissing the error");
      assert.ok(dismissed.includes("INVENTORY"));
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


test("joined Inventory keeps row selection geometry stable across detail lengths", async () => {
  const resources = [
    { catalog: "sample", kind: "skill", id: "short-detail", scope: "project", status: "current", description: "Short." },
    {
      catalog: "sample", kind: "skill", id: "long-detail", scope: "project", status: "update",
      issues: [{ code: "UPDATE_AVAILABLE", paths: [".agents/skills/example/SKILL.md"] }],
      description: "Long description for the selected resource. ".repeat(5),
    },
    ...["third", "fourth", "fifth"].map((id) => ({
      catalog: "sample", kind: "skill", id, scope: "project", status: "current",
    })),
  ];
  const dimensions = { columns: 120, rows: 56 };
  const ansi = /\x1b\[[0-?]*[ -/]*[@-~]/g;
  const visibleInventory = (frame) => {
    const plain = frame.replace(ansi, "");
    const lines = plain.split(/\r?\n/);
    const tableHeader = lines.find((line) => line.includes("RESOURCE") && line.includes("STATUS"));
    const rowLines = lines.filter((line) => line.includes("project") &&
      ["short-detail", "long-detail", "third", "fourth", "fifth"].some((id) => line.includes(id)));
    const heading = lines.findIndex((line) => line.includes("INSTALLED RESOURCES"));
    const detailsHeading = lines.findIndex((line) => line.includes("SELECTION DETAILS"));
    return {
      ids: rowLines.map((line) => ["short-detail", "long-detail", "third", "fourth", "fifth"]
        .find((id) => line.includes(id))),
      height: lines.length,
      heading,
      detailsHeading,
      tableHeader,
      bottomShortcut: lines.at(-1),
      plain,
    };
  };
  const shortFrame = await captureDashboardFrame(resources, {}, [], dimensions);
  const longFrame = await captureDashboardFrame(resources, {}, ["\x1b[B"], dimensions);
  const shortViewport = visibleInventory(shortFrame);
  const longViewport = visibleInventory(longFrame);
  assert.deepEqual(longViewport.ids, shortViewport.ids,
    "changing selected details must not move or resize the list rows");
  assert.deepEqual(shortViewport.ids, ["short-detail", "long-detail", "third", "fourth", "fifth"]);
  for (const viewport of [shortViewport, longViewport]) {
    assert.equal(viewport.height, dimensions.rows);
    assert.equal(viewport.heading, viewport.detailsHeading,
      "list and details headings share the same joined workspace row");
    assert.ok(viewport.tableHeader.includes("RESOURCE") && viewport.tableHeader.includes("STATUS"));
    assert.ok(viewport.bottomShortcut.includes("Q quit"), "the horizontal footer stays bottom-anchored");
  }

  const extremeDetails = resources.map((resource) => resource.id === "long-detail"
    ? { ...resource, description: "Long description for the selected resource. ".repeat(25) }
    : resource);
  const extremeFrame = await captureDashboardFrame(extremeDetails, {}, ["\x1b[B"], dimensions);
  assert.deepEqual(visibleInventory(extremeFrame).ids, shortViewport.ids,
    "very long selected details must leave row count and selection geometry unchanged");
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
  await waitForOutput(output, () => rendered, (text) =>
    text.includes("A install") && text.includes("\u001b[?2026l"), "initial horizontal shortcuts footer");
  input.write("q");
  assert.equal(await done, true);
  input.destroy();
  output.destroy();

  const plain = rendered.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  for (const shortcut of ["A install", "U update", "Delete uninstall",
    "1/2/3 sections", "M catalogs", "F filter", "C catalog", "K kind", "D details", "↑↓ navigate",
    "? guide", "Q quit"]) {
    assert.ok(plain.includes(shortcut), `missing rendered shortcut: ${shortcut}`);
  }
  assert.ok(plain.includes("INVENTORY"));
  assert.ok(plain.includes("Update available:"));
});

test("Inventory omits action shortcuts that are unavailable in this inventory", async () => {
  const frame = await captureDashboardFrame([], {}, [], { columns: 120, rows: 40 });
  assert.ok(!frame.includes("A install"));
  assert.ok(!frame.includes("U update"));
  assert.ok(!frame.includes("Delete uninstall"));
});

test("all dashboard modes show visible shortcuts for active controls", async () => {
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
  assert.ok(inventory.includes("A install"));
  assert.ok(inventory.includes("M catalogs"));
  assert.ok(inventory.includes("1/2/3 sections"));

  const catalog = await captureDashboardFrame([], actions, ["2"], compactDimensions);
  assert.ok(catalog.includes("ENTER install"));
  assert.ok(catalog.includes("C catalog"));
  assert.ok(catalog.includes("1/2/3 sections"));
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
  for (const shortcut of ["1/2/3 sections", "A add", "P presets", "Delete remove", "E edit",
    "R refresh", "I import", "X export", "D details", "ESC inventory"]) {
    assert.ok(catalogManagement.includes(shortcut), `missing management shortcut: ${shortcut}`);
  }
});

test("Catalogs cards, actions, and shortcuts stay reachable in short and narrow terminals", async () => {
  const catalogs = Array.from({ length: 5 }, (_, index) => ({
    name: `catalog-${index}`,
    repository: `example/catalog-${index}`,
  }));
  const actions = {
    userCatalogs: catalogs,
    addCatalog: async () => ({}),
    removeCatalog: async () => ({}),
    updateCatalog: async () => ({}),
    refreshCatalog: async () => ({}),
    transferCatalogs: async () => ({}),
  };
  for (const dimensions of [
    { columns: 120, rows: 56 },
    { columns: 160, rows: 40 },
    { columns: 47, rows: 60 },
  ]) {
    const frame = await captureDashboardFrame([], actions, ["3"], dimensions);
    const plain = frame.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
    const lines = plain.split(/\r?\n/);
    assert.equal(lines.length, dimensions.rows, `Catalogs stays within ${dimensions.columns}×${dimensions.rows}`);
    assert.ok(plain.includes("CONNECTED CATALOGS 5"));
    assert.ok(["PROJECT", "USER", "UPDATES"].every((label) => plain.includes(label)));
    assert.ok(plain.includes("catalog-0") && plain.includes("example/catalog-0"));
    assert.ok(plain.includes("FRESHNESS UNKNOWN"));
    assert.ok(["Edit", "Refresh", "Remove"].every((label) => plain.includes(label)));
    for (const shortcut of ["A add", "P presets", "Delete remove", "E edit", "R refresh",
      "I import", "X export", "D details", "ESC inventory", "Q quit"]) {
      assert.ok(plain.includes(shortcut), `missing Catalogs shortcut at ${dimensions.columns}: ${shortcut}`);
    }
    assert.ok(lines.every((line) => line.length <= dimensions.columns),
      `Catalogs content should not wrap beyond ${dimensions.columns} columns`);
  }
});

test("Catalogs mouse selection scopes card actions and blocks background clicks behind modals", async (t) => {
  const activeDashboards = new Set();
  const stopDashboard = async (dashboard) => {
    await dashboard.stop();
    activeDashboards.delete(dashboard);
  };
  t.after(async () => {
    await Promise.all(Array.from(activeDashboards, (dashboard) => dashboard.stop()));
  });
  const catalogs = [
    { name: "alpha", repository: "example/alpha" },
    { name: "beta", repository: "example/beta" },
  ];
  const actions = {
    userCatalogs: catalogs,
    addCatalog: async () => ({}),
    updateCatalog: async () => ({}),
    refreshCatalog: async () => ({}),
    removeCatalog: async () => ({}),
    checkCatalogFreshness: async () => [],
  };
  for (const { columns, rows, selectBeta, hideDetails, label } of [
    { columns: 160, rows: 40, selectBeta: true, hideDetails: false, label: "desktop" },
    { columns: 80, rows: 40, selectBeta: true, hideDetails: false, label: "compact" },
    { columns: 80, rows: 40, selectBeta: false, hideDetails: true, label: "compact without details" },
  ]) {
    const dashboard = await startInteractiveDashboard([], actions, { columns, rows });
    activeDashboards.add(dashboard);
    const waitForTarget = async (matches) => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        if (dashboard.mouse.getRegions().some(({ target }) => matches(target))) return;
        await new Promise((resolve) => setImmediate(resolve));
      }
      assert.fail(`the rendered Catalogs control did not register its mouse region at ${columns} columns`);
    };
    const assertActionCell = (click, action) => {
      assert.ok(click.overlappingRegions.some(({ target }) => target.type === "action" && target.action === action),
        `${action} must own its rendered cell at ${columns} columns`);
      assert.ok(!click.overlappingRegions.some(({ target }) => target.type === "row"),
        `${action} cell must not overlap a card row at ${columns} columns: ${JSON.stringify(click.overlappingRegions)}`);
    };
    try {
      clickRenderedTarget(dashboard,
        (target) => target.type === "section" && target.section === "catalogs", "Catalogs 2");
      await dashboard.wait((frame) => frame.includes("CONNECTED CATALOGS 2"), `Catalogs ${label} after tab click`);
      if (hideDetails) {
        dashboard.input.write("d");
        await dashboard.wait((frame) => !frame.includes("FRESHNESS UNKNOWN"), "selected card details hidden");
      }
      const selectedCatalog = selectBeta ? "beta" : "alpha";
      const alphaCell = selectBeta ? renderedTextCell(dashboard.frame(), "alpha") : undefined;
      if (selectBeta) {
        const rowClick = clickRenderedTarget(dashboard,
          (target) => target.type === "row" && target.screen === "catalogs" && target.index === 1, "beta");
        assert.ok(rowClick.overlappingRegions.some(({ target }) => target.type === "row" && target.index === 1));
        assert.ok(rowClick.overlappingRegions.every(({ target }) => target.type === "row"),
          "a non-action card cell remains a row-selection target");
      }
      await waitForTarget((target) => target.type === "action" && target.action === "edit-catalog");

      for (const rowOffset of [-1, 0, 1]) {
        const editClick = clickRenderedButtonRow(dashboard,
          (target) => target.type === "action" && target.action === "edit-catalog", "Edit", rowOffset);
        assertActionCell(editClick, "edit-catalog");
        await dashboard.wait((frame) => frame.includes("EDIT CATALOG") && frame.includes(selectedCatalog),
          `Edit button row ${rowOffset} belongs to ${selectedCatalog} at ${label}`);
        if (rowOffset === -1 && alphaCell) {
          clickAt(dashboard.input, alphaCell);
          await dashboard.wait((frame) => frame.includes("EDIT CATALOG") && frame.includes("beta"),
            "background card click is gated by the modal");
        }
        dashboard.input.write("\u001b");
        await dashboard.wait((frame) => !frame.includes("EDIT CATALOG") && frame.includes("CONNECTED CATALOGS 2"),
          "Edit modal closes without changing the selected catalog");
        await waitForTarget((target) => target.type === "action" && target.action === "edit-catalog");
      }

      for (const rowOffset of [-1, 0, 1]) {
        const refreshClick = clickRenderedButtonRow(dashboard,
          (target) => target.type === "action" && target.action === "refresh-catalog", "│ Refresh │", rowOffset);
        assertActionCell(refreshClick, "refresh-catalog");
        await dashboard.wait((frame) => frame.includes("REFRESH CATALOGS"), `Refresh button row ${rowOffset} action`);
        dashboard.input.write("\u001b");
        await dashboard.wait((frame) => !frame.includes("REFRESH CATALOGS"), "Refresh modal closes");
        await waitForTarget((target) => target.type === "action" && target.action === "refresh-catalog");
      }

      for (const rowOffset of [-1, 0, 1]) {
        const removeClick = clickRenderedButtonRow(dashboard,
          (target) => target.type === "action" && target.action === "remove-catalog", "Remove", rowOffset);
        assertActionCell(removeClick, "remove-catalog");
        await dashboard.wait((frame) => frame.includes("REMOVE CATALOG"), `Remove button row ${rowOffset} action`);
        dashboard.input.write("\u001b");
        await dashboard.wait((frame) => !frame.includes("REMOVE CATALOG"), "Remove selection closes safely");
        await waitForTarget((target) => target.type === "action" && target.action === "remove-catalog");
      }
    } finally {
      await stopDashboard(dashboard);
    }
  }

  const emptyDashboard = await startInteractiveDashboard([], {
    addCatalog: async () => ({}),
  }, { columns: 80, rows: 40 });
  activeDashboards.add(emptyDashboard);
  try {
    clickRenderedTarget(emptyDashboard,
      (target) => target.type === "section" && target.section === "catalogs", "Catalogs 0");
    await emptyDashboard.wait((frame) => frame.includes("Connect a source"), "empty Catalogs state");
    await new Promise((resolve) => setImmediate(resolve));
    clickRenderedTarget(emptyDashboard,
      (target) => target.type === "action" && target.action === "add-catalog", "Add catalog");
    await emptyDashboard.wait((frame) => frame.includes("ADD CATALOG") && frame.includes("Catalog name"),
      "Add action remains available for an empty catalog collection");
  } finally {
    await stopDashboard(emptyDashboard);
  }
});
