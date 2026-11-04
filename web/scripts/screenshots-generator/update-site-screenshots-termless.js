"use strict";

const { randomBytes } = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { root } = require("./site-showcase-fixture.js");
const { assertTermlessRuntime } = require("./termless-preflight.js");
const {
  closeShowcaseDashboard,
  launchShowcaseDashboard,
  screenshotOptions,
  screenshotTermlessTerminal,
  screenshotViewport,
  waitForInkOutput,
} = require("./site-showcase-terminal.js");

const assets = path.join(root, "web", "assets");
const captures = [
  { name: "Termless inventory", staged: "workspace-inventory.png", output: "workspace-inventory-termless.png", draft: "workspace-inventory-termless-draft.png" },
  { name: "Termless catalog", staged: "catalog-browser.png", output: "catalog-browser-termless.png", draft: "catalog-browser-termless-draft.png" },
];
const usage = `Capture Termless/xterm.js screenshots of Kitia's actual Ink dashboard.

Usage:
  npm run web:screenshots:update:termless
  npm run web:screenshots:update:termless -- --help

Requires Node.js >=23.6, a built checkout, and @resvg/resvg-js. The command
uses the shared deterministic showcase fixture and writes a separate Termless
pair. It promotes to *-termless.png only when the parsed xterm screen proves
both complete frames; otherwise it writes review-only *-termless-draft.png
files and reports exactly which cells were missing. The original captures are untouched.`;

class CaptureError extends Error {}

async function assertBuiltCheckout() {
  for (const file of ["cli/dist/cli/main.js", "cli/dist/catalog/sources/installed.js"]) {
    try {
      await fs.access(path.join(root, file));
    } catch {
      throw new CaptureError(`Built CLI file is missing: ${file}. Run npm run cli:build first.`);
    }
  }
}

function screenRows(screen) {
  return screen.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function missingInventory(screen) {
  const lines = screenRows(screen);
  const requirements = [
    ["project current ask-matt row", /CURRENT.*PROJECT.*skill.*ask-matt.*MattPucock\[engineering\]/],
    ["unmanaged user herdr row", /UNMANAGED.*USER.*skill.*herdr/],
    ["current user grill-me row", /CURRENT.*USER.*skill.*grill-me.*MattPucock\[productivity\]/],
    ["side-by-side inventory and ask-matt detail titles", /INVENTORY.*SKILL - ask-matt/],
  ];
  const missing = requirements.filter(([, pattern]) => !lines.some((line) => pattern.test(line)))
    .map(([label]) => label);
  if (!screen.includes("2 current")) missing.push("two-managed summary");
  if (!screen.includes("1 unmanaged")) missing.push("one-unmanaged summary");
  for (const value of ["MattPucock[engineering]", "PROJECT", "[ CURRENT ]", "https://github.com/demo/skills", "4ae2317"]) {
    if (!screen.includes(value)) missing.push(`selected ask-matt detail ${JSON.stringify(value)}`);
  }
  return missing;
}

function missingCatalog(screen) {
  return ["CATALOG RESOURCES", "ask-matt", "grill-me", "plan-review", "release-helper", "review-guide"]
    .filter((value) => !screen.includes(value))
    .map((value) => `catalog ${JSON.stringify(value)}`);
}

async function validatePng(filePath, label) {
  const buffer = await fs.readFile(filePath);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      buffer.toString("ascii", 12, 16) !== "IHDR") {
    throw new CaptureError(`${label} did not produce a valid PNG.`);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width !== screenshotViewport.width || height !== screenshotViewport.height) {
    throw new CaptureError(
      `${label} is ${width}×${height}; expected ${screenshotViewport.width}×${screenshotViewport.height}.`,
    );
  }
  return buffer;
}

async function replacePair(images, destinations) {
  const staged = [];
  try {
    for (let index = 0; index < destinations.length; index += 1) {
      const suffix = `${process.pid}.${randomBytes(6).toString("hex")}`;
      const item = {
        destination: destinations[index],
        temporary: path.join(assets, `.${path.basename(destinations[index])}.${suffix}.tmp`),
        backup: path.join(assets, `.${path.basename(destinations[index])}.${suffix}.bak`),
        source: images[index],
        temporaryCreated: false,
        backupCreated: false,
        committed: false,
      };
      staged.push(item);
      await fs.copyFile(item.source, item.temporary);
      item.temporaryCreated = true;
    }
    for (const item of staged) {
      let previous;
      try {
        previous = await fs.lstat(item.destination);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (!previous) continue;
      if (!previous.isFile()) throw new CaptureError(`Termless destination is not a regular file: ${item.destination}`);
      await fs.copyFile(item.destination, item.backup);
      item.backupCreated = true;
    }
    for (const item of staged) {
      await fs.rename(item.temporary, item.destination);
      item.temporaryCreated = false;
      item.committed = true;
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const item of [...staged].reverse()) {
      if (!item.committed) continue;
      try {
        if (item.backupCreated) {
          await fs.rename(item.backup, item.destination);
          item.backupCreated = false;
        } else {
          await fs.rm(item.destination, { force: true });
        }
        item.committed = false;
      } catch (rollbackError) {
        rollbackErrors.push(`${item.destination}: ${rollbackError.message}`);
      }
    }
    for (const item of staged) {
      if (item.temporaryCreated) await fs.rm(item.temporary, { force: true });
      if (item.backupCreated && !item.committed) await fs.rm(item.backup, { force: true });
    }
    throw new CaptureError(
      `Could not replace the Termless screenshot pair: ${error.message}` +
      (rollbackErrors.length ? ` Rollback incomplete: ${rollbackErrors.join("; ")}` : " Previous pair restored."),
    );
  }
  for (const item of staged) {
    if (item.backupCreated) await fs.rm(item.backup, { force: true });
  }
}

async function main(args) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log(usage);
    return;
  }
  if (args.length) {
    console.error(`Error: Unsupported argument: ${args[0]}\n\n${usage}`);
    process.exitCode = 2;
    return;
  }
  try {
    assertTermlessRuntime();
    await assertBuiltCheckout();
    await import("@resvg/resvg-js");
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "kitia-termless-capture-"));
  let session;
  try {
    session = await launchShowcaseDashboard(temporaryDirectory);
    const staged = captures.map(({ staged: file }) => path.join(temporaryDirectory, file));

    const inventoryAnsi = await waitForInkOutput(session, "ask-matt");
    await session.flushTerminal();
    const inventoryGrid = session.terminal.screen.getText();
    await fs.writeFile(staged[0], await screenshotTermlessTerminal(session.terminal));

    const catalogStart = session.rawBytes().length;
    session.input.write("a");
    const catalogAnsi = await waitForInkOutput(session, "CATALOG RESOURCES", catalogStart);
    await session.flushTerminal();
    const catalogGrid = session.terminal.screen.getText();
    await fs.writeFile(staged[1], await screenshotTermlessTerminal(session.terminal));

    const images = await Promise.all(staged.map((file, index) => validatePng(file, captures[index].name)));
    if (images[0].equals(images[1])) throw new CaptureError("The Termless screenshots are identical.");

    const missing = [...missingInventory(inventoryGrid), ...missingCatalog(catalogGrid)];
    const complete = missing.length === 0;
    await fs.mkdir(assets, { recursive: true });
    const destinations = captures.map(({ output, draft }) => path.join(assets, complete ? output : draft));
    await replacePair(staged, destinations);
    if (complete) {
      const obsoleteDrafts = captures.map(({ draft }) => path.join(assets, draft));
      await Promise.all(obsoleteDrafts.map((file) => fs.rm(file, { force: true })));
    }
    for (let index = 0; index < captures.length; index += 1) {
      console.log(`${captures[index].name} ${complete ? "complete" : "draft"}: ${screenshotViewport.width}×${screenshotViewport.height} → ${destinations[index]}`);
    }
    console.log(`Termless xterm projection: inventory ${missingInventory(inventoryGrid).length ? "incomplete" : "complete"}; catalog ${missingCatalog(catalogGrid).length ? "incomplete" : "complete"}.`);
    console.log(`Ink stream evidence: inventory ${inventoryAnsi.length} chars; catalog ${catalogAnsi.length} chars.`);
    if (missing.length) {
      console.warn(`Not promoting Termless screenshots because the parsed xterm grid is missing: ${missing.join("; ")}`);
    } else {
      console.log(`Rendered with @resvg/resvg-js using fixed ${screenshotViewport.width}×${screenshotViewport.height} cell metrics.`);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (session) await closeShowcaseDashboard(session);
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
