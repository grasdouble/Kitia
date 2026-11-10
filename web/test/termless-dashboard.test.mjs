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

test("Termless xterm consumes the real Ink dashboard and its stream-driven states", async () => {
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
    const cancelStart = session.rawBytes().length;
    session.input.write("\x1b");
    await waitForInkOutput(session, "INVENTORY", cancelStart);
    await session.flushTerminal();

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
    assert.equal(await session.done, true, "q exits the Ink dashboard cleanly");
  } finally {
    if (session) await closeShowcaseDashboard(session);
    await rm(directory, { recursive: true, force: true });
  }
});
test("Termless dashboard renders the selected source preview and audit report", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kitia-termless-inspection-"));
  let session;
  const calls = [];
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
        return {
          code: 0,
          messages: [action === "preview"
            ? "# Pinned agent source\nReview every change before approval."
            : "Audit coverage: 1/1 files analyzed; no files skipped.\nWARNING PROMPT_OVERRIDE agents/release-helper.agent.md:1"],
          resources: [],
          errors: [],
        };
      },
    });
    const catalogStart = session.rawBytes().length;
    session.input.write("a");
    await waitForInkOutput(session, "CATALOG RESOURCES", catalogStart);
    await session.flushTerminal();

    const previewStart = session.rawBytes().length;
    session.input.write("p");
    const tree = await waitForInkOutput(session, "SOURCE PREVIEW", previewStart);
    await session.flushTerminal();
    assert.ok(tree.includes("SOURCE TREE"));
    const sourceStart = session.rawBytes().length;
    session.input.write("\x1b[C");
    const preview = await waitForInkOutput(session, "# Pinned agent source", sourceStart);
    await session.flushTerminal();
    assert.ok(preview.includes("# Pinned agent source"));
    assert.ok(session.terminal.screen.getText().includes("Review every change before approval."));

    const closePreview = session.rawBytes().length;
    session.input.write("\x1b");
    await waitForInkOutput(session, "CATALOG RESOURCES", closePreview);
    await session.flushTerminal();

    const auditStart = session.rawBytes().length;
    session.input.write("a");
    const audit = await waitForInkOutput(session, "RESOURCE AUDIT", auditStart);
    await session.flushTerminal();
    assert.ok(audit.includes("Audit coverage: 1/1 files analyzed"));
    assert.ok(session.terminal.screen.getText().includes("PROMPT_OVERRIDE"));
    assert.deepEqual(calls, [
      { action: "preview", resource: "skill:ask-matt" },
      { action: "audit", resource: "skill:ask-matt" },
    ]);

    const closeAudit = session.rawBytes().length;
    session.input.write("\x1b");
    await waitForInkOutput(session, "CATALOG RESOURCES", closeAudit);
    await session.flushTerminal();

    session.input.write("\x1b[B");
    await new Promise((resolve) => setTimeout(resolve, 80));
    session.input.write("\x1b[B");
    await new Promise((resolve) => setTimeout(resolve, 80));
    const optionsStart = session.rawBytes().length;
    session.input.write("\r");
    await waitForInkOutput(session, "INSTALL OPTIONS", optionsStart);
    const confirmationStart = session.rawBytes().length;
    session.input.write("\r");
    await waitForInkOutput(session, "CONFIRM INSTALL", confirmationStart);
    const blockedStart = session.rawBytes().length;
    session.input.write("y");
    const blocked = await waitForInkOutput(session, "INSTALL FAILED", blockedStart);
    assert.ok(blocked.includes("AUDIT_BLOCKED"));
    assert.deepEqual(calls.map(({ action }) => action), ["preview", "audit", "install"]);
    const closeBlocked = session.rawBytes().length;
    session.input.write("\x1b");
    await waitForInkOutput(session, "INVENTORY", closeBlocked);
    session.input.write("q");
    await session.done;
  } finally {
    if (session) await closeShowcaseDashboard(session);
    await rm(directory, { recursive: true, force: true });
  }
});
