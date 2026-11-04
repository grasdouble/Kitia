"use strict";

const path = require("node:path");
const { PassThrough } = require("node:stream");
const { loadCommandCatalogs } = require("../../dist/catalog/loading.js");
const { collectInstalledScopes } = require("../../dist/catalog/lifecycle.js");
const { catalogEntries, formatDashboardRows } = require("../../dist/cli/catalog.js");
const { loadUserSourceConfiguration } = require("../../dist/catalog/sources/config.js");
const { executeDashboardAction } = require("../../dist/cli/commands.js");
const { root, seedShowcase } = require("./site-showcase-fixture.js");
const { assertTermlessRuntime } = require("./termless-preflight.js");

const terminalSize = { columns: 120, rows: 45 };
const screenshotPadding = 12;
const screenshotViewport = { width: 1036, height: 788 };
const screenshotOptions = {
  fontFamily: "Menlo, Monaco, monospace",
  fontSize: 14,
  cellWidth: (screenshotViewport.width - screenshotPadding * 2) / terminalSize.columns,
  cellHeight: (screenshotViewport.height - screenshotPadding * 2) / terminalSize.rows,
  padding: screenshotPadding,
  margin: 0,
  scale: 1,
  theme: {
    background: "#282c34",
    foreground: "#ffffff",
    cursor: "#ffffff",
  },
};

const ANSI_PALETTE = [
  "#282c34", "#e06c75", "#b4bd69", "#b4bd69",
  "#81a2be", "#c678dd", "#8bbeb7", "#ffffff",
  "#666666", "#e06c75", "#b4bd69", "#b4bd69",
  "#8ab5f9", "#c678dd", "#8bbeb7", "#ffffff",
];

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function setShowcaseEnvironment(fixture) {
  const keys = ["HOME", "USERPROFILE", "KITIA_CONFIG_DIR", "TERM", "COLORTERM", "FORCE_COLOR", "NO_COLOR"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.HOME = fixture.home;
  process.env.USERPROFILE = fixture.home;
  process.env.KITIA_CONFIG_DIR = fixture.config;
  process.env.TERM = "xterm-256color";
  process.env.COLORTERM = "truecolor";
  process.env.FORCE_COLOR = "1";
  delete process.env.NO_COLOR;
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

const terminalStateByInstance = new WeakMap();
function stripAnsiForAssertions(value) {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

async function waitForInkOutput(session, expected, startByte = 0, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  const state = terminalStateByInstance.get(session.terminal);
  let bytes = Buffer.alloc(0);
  let plain = "";
  while (Date.now() <= deadline) {
    await session.flushTerminal();
    bytes = state.rawBytes();
    plain = stripAnsiForAssertions(bytes.subarray(startByte).toString("utf8"));
    if (plain.includes(expected)) return plain;
    await delay(20);
  }
  throw new Error(
    `Timed out waiting for ${JSON.stringify(expected)} in real Ink output (${bytes.length} bytes).\n` +
    stripAnsiForAssertions(bytes.toString("utf8")).split(/\r?\n/).filter(Boolean).slice(-30).join("\n"),
  );
}
// xterm resolves indexed ANSI colors to its fixed default RGB values. Recolor
// only the Termless feed; captured Ink bytes remain untouched for assertions.

function remapAnsiPalette(chunk) {
  return Buffer.from(chunk.toString("utf8").replace(/\u001b\[([0-9;]*)m/g, (_, parameters) => {
    const codes = parameters ? parameters.split(";").map(Number) : [0];
    const mapped = [];
    for (let index = 0; index < codes.length; index += 1) {
      const code = codes[index];
      let paletteIndex = -1;
      let background = false;
      if (code >= 30 && code <= 37) paletteIndex = code - 30;
      else if (code >= 90 && code <= 97) paletteIndex = code - 90 + 8;
      else if (code >= 40 && code <= 47) {
        paletteIndex = code - 40;
        background = true;
      } else if (code >= 100 && code <= 107) {
        paletteIndex = code - 100 + 8;
        background = true;
      } else if ((code === 38 || code === 48) && codes[index + 1] === 5 &&
                 codes[index + 2] >= 0 && codes[index + 2] < ANSI_PALETTE.length) {
        paletteIndex = codes[index + 2];
        background = code === 48;
        index += 2;
      }
      if (paletteIndex < 0) {
        mapped.push(code);
        continue;
      }
      const rgb = ANSI_PALETTE[paletteIndex].slice(1).match(/../g).map((part) => parseInt(part, 16));
      mapped.push(background ? 48 : 38, 2, ...rgb);
    }
    return `\u001b[${mapped.join(";")}m`;
  }), "utf8");
}

function normalizePtyOutput(chunk, state) {
  const bytes = [];
  for (const byte of chunk) {
    if (byte === 0x0a && !state.previousWasCarriageReturn) bytes.push(0x0d);
    bytes.push(byte);
    state.previousWasCarriageReturn = byte === 0x0d;
  }
  return Buffer.from(bytes);
}

function createTtyInput() {
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  return input;
}

function createTtyOutput() {
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = terminalSize.columns;
  output.rows = terminalSize.rows;
  return output;
}

async function launchShowcaseDashboard(directory) {
  assertTermlessRuntime();
  const fixture = await seedShowcase(directory);
  const restoreEnvironment = setShowcaseEnvironment(fixture);
  let terminal;
  let input;
  let output;
  let done;
  try {
    const [{ createTerminal }, { createXtermBackend }, dashboard] = await Promise.all([
      import("@termless/core"),
      import("@termless/xtermjs"),
      import(path.join(root, "dist", "dashboard", "dashboard.mjs")),
    ]);
    terminal = createTerminal({
      backend: createXtermBackend(),
      cols: terminalSize.columns,
      rows: terminalSize.rows,
      scrollbackLimit: 1000,
    });
    input = createTtyInput();
    output = createTtyOutput();
    const state = { chunks: [], queue: Promise.resolve(), failure: null };
    state.flush = async () => {
      await state.queue;
      if (state.failure) throw state.failure;
    };
    state.rawBytes = () => Buffer.concat(state.chunks);
    terminalStateByInstance.set(terminal, state);
    const ptyOutputState = { previousWasCarriageReturn: false };
    output.on("data", (chunk) => {
      state.chunks.push(chunk);
      const ptyChunk = remapAnsiPalette(normalizePtyOutput(chunk, ptyOutputState));
      state.queue = state.queue.then(() => terminal.feed(ptyChunk)).catch((error) => {
        state.failure ||= error;
      });
    });

    const loaded = loadCommandCatalogs({ command: "dashboard" }, () => {});
    const userCatalogs = loadUserSourceConfiguration().map(({ name, repository, mode, entries }) => ({
      name, repository, mode, entries,
    }));
    const installed = collectInstalledScopes(
      { project: fixture.project, user: fixture.home },
      loaded.sourceResources,
    );
    const allResources = catalogEntries(loaded.sourceResources);
    const rows = formatDashboardRows(installed.resources, allResources);
    const catalogResources = allResources;
    const dashboardOptions = { target: fixture.project, userTarget: fixture.home };
    const execute = (operation, resource, installOptions) => executeDashboardAction(
      operation,
      resource,
      dashboardOptions,
      {
        sourceResources: loaded.sourceResources,
      },
      installOptions,
    );
    done = dashboard.runDashboard(rows, input, output, installed.errors, {
      catalogResources,
      userCatalogs,
      execute,
    });
    done.catch(() => {});
    const session = {
      fixture, terminal, input, output, done, doneSettled: false, restoreEnvironment,
      flushTerminal: state.flush, rawBytes: state.rawBytes,
    };
    done.then(() => { session.doneSettled = true; }, () => { session.doneSettled = true; });
    return session;
  } catch (error) {
    input?.destroy();
    output?.destroy();
    if (terminal) await terminal.close();
    restoreEnvironment();
    throw error;
  }
}

async function closeShowcaseDashboard(session) {
  try {
    if (!session.doneSettled) {
      session.input.write("q");
      await Promise.race([session.done, delay(3000)]).catch(() => {});
    }
    await session.flushTerminal();
  } finally {
    session.input.destroy();
    session.output.destroy();
    try {
      await session.terminal.close();
    } finally {
      session.restoreEnvironment();
    }
  }
}
async function screenshotTermlessTerminal(terminal) {
  return terminal.screenshotPng(screenshotOptions);
}


module.exports = {
  closeShowcaseDashboard,
  launchShowcaseDashboard,
  screenshotOptions,
  screenshotTermlessTerminal,
  screenshotViewport,
  terminalSize,
  waitForInkOutput,
};
