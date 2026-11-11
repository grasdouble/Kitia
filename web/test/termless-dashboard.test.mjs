import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { assertTermlessRuntime } = require("../scripts/screenshots-generator/termless-preflight.js");
const {
  closeShowcaseDashboard,
  launchShowcaseDashboard,
  screenshotOptions,
  screenshotViewport,
  terminalSize,
  waitForInkOutput,
} = require("../scripts/screenshots-generator/site-showcase-terminal.js");


assertTermlessRuntime();

function assertSourceHeader(session, filename, firstContent, pageCount) {
  const title = session.terminal.findText(`PAGE 1/${pageCount}`);
  const file = session.terminal.findText(`FILE ${filename}`);
  const body = session.terminal.findText(firstContent);
  assert.ok(title && file && body,
    `source title, filename and body remain visible (PAGE 1/${pageCount}):\n${session.terminal.screen.getText()}`);
  assert.equal(file.row, title.row + 1, "filename belongs to the source header");
  assert.equal(body.row, file.row + 2, "the body starts below the header divider");
  const divider = session.terminal.screen.getText().split("\n")[file.row + 1];
  assert.equal(divider.slice(file.col, file.col + 8), "────────",
    "a theme-colored horizontal rule separates metadata from source content");
}

async function dashboardExit(session) {
  for (let attempt = 0; attempt < 50 && !session.doneSettled; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(session.doneSettled, "dashboard exit completes within one second");
  return session.done;
}

async function waitForGrid(session, predicate, message) {
  let grid = "";
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await session.flushTerminal();
    grid = session.terminal.screen.getText();
    if (predicate(grid)) return grid;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`${message}\n${grid}`);
}

async function assertSeparatedHeader(session, title, firstContent, pageLabel, metadata = []) {
  let header;
  const matches = (content, expected) => expected instanceof RegExp
    ? expected.test(content) : content.startsWith(expected);
  await waitForGrid(session, (grid) => {
    const lines = grid.split("\n");
    const row = lines.findIndex((line, index) => {
      const titleCol = line.indexOf(title);
      const col = titleCol >= 2 && line.slice(titleCol - 2, titleCol) === "› " ? titleCol - 2 : titleCol;
      const right = line.indexOf("│", col);
      const content = (offset) => lines[index + offset]?.slice(col, right).trimEnd();
      return col >= 0 && right > col &&
        metadata.every((expected, offset) => expected instanceof RegExp
          ? expected.test(content(offset + 1) || "") : content(offset + 1) === expected) &&
        /^─+$/.test(content(metadata.length + 1) || "") &&
        matches((content(metadata.length + 2) || "").trimStart(), firstContent) &&
        (!pageLabel || line.includes(pageLabel));
    });
    header = row < 0 ? undefined : {
      row, col: lines[row].includes(`› ${title}`) ? lines[row].indexOf(`› ${title}`) : lines[row].indexOf(title),
      dividerRow: row + metadata.length + 1,
      bodyRow: row + metadata.length + 2,
    };
    return Boolean(header);
  }, `${title} keeps its title, preserved metadata, one divider and first body row visible`);
  assert.deepEqual(
    session.terminal.cell(header.dividerRow, header.col).fg,
    session.terminal.cell(header.row, header.col).fg,
    `${title} uses its existing title color for the divider`,
  );
  const lines = session.terminal.screen.getText().split("\n");
  const right = lines[header.row].indexOf("│", header.col);
  const bottom = lines.findIndex((line, index) => index > header.row && line[header.col - 2] === "└");
  assert.ok(bottom > header.bodyRow, `${title} keeps its complete frame visible`);
  const rules = lines.slice(header.row + 1, bottom).filter((line) =>
    /^─+$/.test(line.slice(header.col, right).trimEnd()));
  assert.equal(rules.length, 1, `${title} has exactly one header divider`);
  return header;
}

async function assertShortcutsFrame(session, hints) {
  await waitForGrid(session, (grid) => {
    const lines = grid.split("\n");
    const row = lines.findIndex((line, index) => {
      const col = line.indexOf("SHORTCUTS");
      return col >= 0 && lines[index + 1]?.slice(col, col + 8) === "────────" &&
        lines[index + 2]?.includes(hints[0]);
    });
    if (row < 0) return false;
    const col = lines[row].indexOf("SHORTCUTS");
    const left = col - 2;
    const right = lines[row].indexOf("│", col);
    const bottom = lines.findIndex((line, index) => index > row && line[left] === "└");
    if (right <= col || bottom <= row + 2) return false;
    const bodyRows = lines.slice(row + 2, bottom);
    if (!bodyRows.every((line) => line[left] === "│" && line[right] === "│")) return false;
    const body = bodyRows.map((line) => line.slice(col, right)).join(" ").replace(/\s+/g, "");
    return hints.every((hint) => body.includes(hint.replace(/\s+/g, "")));
  }, `SHORTCUTS retains its complete visible frame and full hints: ${hints.join(" · ")}`);
  await assertSeparatedHeader(session, "SHORTCUTS", hints[0]);
}

const screenShortcutHints = {
  "": ["A install", "V revision", "U update", "Delete uninstall", "M catalogs",
    "F filter", "C catalog", "K kind", "L license", "D details", "↑↓ navigate", "? guide", "Q quit"],
  a: ["F filter", "C catalog", "K kind", "L license", "V revisions",
    "P preview/audit", "D details", "↑↓ navigate", "ENTER install", "ESC back", "? guide", "Q quit"],
  // The showcase intentionally supplies no catalog-mutating action handlers.
  m: ["D details", "↑↓ nav", "? guide", "ESC inventory", "Q quit"],
};

async function assertTableSurface(session, key, {
  query = "", editing = false, license = "ALL", inventoryCount = query ? 1 : 3,
} = {}) {
  const title = key === "m" ? "CONNECTED CATALOGS" : key === "a" ? "CATALOG RESOURCES" : "INVENTORY";
  const filter = `Filter ${editing ? `${query}▏` : query || "(F to filter)"}`;
  const metadata = key === "m" ? [] : key === "a"
    ? [new RegExp(`^RESOURCES ${query ? 1 : 5}/5 · \\d-\\d$`),
      `${filter} · Catalog ALL · Kind ALL · License ${license}`]
    : [new RegExp(`^RESOURCES ${inventoryCount}/3 · \\d-\\d$`),
      `${filter} · Catalog ALL · Kind ALL · License ${license}`];
  const header = await assertSeparatedHeader(session, title,
    key === "m" ? "CATALOG" : key === "a" ? "INST" : "STATUS", undefined, metadata);
  const lines = session.terminal.screen.getText().split("\n");
  const right = lines[header.row].indexOf("│", header.col);
  const columns = lines[header.bodyRow].slice(header.col, right);
  for (const label of key === "m" ? ["CATALOG", "REPOSITORY", "RES", "INST", "FRESHNESS"]
    : key === "a" ? ["INST", "SOURCE", "KIND", "ID"]
    : ["STATUS", "SCOPE", "KIND", "ID", "CATALOG"]) {
    assert.ok(columns.includes(label), `${title} preserves its ${label} column:\n${columns}`);
  }
  const bottom = lines.findIndex((line, index) => index > header.bodyRow && line[header.col - 2] === "└");
  assert.ok(lines.slice(header.bodyRow + 1, bottom).some((line) =>
    line.slice(header.col, right).includes("›")),
    "the selected data row stays below the column headings");
  if (key === "m") {
    assert.match(lines[header.row], /CONNECTED CATALOGS 1/);
  } else {
    const filterRow = header.row + (key === "a" ? 2 : 2);
    assert.deepEqual(session.terminal.cell(filterRow, header.col).fg,
      key === "a" || !key && (editing || query)
        ? { r: 129, g: 162, b: 190 } : { r: 102, g: 102, b: 102 },
      "filter text colors are preserved above the divider");
    if (key === "a") {
      assert.deepEqual(session.terminal.cell(header.row + 3, header.col).fg, { r: 102, g: 102, b: 102 },
        "the catalog facet summary retains its muted color");
      const [, first, last] = lines[header.row].slice(header.col, right).match(/· (\d)-(\d)/);
      const dataRows = lines.slice(header.bodyRow + 1, bottom).map((line) =>
        line.slice(header.col, right)).filter((line) => /ask-matt|grill-me|plan-review|release-helper|review-guide/.test(line));
      assert.equal(Number(last) - Number(first) + 1, dataRows.length,
        "catalog header range matches rows below the headings");
      assert.ok(Number(first) >= 1 && Number(last) <= (query ? 1 : 5));
    }
  }
}

function assertSelectedRow(session, id, truncated = false) {
  const lines = session.terminal.screen.getText().split("\n");
  const row = lines.findIndex((line) => line.includes("›") &&
    (line.includes(id) || truncated && line.includes(id.slice(0, 3))));
  assert.notEqual(row, -1, `${id} retains the selected-row marker`);
  const label = truncated ? lines[row].slice(lines[row].indexOf("›") + 1).trimStart().split(/\s+/, 1)[0] : id;
  if (truncated) assert.ok(label === id || label.endsWith("...") && id.startsWith(label.slice(0, -3)),
    "the selected catalog retains its label or the existing width-limited prefix");
  for (const col of [lines[row].indexOf("›"), lines[row].indexOf(label)]) {
    assert.deepEqual(session.terminal.cell(row, col).fg, { r: 129, g: 162, b: 190 },
      `${id} retains blue selection highlighting`);
  }
}

test("Termless xterm consumes the real Ink dashboard and its stream-driven states", { timeout: 15000 }, async () => {
  assert.deepEqual(terminalSize, { columns: 120, rows: 45 });
  assert.deepEqual(screenshotViewport, { width: 1036, height: 788 });
  assert.equal(screenshotOptions.fontSize, 14);
  assert.equal(screenshotOptions.cellWidth, 1012 / 120);
  assert.equal(screenshotOptions.cellHeight, 764 / 45);
  assert.equal(screenshotOptions.padding, 12);
  assert.equal(screenshotOptions.margin, 0);
  assert.equal(screenshotOptions.scale, 1);
  const directory = await mkdtemp(path.join(os.tmpdir(), "kitia-termless-test-"));
  let session;
  try {
    session = await launchShowcaseDashboard(directory);
    const inventory = await waitForInkOutput(session, "ask-matt");
    await session.flushTerminal();
    const rawInventory = session.rawBytes().toString("utf8");
    const rows = inventory.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const resourceRows = rows.filter((line) =>
      ["ask-matt", "herdr", "grill-me"].some((id) => line.includes(id)) &&
      /(?:CURRENT|UNMANAGED)/.test(line) && /(?:PROJECT|USER)/.test(line));

    assert.equal(resourceRows.length, 3, "all three deterministic inventory rows are visible");
    assert.ok(resourceRows.some((line) =>
      /CURRENT.*PROJECT.*skill.*ask-matt.*MattPucock\[engineering\]/.test(line)));
    assert.ok(resourceRows.some((line) =>
      /UNMANAGED.*USER.*skill.*herdr/.test(line)));
    assert.ok(resourceRows.some((line) =>
      /CURRENT.*USER.*skill.*grill-me.*MattPucock\[productivity\]/.test(line)));
    assert.ok(inventory.includes("2 current") && inventory.includes("1 unmanaged"));
    assert.ok(rows.some((line) => line.includes("INVENTORY") && line.includes("SKILL - ask-matt")),
      "selected project details remain side-by-side at 120 columns");
    const normalizedInventory = inventory.replace(/\s+/g, "");
    for (const value of ["MattPucock[engineering]", "PROJECT", "[ CURRENT ]", "https://github.com/demo/skills", "4ae2317"]) {
      assert.ok(normalizedInventory.includes(value.replace(/\s+/g, "")), `selected ask-matt details include ${value}`);
    }
    assert.match(rawInventory, /\u001b\[(?:[0-9;]*;)?3[0-9]m/, "Ink emitted color for the inventory");

    const colorOf = (text) => {
      const match = session.terminal.findText(text);
      assert.ok(match, `${text} is present in the xterm grid`);
      return session.terminal.cell(match.row, match.col).fg;
    };
    assert.deepEqual(colorOf("INVENTORY"), { r: 139, g: 190, b: 183 });
    assert.deepEqual(colorOf("MANAGED"), { r: 180, g: 189, b: 105 });
    assert.deepEqual(colorOf("SKILL - ask-matt"), { r: 129, g: 162, b: 190 });
    await assertSeparatedHeader(session, "SKILL - ask-matt", "CATALOG");
    assertSelectedRow(session, "ask-matt");
    assert.deepEqual(colorOf("herdr"), { r: 180, g: 189, b: 105 },
      "an unselected skill keeps its kind color");
    assert.deepEqual(colorOf("Route repository questions"), { r: 102, g: 102, b: 102 });
    const panelCorner = Array.from({ length: terminalSize.rows }, (_, row) =>
      Array.from({ length: terminalSize.columns }, (_, col) => ({ row, col }))
        .find(({ row: cellRow, col: cellCol }) => session.terminal.cell(cellRow, cellCol).char === "┌"))
      .find(Boolean);
    assert.ok(panelCorner, "the xterm grid contains a panel corner");
    assert.equal(session.terminal.cell(panelCorner.row, panelCorner.col + 1).char, "─");
    assert.equal(session.terminal.cell(panelCorner.row + 1, panelCorner.col).char, "│");

    const xtermScreen = session.terminal.screen.getText();
    const xtermLines = xtermScreen.split(/\r?\n/).map((line) => line.trim());
    assert.ok(xtermLines.some((line) => /CURRENT.*PROJECT.*skill.*ask-matt.*MattPucock\[engineering\]/.test(line)));
    assert.ok(xtermLines.some((line) => /UNMANAGED.*USER.*skill.*herdr/.test(line)));
    assert.ok(xtermLines.some((line) => /CURRENT.*USER.*skill.*grill-me.*MattPucock\[productivity\]/.test(line)));
    assert.ok(xtermLines.some((line) => line.includes("INVENTORY") && line.includes("SKILL - ask-matt")));
    assert.ok(xtermScreen.includes("2 current") && xtermScreen.includes("1 unmanaged"));
    assert.ok(xtermScreen.includes("U update · Delete uninstall"),
      "the showcase exposes the production update and uninstall shortcuts");
    assert.ok(xtermScreen.includes("↑↓ navigate · ? guide · Q quit"),
      "the inventory footer keeps the production navigation and quit shortcuts visible");
    const updateStart = session.rawBytes().length;
    session.input.write("u");
    const updatePrompt = await waitForInkOutput(session, "CONFIRM UPDATE", updateStart);
    await session.flushTerminal();
    assert.ok(updatePrompt.includes("Update skill:ask-matt from project?"),
      "the advertised update key opens the real confirmation flow");
    await assertShortcutsFrame(session, ["←/→ CHOOSE", "ENTER CONFIRM", "Y/N SHORTCUTS"]);
    const cancelStart = session.rawBytes().length;
    session.input.write("\x1b");
    await waitForInkOutput(session, "INVENTORY", cancelStart);
    await session.flushTerminal();
    await waitForGrid(session, (grid) =>
      grid.includes("Route repository questions") && !grid.includes("CONFIRM UPDATE"),
      "the confirmation closes before inventory assertions");

    assert.ok(xtermScreen.includes("Route repository questions"),
      "the xterm.js backend consumes and exposes actual Ink dashboard output");
    const description = session.terminal.findText("Route repository");
    assert.ok(description, "the description is present in the xterm screen");
    assert.ok(session.terminal.cell(description.row, description.col).fg,
      "the xterm cell preserves ANSI foreground color");

    const catalogStart = session.rawBytes().length;
    session.input.write("a");
    const catalog = await waitForInkOutput(session, "CATALOG RESOURCES", catalogStart);
    await session.flushTerminal();
    const xtermCatalog = session.terminal.screen.getText();
    await assertSeparatedHeader(session, "SKILL - ask-matt", "CATALOG");
    assertSelectedRow(session, "ask-matt");
    for (const id of ["ask-matt", "grill-me", "plan-review", "release-helper", "review-guide"]) {
      assert.ok(xtermCatalog.includes(id), `xterm catalog screen contains ${id}`);
    }

    const returnStart = session.rawBytes().length;
    session.input.write("\x1b");
    const returned = await waitForInkOutput(session, "INVENTORY", returnStart);
    await session.flushTerminal();
    const xtermReturned = session.terminal.screen.getText();
    assert.ok(xtermReturned.includes("ask-matt") && xtermReturned.includes("INVENTORY"));
    assert.ok(returned.includes("ask-matt"), "Escape returns to the selected project resource");

    session.input.write("q");
    assert.equal(await dashboardExit(session), true, "q exits the Ink dashboard cleanly");
  } finally {
    if (session) await closeShowcaseDashboard(session);
    await rm(directory, { recursive: true, force: true });
  }
});

for (const { name, key, title, nextTitle, nextId } of [
  { name: "Inventory", key: "", title: "SKILL - ask-matt", nextTitle: "SKILL - herdr", nextId: "herdr" },
  { name: "catalog entry", key: "a", title: "SKILL - ask-matt", nextTitle: "SKILL - grill-me", nextId: "grill-me" },
  { name: "catalog management", key: "m", title: "CATALOG - MattPucock", nextTitle: "CATALOG - MattPucock", nextId: "MattPucock" },
]) {
  test(`Termless ${name} separates tables, details and shortcuts across resizing and navigation`, { timeout: 15000 }, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "kitia-termless-details-"));
    let session;
    try {
      session = await launchShowcaseDashboard(directory);
      await waitForGrid(session, (grid) => grid.includes("SKILL - ask-matt"),
        "the initial inventory selection reaches the visible grid");
      if (key) {
        session.input.write(key);
        await waitForGrid(session, (grid) => grid.includes(key === "a" ? "CATALOG RESOURCES" : "CONNECTED CATALOGS"),
          `${name} opens before resizing its selected details`);
      }
      for (const size of [
        terminalSize, { columns: 72, rows: 45 }, { columns: 120, rows: 36 }, terminalSize,
      ]) {
        session.terminal.resize(size.columns, size.rows);
        session.output.columns = size.columns;
        session.output.rows = size.rows;
        session.output.emit("resize");
        await waitForGrid(session, () => {
          const header = session.terminal.findText(title);
          return header && (size.columns < 112 ? header.col === 3 : header.col > 3);
        }, `${name} switches between stacked and side-by-side details`);
        const firstContent = key === "m" ? "REPOSITORY"
          : !key && size.rows < 40 ? "STATUS" : "CATALOG";
        await assertSeparatedHeader(session, title, firstContent);
        assertSelectedRow(session, key === "m" ? "MattPucock" : "ask-matt", key === "m");
        await assertTableSurface(session, key);
        await assertShortcutsFrame(session, screenShortcutHints[key]);
        const grid = session.terminal.screen.getText();
        assert.ok(!grid.includes("FILE ") && !/PAGE \d+\//.test(grid),
          "selected details do not acquire Preview-only filename or page labels");
        if (key === "m") {
          assert.ok(grid.includes("FRESHNESS") && grid.includes("REFRESH"),
            "catalog freshness and refresh semantics remain visible");
        } else if (size.rows >= 40) {
          assert.ok(grid.includes("MattPucock") && grid.includes("Route repository"),
            "the selected resource keeps its catalog and description");
          if (key) assert.ok(grid.includes("LICENSE") && grid.includes("PINNED SOURCE"));
        } else if (!key) {
          assert.ok(grid.includes("[ CURRENT ]"), "compact inventory keeps selected status");
        }
        session.input.write("d");
        await waitForGrid(session, (screen) => !screen.includes(title) && screen.includes("SHORTCUTS"),
          "D hides selected details without hiding shortcuts");
        await assertTableSurface(session, key);
        await assertShortcutsFrame(session, screenShortcutHints[key]);
        assertSelectedRow(session, key === "m" ? "MattPucock" : "ask-matt", key === "m");
        session.input.write("d");
        await assertSeparatedHeader(session, title, firstContent);
      }
      await assertTableSurface(session, key);
      await assertShortcutsFrame(session, screenShortcutHints[key]);
      session.input.write("\x1b[B");
      await assertSeparatedHeader(session, nextTitle, key === "m" ? "REPOSITORY" : "CATALOG");
      assertSelectedRow(session, nextId, key === "m");
      await assertTableSurface(session, key);
      await assertShortcutsFrame(session, key ? screenShortcutHints[key]
        : ["A install", "Delete remove", "M catalogs", "F filter", "C catalog", "K kind",
          "D details", "↑↓ navigate", "? guide", "Q quit"]);
      session.input.write("\x1b[A");
      await assertSeparatedHeader(session, title, key === "m" ? "REPOSITORY" : "CATALOG");
      assertSelectedRow(session, key === "m" ? "MattPucock" : "ask-matt", key === "m");
      if (key !== "m") {
        session.input.write("f");
        await assertShortcutsFrame(session,
          ["TYPE to search", "ENTER apply", "BACKSPACE edit", "ESC clear", "↑↓ navigate"]);
        session.input.write("ask-matt");
        await waitForGrid(session, (grid) => grid.includes("ask-matt▏"),
          "the table retains its live filter query above the divider");
        await assertTableSurface(session, key, { query: "ask-matt", editing: true });
        assertSelectedRow(session, "ask-matt");
        session.input.write("\r");
        await assertShortcutsFrame(session, screenShortcutHints[key]);
        await assertTableSurface(session, key, { query: "ask-matt" });
        if (key === "a") {
          session.input.write("l");
          await assertTableSurface(session, key, { query: "ask-matt", license: "MIT" });
          assertSelectedRow(session, "ask-matt");
        } else if (!key) {
          session.input.write("l");
          await waitForGrid(session, (grid) => grid.includes("RESOURCES 2/3"),
            "Inventory License filters out the unlicensed unmanaged resource");
          await assertTableSurface(session, key, { license: "MIT", inventoryCount: 2 });
          session.input.write("f");
          session.input.write("grill-me");
          await waitForGrid(session, (grid) => grid.includes("grill-me▏"),
            "Inventory text search composes with License");
          await assertTableSurface(session, key, {
            query: "grill-me", editing: true, license: "MIT", inventoryCount: 1,
          });
          session.input.write("\x1b");
          await waitForGrid(session, (grid) => grid.includes("RESOURCES 2/3"),
            "clearing Inventory search preserves its License filter");
          await assertTableSurface(session, key, { license: "MIT", inventoryCount: 2 });
          session.input.write("l");
          await assertTableSurface(session, key, { license: "ALL", inventoryCount: 3 });
        }
      }
      if (key) {
        session.input.write("\x1b");
        await assertSeparatedHeader(session, "SKILL - ask-matt", "CATALOG");
        await waitForGrid(session, (grid) => grid.includes("M catalogs"), "Escape returns to inventory");
      }
      session.input.write("q");
      assert.equal(await dashboardExit(session), true);
    } finally {
      if (session) await closeShowcaseDashboard(session);
      await rm(directory, { recursive: true, force: true });
    }
  });
}

for (const versionCount of [3, 40]) {
  test(`Termless ${versionCount}-commit revision tables keep header metadata, selection and pagination across layouts`,
    { timeout: 15000 }, async () => {
      const directory = await mkdtemp(path.join(os.tmpdir(), "kitia-termless-revisions-"));
      const versions = Array.from({ length: versionCount }, (_, index) => {
        const prefix = (index + 1).toString(16).padStart(7, "0");
        return {
          sha: prefix.padEnd(40, "f"), prefix, date: "2026-10-03T12:00:00Z",
          subject: `Revision ${String(index).padStart(2, "0")}`,
        };
      });
      const calls = [];
      let session;
      try {
        session = await launchShowcaseDashboard(directory, {
          listSourceVersionsOverride: async (resource) => {
            calls.push(`${resource.catalog}:${resource.kind}:${resource.id}`);
            return versions;
          },
        });
        await waitForGrid(session, (grid) => grid.includes("SKILL - ask-matt"),
          "the inventory selection is visible before opening revisions");
        session.input.write("v");
        for (const size of [
          terminalSize, { columns: 72, rows: 45 }, { columns: 120, rows: 24 }, terminalSize,
        ]) {
          session.terminal.resize(size.columns, size.rows);
          session.output.columns = size.columns;
          session.output.rows = size.rows;
          session.output.emit("resize");
          const count = Math.min(versionCount, size.rows === 24 ? 10 : 14);
          const assertRevisionSurface = async (selectedIndex) => {
            await waitForGrid(session, (screen) => screen.split("\n").some((line) =>
              line.includes("›") && line.includes(versions[selectedIndex].prefix)),
            "the expected revision selection reaches the visible page");
            const first = Math.max(0, Math.min(selectedIndex - Math.floor(count / 2), versionCount - count));
            const metadata = [
              "MattPucock / skill:ask-matt",
              "Select a commit to update; the catalog pin remains unchanged.",
              ...(versionCount > count ? [`Showing ${first + 1}-${first + count} of ${versionCount} commits.`] : []),
            ];
            const header = await assertSeparatedHeader(session, "RESOURCE REVISIONS", "",
              undefined, metadata);
            const lines = session.terminal.screen.getText().split("\n");
            const right = lines[header.row].indexOf("│", header.col);
            const bottom = lines.findIndex((line, index) =>
              index > header.bodyRow && line[header.col - 2] === "└");
            const body = lines.slice(header.bodyRow, bottom)
              .map((line) => line.slice(header.col, right).trim()).filter(Boolean);
            assert.equal(body.length, count,
              `${size.columns}x${size.rows} preserves the existing revision row budget without adding labels`);
            for (const [offset, row] of body.entries()) {
              const version = versions[first + offset];
              assert.ok(row.includes(version.prefix) && row.includes(version.date.slice(0, 10)) &&
                row.includes(version.subject), "commit, date and subject rows remain below the divider");
            }
            if (versionCount === count) {
              assert.ok(!lines.some((line) => line.includes("Showing ")),
                "unpaginated revisions do not acquire range metadata");
            }
            assertSelectedRow(session, versions[selectedIndex].prefix);
            await assertShortcutsFrame(session, ["↑↓ SELECT", "ENTER UPDATE", "ESC BACK"]);
          };
          await assertRevisionSurface(0);
          session.input.write("\x1b[A");
          await assertRevisionSurface(versionCount - 1);
          session.input.write("\x1b[B");
          await assertRevisionSurface(0);
          session.input.write("\x1b[B");
          await waitForGrid(session, (screen) => screen.split("\n").some((line) =>
            line.includes("›") && line.includes(versions[1].prefix)),
          "Down selects the next revision without losing the modal frame");
          await assertRevisionSurface(1);
          session.input.write("\x1b[A");
          await waitForGrid(session, (screen) => screen.split("\n").some((line) =>
            line.includes("›") && line.includes(versions[0].prefix)),
          "Up restores the first selected revision before resizing");
        }
        assert.deepEqual(calls, ["MattPucock:skill:ask-matt"],
          "resizing and navigation reuse the real revision picker result");
        session.input.write("\x1b");
        await waitForGrid(session, (grid) => grid.includes("SKILL - ask-matt") &&
          !grid.includes("RESOURCE REVISIONS"), "Escape closes revisions and restores inventory");
        await assertTableSurface(session, "");
        await assertShortcutsFrame(session, screenShortcutHints[""]);
        assertSelectedRow(session, "ask-matt");
        session.input.write("q");
        assert.equal(await dashboardExit(session), true);
      } finally {
        if (session) await closeShowcaseDashboard(session);
        await rm(directory, { recursive: true, force: true });
      }
    });
}
test("Termless Preview keeps source main, audit above tree, and independent adaptive navigation", { timeout: 15000 }, async () => {
  let inspectionPageView;
  const directory = await mkdtemp(path.join(os.tmpdir(), "kitia-termless-inspection-"));
  let session;
  let previewResource;
  const calls = [];
  const sourceFiles = [
    {
      path: "SKILL.md",
      lines: [
        "# Pinned skill source",
        "Review every change before approval.",
        "",
        "Item|Status|Note",
        "----|-----|----",
        "Tests|pass|done",
        ...Array.from({ length: 100 }, (_, index) => `Source marker ${index}`),
      ],
    },
    { path: "references/review.md", lines: ["# Supporting review", "Keep nested files visible."] },
    { path: "scripts/check.sh", lines: ["#!/bin/sh", "echo reviewed"] },
  ];
  const source = [
    "ask-matt/", "├── references/",
    ...Array.from({ length: 60 }, (_, index) => `│   ├── reference-${index}.md`),
    "│   └── review.md",
    "├── scripts/", "│   └── check.sh", "└── SKILL.md", "",
    ...sourceFiles.flatMap((file, index) => [
      ...(index ? [""] : []), `── ${file.path} ──`, "", ...file.lines,
    ]),
  ].join("\n");
  const audit = [
    "Audit coverage: 3/3 files analyzed; no files skipped.",
    ...Array.from({ length: 60 }, (_, index) =>
      `  WARNING SKILL.md:${index + 1} [PROMPT_OVERRIDE] Finding ${index}`),
  ].join("\n");
  let columns = terminalSize.columns;
  let rows = terminalSize.rows;
  const pageView = (focus, page) => inspectionPageView({
    resource: previewResource, content: `${source}\n${audit}`, columns, rows, focus, page,
  });
  const press = async (key, expected) => {
    const start = session.rawBytes().length;
    session.input.write(key);
    await waitForInkOutput(session, expected, start, 1000);
    return waitForGrid(session, (grid) => grid.includes(expected),
      `${JSON.stringify(key)} displays ${expected} in Preview`);
  };
  const navigate = async (key, focus, page) => {
    const view = pageView(focus, page);
    const marker = view.lines.find((line) => line.trim());
    const screen = await press(key, marker);
    assert.ok(screen.includes(marker), `${focus} page ${page + 1} reaches the xterm grid`);
    if (focus !== "source") {
      await assertSeparatedHeader(session, focus === "audit" ? "AUDIT REPORT" : "SOURCE TREE",
        marker, `PAGE ${page + 1}/${view.pageCount}`);
    }
    return screen;
  };
  try {
    session = await launchShowcaseDashboard(directory, {
      executeOverride: async (action, resource) => {
        calls.push({ action, resource: `${resource.kind}:${resource.id}` });
        if (action === "install") {
          return {
            code: 1,
            messages: [],
            resources: [],
            errors: [],
            failure: { userMessage: "AUDIT_BLOCKED: findings detected; installation blocked." },
          };
        }
        previewResource = resource;
        return { code: 0, messages: [source, audit], resources: [], errors: [] };
      },
    });
    ({ inspectionPageView } = await import("../../cli/dist/dashboard/screens.mjs"));
    await press("a", "CATALOG RESOURCES");
    const initial = await press("p", "# Pinned skill source");
    assert.ok(!initial.includes("SHORTCUTS") &&
      initial.includes("S source · A audit · T tree · TAB panel"),
    "Preview keeps its unframed compact keyboard footer instead of a SHORTCUTS panel");
    assert.equal(previewResource.kind, "skill");
    assert.ok(initial.includes("Review every change before approval."));
    assert.ok(initial.includes("Item|Status|Note") && initial.includes("----|-----|----"));
    assert.ok(initial.includes("Tests|pass|done"));
    assert.ok(initial.includes("Audit coverage:"));
    assert.equal(pageView("source", 0).pageCount, 6, "four SKILL.md pages and two nested files");
    assert.ok(initial.includes("SOURCE · PAGE 1/6"), "the xterm source pane shows the real total");
    assert.ok(initial.includes("FILE SKILL.md") && initial.includes("PART 1/4"));
    assertSourceHeader(session, "SKILL.md", "# Pinned skill source", 6);
    const pages = Array.from({ length: 6 }, (_, page) => pageView("source", page));
    assert.deepEqual(pages.flatMap(({ lines }) => lines), sourceFiles.flatMap(({ lines }) => lines));
    assert.equal(pages[4].title, "FILE references/review.md");
    assert.equal(pages[5].title, "FILE scripts/check.sh");
    const sourcePanel = session.terminal.findText("FILE SKILL.md");
    const sourceText = session.terminal.findText("# Pinned skill source");
    const auditPanel = session.terminal.findText("AUDIT REPORT");
    const treePanel = session.terminal.findText("SOURCE TREE");
    assert.ok(sourcePanel && sourceText && auditPanel && treePanel,
      "source, audit and tree are visible immediately, without an initial tree page");
    assert.ok(sourcePanel.col < auditPanel.col && sourceText.col < auditPanel.col,
      "the source occupies the main pane to the left of the audit");
    assert.equal(auditPanel.col, treePanel.col, "audit and tree share the right sidebar");
    assert.ok(auditPanel.row < treePanel.row, "audit is above the source tree");
    await assertSeparatedHeader(session, "AUDIT REPORT", pageView("audit", 0).lines[0],
      `PAGE 1/${pageView("audit", 0).pageCount}`);
    await assertSeparatedHeader(session, "SOURCE TREE", pageView("tree", 0).lines[0],
      `PAGE 1/${pageView("tree", 0).pageCount}`);

    await navigate("\x1b[C", "source", 1);
    await navigate("a", "audit", 0);
    const auditSecond = await navigate("\x1b[C", "audit", 1);
    assert.ok(auditSecond.includes(pageView("source", 1).lines[0]),
      "paging audit does not change the source page");
    await navigate("t", "tree", 0);
    const treeSecond = await navigate("\x1b[C", "tree", 1);
    assert.ok(treeSecond.includes(pageView("audit", 1).lines[0]),
      "paging tree does not change the audit page");
    await navigate("s", "source", 1);
    await navigate("\x1b[D", "source", 0);
    await navigate("a", "audit", 1);
    await navigate("\x1b[D", "audit", 0);
    await navigate("t", "tree", 1);
    await navigate("\x1b[D", "tree", 0);
    await navigate("\t", "source", 0);

    for (const size of [
      { columns: 72, rows: 40 }, { columns: 120, rows: 18 },
      { columns: 56, rows: 12 }, { columns: 120, rows: 8 },
    ]) {
      ({ columns, rows } = size);
      session.terminal.resize(columns, rows);
      session.output.columns = columns;
      session.output.rows = rows;
      session.output.emit("resize");
      const compact = await waitForGrid(session, (grid) =>
        grid.includes("# Pinned skill source") &&
        grid.includes(`PAGE 1/${pageView("source", 0).pageCount}`) &&
        grid.includes("FILE SKILL.md") &&
        !grid.includes("AUDIT REPORT") && !grid.includes("SOURCE TREE"),
      `${columns}x${rows} uses the resized source header and page budget`);
      assert.ok(compact.includes("# Pinned skill source"), `${columns}x${rows} resized grid:\n${compact}`);
      assert.ok(!compact.includes("AUDIT REPORT") && !compact.includes("SOURCE TREE"),
        `${columns}x${rows} uses a single focused source pane`);
      assertSourceHeader(session, "SKILL.md", "# Pinned skill source", pageView("source", 0).pageCount);
      await navigate("\x1b[C", "source", 1);
      const focusedAudit = await navigate("a", "audit", 0);
      assert.ok(focusedAudit.includes("AUDIT REPORT") && !focusedAudit.includes("FILE SKILL.md"));
      await navigate("\x1b[C", "audit", 1);
      const focusedTree = await navigate("t", "tree", 0);
      assert.ok(focusedTree.includes("SOURCE TREE") && !focusedTree.includes("AUDIT REPORT"));
      await navigate("\x1b[C", "tree", 1);
      await navigate("s", "source", 1);
      await navigate("\x1b[D", "source", 0);
      await navigate("a", "audit", 1);
      await navigate("\x1b[D", "audit", 0);
      await navigate("t", "tree", 1);
      await navigate("\x1b[D", "tree", 0);
      await navigate("\t", "source", 0);
    }
    assert.deepEqual(calls.map(({ action }) => action), ["preview"],
      "pane focus and navigation reuse one Preview result");

    session.terminal.resize(terminalSize.columns, terminalSize.rows);
    session.output.columns = terminalSize.columns;
    session.output.rows = terminalSize.rows;
    session.output.emit("resize");
    await press("\r", "CATALOG RESOURCES");
    session.input.write("\x1b[B");
    await new Promise((resolve) => setTimeout(resolve, 80));
    session.input.write("\x1b[B");
    await new Promise((resolve) => setTimeout(resolve, 80));
    await press("\r", "INSTALL OPTIONS");
    await press("\r", "CONFIRM INSTALL");
    const blocked = await press("y", "INSTALL FAILED");
    assert.ok(blocked.includes("AUDIT_BLOCKED"));
    assert.deepEqual(calls.map(({ action }) => action), ["preview", "install"]);
    await press("\x1b", "INVENTORY");
    await waitForGrid(session, (grid) => grid.includes("INVENTORY") && !grid.includes("INSTALL FAILED"),
      "the failure popup closes before quitting");
    session.input.write("q");
    await dashboardExit(session);
  } finally {
    if (session) {
      if (!session.doneSettled) {
        session.input.write("\x1b");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await closeShowcaseDashboard(session);
    }
    await rm(directory, { recursive: true, force: true });
  }
});

for (const [kind, id, filename] of [
  ["agent", "release-helper", "release-helper.agent.md"],
  ["instruction", "review-guide", "review-guide.instructions.md"],
]) {
  test(`Termless Preview renders ${kind} as one raw source file`, { timeout: 15000 }, async () => {
    let inspectionPageView;
    const directory = await mkdtemp(path.join(os.tmpdir(), `kitia-termless-${kind}-`));
    let session;
    let previewResource;
    let content;
    const calls = [];
    const press = async (key, expected) => {
      const start = session.rawBytes().length;
      session.input.write(key);
      await waitForInkOutput(session, expected, start);
      await session.flushTerminal();
      return session.terminal.screen.getText();
    };
    try {
      session = await launchShowcaseDashboard(directory, {
        executeOverride: async (action, resource) => {
          calls.push(action);
          previewResource = resource;
          content = [
            `id: ${resource.id}`,
            `description: ${resource.description}`,
            `catalog: ${resource.catalog}`,
            `source: ${resource.source_repository}/${resource.source_path}@${resource.source_ref}`,
            `license: ${resource.license_status}`,
            `upstream: https://github.com/${resource.source_repository}/tree/${resource.source_ref}/${resource.source_path}`,
            "",
            "---", `name: ${id}`, "---",
            `# Pinned ${kind} source`,
            "Item|Status|Note",
            "----|-----|----",
            "Tests|pass|done",
            "-- important body text --",
            "```markdown",
            "── SKILL.md ──", "",
            "This is source text, not another file.",
            "```",
          ].join("\n");
          return { code: 0, messages: [content], resources: [], errors: [] };
        },
      });
      ({ inspectionPageView } = await import("../../cli/dist/dashboard/screens.mjs"));
      await press("a", "CATALOG RESOURCES");
      await press("f", "TYPE to search");
      await press(id, id);
      await press("\r", "CATALOG RESOURCES");
      const screen = await press("p", `# Pinned ${kind} source`);
      assert.equal(previewResource.kind, kind);
      assert.equal(previewResource.id, id);
      assert.ok(screen.includes(`FILE ${filename}`));
      assert.ok(screen.includes("SOURCE · PAGE 1/1"));
      assert.ok(screen.includes("----|-----|----") && screen.includes("Tests|pass|done"));
      assert.ok(screen.includes("── SKILL.md ──"));
      const view = inspectionPageView({
        resource: previewResource, content, ...terminalSize, page: 0,
      });
      assert.equal(view.title, `FILE ${filename}`);
      assert.equal(view.pageCount, 1);
      assertSourceHeader(session, filename, `id: ${id}`, view.pageCount);
      assert.ok(view.lines.includes("----|-----|----"));
      assert.deepEqual(calls, ["preview"]);
      await press("\r", "CATALOG RESOURCES");
    } finally {
      if (session) {
        if (!session.doneSettled) {
          session.input.write("\x1b");
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        await closeShowcaseDashboard(session);
      }
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("Termless Preview colors literal Markdown and code cells across pages and narrow resizing", { timeout: 15000 }, async () => {
  let inspectionPageView;
  const { DASHBOARD_THEME } = require("../../cli/dist/dashboard/colors.js");
  const expectedColors = Object.fromEntries(Object.entries(DASHBOARD_THEME.semantic.syntax).map(([role, color]) => [
    role, {
      r: parseInt(color.slice(1, 3), 16),
      g: parseInt(color.slice(3, 5), 16),
      b: parseInt(color.slice(5, 7), 16),
    },
  ]));
  const directory = await mkdtemp(path.join(os.tmpdir(), "kitia-termless-source-colors-"));
  const markdown = [
    "# Syntax preview",
    "Plain source sentinel.",
    "",
    "Read **careful emphasis** before approval.",
    "Read [reference](https://example.com).",
    "Keep `inline source` literal.",
    "```javascript",
    "const fencedReady = 'fenced-value';",
    "```",
    "~~~unknown-preview-language",
    "const unknownReady = 'plain-value';",
    "~~~",
  ];
  const code = [
    "const standaloneReady = 'standalone-value';",
    "/* " + Array.from({ length: 220 }, (_, index) => `comment${String(index).padStart(3, "0")}`).join(" "),
    "comment continuation */",
    'const wrappedValue = "' +
      Array.from({ length: 100 }, (_, index) => `string${String(index).padStart(3, "0")}`).join(" ") + '";',
    "const afterComment = 42;",
  ];
  const source = [
    "ask-matt/", "├── scripts/", "│   └── review.js", "└── SKILL.md", "",
    "── SKILL.md ──", "", ...markdown, "", "── scripts/review.js ──", "", ...code,
  ].join("\n");
  let session;
  let resource;
  let columns = terminalSize.columns;
  let rows = terminalSize.rows;
  const colors = new Map();
  let plainColor;
  const pageView = (page) => inspectionPageView({ resource, content: source, columns, rows, page });
  const press = async (key, expected) => {
    const start = session.rawBytes().length;
    session.input.write(key);
    await waitForInkOutput(session, expected, start);
    await session.flushTerminal();
    return session.terminal.screen.getText();
  };
  const assertCells = (line, text, role) => {
    const location = session.terminal.findText(line);
    assert.ok(location, `literal source line reaches xterm: ${line}`);
    const offset = line.indexOf(text);
    assert.notEqual(offset, -1);
    const cells = Array.from(text, (_, index) =>
      session.terminal.cell(location.row, location.col + offset + index));
    assert.equal(cells.map((cell) => cell.char).join(""), text, "color does not replace source characters");
    for (const cell of cells) {
      if (role === "plain") {
        assert.deepEqual(cell.fg, plainColor, `${text} retains the plain source foreground`);
      } else {
        assert.ok(cell.fg, `${role} has an actual foreground in the xterm grid`);
        assert.notDeepEqual(cell.fg, plainColor, `${role} differs from plain source cells`);
        assert.deepEqual(cell.fg, expectedColors[role], `${role} uses the semantic theme foreground`);
        if (!colors.has(role)) colors.set(role, cell.fg);
        assert.deepEqual(cell.fg, colors.get(role), `${role} retains its foreground across wraps, pages and resizing`);
      }
    }
  };
  const inspectPages = async () => {
    const count = pageView(0).pageCount;
    const commentPages = new Set();
    let sawStandalone = false;
    let sawString = false;
    for (let page = 0; page < count; page += 1) {
      const view = pageView(page);
      if (page) await press("\x1b[C", view.lines.find((line) => line.trim()));
      const file = session.terminal.findText(view.title.split(" · PART ")[0]);
      assert.ok(file, "the source filename stays above the colored body");
      const screenRows = session.terminal.screen.getText().split("\n");
      for (let index = 0; index < view.lines.length; index += 1) {
        const line = view.lines[index];
        assert.equal(screenRows[file.row + 2 + index].slice(file.col, file.col + line.length), line,
          "colored spans preserve source rows, including rows after empty lines");
      }
      for (const line of view.lines) {
        if (line.includes("# Syntax preview")) assertCells(line, "Syntax preview", "heading");
        if (line.includes("careful emphasis")) assertCells(line, "careful emphasis", "emphasis");
        if (line.includes("[reference]")) assertCells(line, "reference", "link");
        if (line.includes("`inline source`")) assertCells(line, "inline source", "code");
        if (line.includes("const fencedReady")) {
          assertCells(line, "const", "keyword");
          assertCells(line, "fenced-value", "string");
        }
        if (line.includes("const unknownReady")) assertCells(line, line, "plain");
        if (line.includes("const standaloneReady")) {
          assertCells(line, "const", "keyword");
          assertCells(line, "standalone-value", "string");
          sawStandalone = true;
        }
        for (const match of line.matchAll(/comment\d{3}/g)) {
          assertCells(line, match[0], "comment");
          commentPages.add(page);
        }
        for (const match of line.matchAll(/string\d{3}/g)) {
          assertCells(line, match[0], "string");
          sawString = true;
        }
        if (line.includes("const afterComment")) assertCells(line, "const", "keyword");
      }
    }
    assert.ok(sawStandalone && sawString, "standalone code and wrapped string tokens reach colored cells");
    assert.ok(commentPages.size > 1, "a single wrapped multiline comment retains color past a page boundary");
    for (const role of ["heading", "emphasis", "link", "code", "keyword", "string", "comment"]) {
      assert.ok(colors.has(role), `the xterm grid exposes ${role} token cells`);
    }
    assert.notDeepEqual(colors.get("keyword"), colors.get("string"), "code is token-colored, not a uniform file tint");
    return count;
  };
  try {
    session = await launchShowcaseDashboard(directory, {
      executeOverride: async (_action, selected) => {
        resource = selected;
        return { code: 0, messages: [source], resources: [], errors: [] };
      },
    });
    ({ inspectionPageView } = await import("../../cli/dist/dashboard/screens.mjs"));
    await press("a", "CATALOG RESOURCES");
    await press("p", "# Syntax preview");
    const plain = session.terminal.findText("Plain source sentinel.");
    assert.ok(plain);
    plainColor = session.terminal.cell(plain.row, plain.col).fg;
    const count = await inspectPages();
    for (let page = count - 2; page >= 0; page -= 1) {
      await press("\x1b[D", pageView(page).lines.find((line) => line.trim()));
    }
    columns = 72;
    rows = 40;
    const resizeStart = session.rawBytes().length;
    session.terminal.resize(columns, rows);
    session.output.columns = columns;
    session.output.rows = rows;
    session.output.emit("resize");
    await waitForInkOutput(session, `PAGE 1/${pageView(0).pageCount}`, resizeStart);
    await session.flushTerminal();
    assertSourceHeader(session, "SKILL.md", "# Syntax preview", pageView(0).pageCount);
    await inspectPages();
    await press("\r", "CATALOG RESOURCES");
  } finally {
    if (session) {
      if (!session.doneSettled) {
        session.input.write("\x1b");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await closeShowcaseDashboard(session);
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("Termless Catalog Catalog/Kind/License filters match visible candidates", { timeout: 15000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kitia-termless-catalog-filters-"));
  const resources = [
    ["alpha-brief", "Alpha", "skill", "MIT"],
    ["alpha-audit", "Alpha", "skill", "Apache-2.0"],
    ["alpha-agent", "Alpha", "agent", "MIT"],
    ["beta-check", "Beta", "skill", "Proprietary"],
    ["alpha-extra", "Alpha", "skill", "Apache-2.0"],
    ["alpha-mit", "Alpha", "skill", "MIT"],
  ].map(([id, catalog, kind, license]) => ({
    id, catalog, kind, tags: ["preserved"], status: "stable",
    description: `Filter fixture ${id}.`, license_status: license,
    ...(license === "Proprietary" ? {} : { license_spdx: license }),
    source_repository: `org/${catalog.toLowerCase()}`,
    source_path: kind === "skill" ? `skills/${id}` : `agents/${id}.agent.md`,
    source_ref: "a".repeat(40),
  }));
  const all = resources.map(({ id }) => id);
  let state = { catalog: "all", kind: "all", query: "", editing: false, license: "all" };
  let session;
  let columns = terminalSize.columns;
  try {
    session = await launchShowcaseDashboard(directory, { catalogResourcesOverride: resources });
    await assertSeparatedHeader(session, "INVENTORY", "STATUS", undefined, [
      /^RESOURCES 3\/3 · 1-3$/,
      "Filter (F to filter) · Catalog ALL · Kind ALL · License ALL",
    ]);
    session.input.write("l");
    await waitForGrid(session, (grid) => grid.includes("RESOURCES 2/3"),
      "Inventory License filters the actual installed candidates");
    let inventoryGrid = session.terminal.screen.getText();
    assert.ok(inventoryGrid.includes("ask-matt") && inventoryGrid.includes("grill-me") &&
      !inventoryGrid.includes("herdr"));
    session.input.write("f");
    await waitForGrid(session, (grid) => grid.includes("TYPE to search"), "Inventory enters query mode");
    session.input.write("grill-me");
    await waitForGrid(session, (grid) => grid.includes("grill-me▏"), "Inventory query composes with License");
    session.input.write("\x1b");
    await waitForGrid(session, (grid) => grid.includes("RESOURCES 2/3"), "Inventory search clear preserves License");
    session.input.write("l");
    await waitForGrid(session, (grid) => grid.includes("RESOURCES 3/3"), "Inventory cycles back to ALL");
    inventoryGrid = session.terminal.screen.getText();
    assert.ok(inventoryGrid.includes("herdr"));
    session.input.write("a");
    await waitForGrid(session, (grid) => grid.includes("CATALOG RESOURCES"), "Catalog opens before filtering");
    session.input.write("d");
    await waitForGrid(session, (grid) => !grid.includes("SKILL - alpha-brief"), "details are hidden");

    const wrapText = (await import("../../cli/dist/dashboard/helpers.mjs")).wrapText;
    const assertView = async (ids) => {
      const summary = `Filter ${state.editing ? `${state.query}▏` : state.query || "(F to filter)"} · Catalog ${state.catalog.toUpperCase()} · Kind ${state.kind.toUpperCase()} · License ${state.license.toUpperCase()}`;
      const metadata = [
        `RESOURCES ${ids.length}/6 · ${ids.length ? `1-${ids.length}` : "0-0"}`,
        ...wrapText(summary, columns - 6),
      ];
      const header = await assertSeparatedHeader(session, "CATALOG RESOURCES", "INST", undefined, metadata);
      const lines = session.terminal.screen.getText().split("\n");
      const right = lines[header.row].indexOf("│", header.col);
      const bottom = lines.findIndex((line, index) => index > header.bodyRow && line[header.col - 2] === "└");
      const body = lines.slice(header.bodyRow + 1, bottom).map((line) => line.slice(header.col, right));
      const visible = all.filter((id) => body.some((line) => line.includes(id)));
      assert.deepEqual(visible.sort(), [...ids].sort(), "visible candidates match active filters");
      assert.equal(body.some((line) => line.includes("›")), ids.length > 0);
    };
    const press = async (key, patch, ids) => {
      state = { ...state, ...patch };
      session.input.write(key);
      await assertView(ids);
    };
    for (const width of [120, 72]) {
      columns = width;
      session.terminal.resize(columns, terminalSize.rows);
      session.output.columns = columns;
      session.output.emit("resize");
      await assertView(all);
      await press("l", { license: "Apache-2.0" }, ["alpha-audit", "alpha-extra"]);
      await press("c", { catalog: "Alpha", license: "all" }, all.filter((id) => id.startsWith("alpha-")));
      await press("k", { kind: "agent", license: "all" }, ["alpha-agent"]);
      await press("l", { license: "MIT" }, ["alpha-agent"]);
      await press("f", { editing: true }, ["alpha-agent"]);
      await press("tsl", { query: "tsl" }, []);
      await press("\r", { editing: false }, []);
      await press("f", { editing: true }, []);
      await press("\x1b", { query: "", editing: false, license: "all" }, ["alpha-agent"]);
      await press("k", { kind: "skill", license: "all" },
        ["alpha-brief", "alpha-audit", "alpha-extra", "alpha-mit"]);
      session.input.write("\x1b");
      await waitForGrid(session, (grid) => grid.includes("INVENTORY") && !grid.includes("CATALOG RESOURCES"),
        "Escape leaves Catalog");
      session.input.write("a");
      await waitForGrid(session, (grid) => grid.includes("CATALOG RESOURCES"), "A reopens Catalog");
      state = { ...state, catalog: "Beta", kind: "skill", license: "all", query: "", editing: false };
      await press("c", { catalog: "Beta", license: "all" }, ["beta-check"]);
      await press("l", { license: "Proprietary" }, ["beta-check"]);
      await press("c", { catalog: "all", license: "all" }, all.filter((id) => id !== "alpha-agent"));
      await press("k", { kind: "all", license: "all" }, all);
    }
    session.input.write("q");
    assert.equal(await dashboardExit(session), true);
  } finally {
    if (session) {
      if (!session.doneSettled) {
        session.input.write("\x1b");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await closeShowcaseDashboard(session);
    }
    await rm(directory, { recursive: true, force: true });
  }
});
test("Termless uninstall confirmation keeps every modal border edge inside narrow terminal bounds", {
  timeout: 15000,
}, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kitia-termless-uninstall-modal-"));
  let session;
  try {
    session = await launchShowcaseDashboard(directory);
    await waitForGrid(session, (grid) => grid.includes("SKILL - ask-matt"),
      "the managed skill is selected before uninstall");
    const columns = 68;
    const rows = 32;
    session.terminal.resize(columns, rows);
    session.output.columns = columns;
    session.output.rows = rows;
    session.output.emit("resize");
    await waitForGrid(session, (grid) => grid.includes("SKILL - ask-matt"),
      "the selected skill remains visible after resizing");
    session.input.write("\x1b[3~");
    let grid = await waitForGrid(session, (value) => value.includes("CONFIRM UNINSTALL"),
      "Delete opens the managed uninstall confirmation");
    session.input.write("\x1b[C");
    grid = await waitForGrid(session, (value) => value.includes("‹ UNINSTALL ›"),
      "the destructive option is selected without confirming it");
    const lines = grid.split("\n");
    const top = lines.findIndex((line) => line.includes("CONFIRM UNINSTALL"));
    assert.ok(top >= 0);
    const topLine = lines[top];
    const left = topLine.indexOf("┌");
    const right = topLine.indexOf("┐", left);
    const bottom = lines.findIndex((line, index) =>
      index > top && line[left] === "└" && line[right] === "┘");
    assert.ok(left >= 0 && right > left && right < columns,
      "modal top border corners fit within the terminal");
    assert.ok(bottom > top, "modal bottom border is visible");
    assert.equal(lines[bottom].length > columns, false, "modal bottom border is not clipped past the viewport");
    for (let row = top; row <= bottom; row += 1) {
      assert.ok(row < rows, `modal row ${row} is inside terminal height`);
      const leftEdge = row === top ? "┌" : row === bottom ? "└" : "│";
      const rightEdge = row === top ? "┐" : row === bottom ? "┘" : "│";
      assert.equal(lines[row][left], leftEdge, `modal left edge is intact at row ${row}`);
      assert.equal(lines[row][right], rightEdge,
        `modal right edge is intact at row ${row} (${JSON.stringify(lines[row][right])}):\n${grid}`);
    }
    for (const row of [top, bottom]) {
      assert.equal(lines[row].slice(left, right + 1).length, right - left + 1);
      assert.match(lines[row].slice(left, right + 1), row === top ? /^┌─.*┐$/ : /^└─+┘$/);
    }
    const expectedAccent = { r: 180, g: 189, b: 105 };
    const assertAccentAt = (row, col, label) => {
      assert.deepEqual(session.terminal.cell(row, col).fg, expectedAccent,
        `${label} uses the warning accent at (${col}, ${row})`);
    };
    for (let row = top; row <= bottom; row += 1) {
      const borderColumns = row === top || row === bottom ? Array.from(
        { length: right - left + 1 }, (_, index) => left + index) : [left, right];
      for (const col of borderColumns) assertAccentAt(row, col, "confirmation border");
    }
    const shortcutTitle = lines.findIndex((line) => line.includes("SHORTCUTS"));
    assert.ok(shortcutTitle > bottom, "the shortcut panel follows the confirmation box");
    const shortcutTop = shortcutTitle - 1;
    const shortcutLeft = lines[shortcutTop].indexOf("┌");
    const shortcutRight = lines[shortcutTop].indexOf("┐", shortcutLeft);
    const shortcutBottom = lines.findIndex((line, index) =>
      index > shortcutTitle && line[shortcutLeft] === "└" && line[shortcutRight] === "┘");
    assert.ok(shortcutLeft >= left && shortcutRight > shortcutLeft && shortcutRight < columns);
    assert.ok(shortcutBottom > shortcutTitle && shortcutBottom < rows);
    for (let row = shortcutTop; row <= shortcutBottom; row += 1) {
      assert.equal(lines[row][shortcutLeft], row === shortcutTop ? "┌" : row === shortcutBottom ? "└" : "│");
      assert.equal(lines[row][shortcutRight], row === shortcutTop ? "┐" : row === shortcutBottom ? "┘" : "│");
      assertAccentAt(row, shortcutLeft, "shortcut panel border");
      assertAccentAt(row, shortcutRight, "shortcut panel border");
    }
    const uninstall = session.terminal.findText("‹ UNINSTALL ›");
    assert.ok(uninstall, "the destructive choice remains visible");
    assert.deepEqual(session.terminal.cell(uninstall.row, uninstall.col).fg,
      { r: 224, g: 108, b: 117 }, "the selected destructive choice retains the danger accent");
  } finally {
    if (session) {
      session.input.write("\x1b");
      await new Promise((resolve) => setTimeout(resolve, 20));
      await closeShowcaseDashboard(session);
    }
    await rm(directory, { recursive: true, force: true });
  }
});
