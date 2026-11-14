"use strict";

const assert = require("node:assert/strict");
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { afterEach, test } = require("node:test");
const {
  checkCatalogFreshness, createSourceIndex, manageCatalogCommand, updateCatalog, importCatalogConfigurationText,
} = require("../dist/catalog/sources/manage.js");
const { writeInstallPlan } = require("../dist/catalog/inventory/files.js");
const { installSourceFileResource } = require("../dist/catalog/sources/resources.js");
const { runGhSkill, runGhSkillAsync, buildSourceSkillArgs } = require("../dist/catalog/sources/gh-skill.js");
const { latestSourceVersionAtRef } = require("../dist/catalog/sources/history.js");
const { loadUserSourceConfiguration, validateSourceConfiguration } = require("../dist/catalog/sources/config.js");
const { createDashboardActionHandler } = require("../dist/cli/dashboard.js");
const { recordSourceInstallation } = require("../dist/catalog/sources/installed.js");
const { loadCommandCatalogs } = require("../dist/catalog/loading.js");
const { findUnmanagedArtifacts, installedFingerprint, readInstallState } = require("../dist/catalog/inventory/index.js");
const { collectInstalledScopes } = require("../dist/catalog/lifecycle.js");
const { formatDashboardRows } = require("../dist/cli/catalog.js");
const { filterCatalogResources, cycleFilter, filterInventory, inventoryCatalogLabel, dashboardStatus } =
  require("../dist/dashboard/helpers.mjs");
const { renderInstalledResources } = require("../dist/dashboard/terminal.js");
const { readInstalledSourceSkills } = require("../dist/catalog/sources/installed.js");
const { checkInstalledResources } = require("../dist/catalog/lifecycle.js");
const { runSourceCommand } = require("../dist/cli/source-command.js");
const { uninstallSourceResource, updateSourceResources } = require("../dist/catalog/sources/resources.js");
const { main: runCliMain } = require("../dist/cli/main.js");
const { parseArguments } = require("../dist/cli/arguments.js");
const { executeCommand, runDashboardWorker } = require("../dist/cli/commands.js");
const { mergeRefreshedCatalogResources } = require("../dist/dashboard/helpers.mjs");
const nodeScriptSpawn = (script) => (command, args, options) => {
  assert.equal(command, "gh");
  return spawn(process.execPath, [script, ...args], options);
};
function waitForOutput(output, getValue, predicate, description, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    let timeout;
    let checking = false;
    let dirty = false;
    const cleanup = () => {
      clearTimeout(timeout);
      output.off("data", onData);
      output.off("end", onEnd);
      output.off("close", onClose);
      output.off("error", onError);
    };
    const check = () => {
      const value = getValue();
      if (predicate(value)) {
        cleanup();
        resolve(value);
        return;
      }
      if (checking) {
        dirty = true;
        return;
      }
      checking = true;
      dirty = false;
      queueMicrotask(() => {
        checking = false;
        if (dirty) check();
      });
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
      reject(new Error(`Timed out waiting for ${description}: ${String(getValue()).slice(-1000)}`));
    }, timeoutMs);
    check();
  });
}
test("dashboard preview combines source inspection and audit while installs remain audited", async () => {
  const { createDashboardActionHandler } = require("../dist/cli/dashboard.js");
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-dashboard-inspection-"));
  const configDirectory = path.join(temporary, "config");
  const indexDirectory = path.join(configDirectory, "source-catalogs");
  fs.mkdirSync(indexDirectory, { recursive: true });
  const repository = "https://github.com/org/repo";
  const configuration = { catalog_version: 1, sources: [{ name: "Test", repository }] };
  writeJson(path.join(configDirectory, "catalogSources.json"), configuration);
  writeJson(path.join(indexDirectory, "catalogSources.json"), configuration);
  const resource = {
    catalog: "Test", kind: "skill", id: "reviewer",
    source_repository: "org/repo", source_path: "skills/reviewer/SKILL.md",
    source_ref: "a".repeat(40), license_status: "MIT", description: "Review changes.",
  };
  writeJson(path.join(indexDirectory, "Test.json"), {
    catalog_version: 1, catalog_name: "Test", source_repository: "org/repo",
    source_ref: "a".repeat(40), resources: [{
      kind: "skill", id: "reviewer", source_path: "skills/reviewer/SKILL.md",
      description: "Review changes.", license_status: "MIT",
    }],
  });
  const previousConfig = process.env.KITIA_CONFIG_DIR;
  process.env.KITIA_CONFIG_DIR = configDirectory;
  try {
    const dispatched = [];
    const handler = createDashboardActionHandler(async (options) => {
      dispatched.push(options);
      options.output.log("Inspection output");
      return 0;
    });
    const invoke = (action, installOptions = {}) => handler(action, resource, {
      target: temporary, userTarget: temporary,
    }, { sourceResources: [resource] }, installOptions);
    await invoke("preview");
    await invoke("install");
    const ref = "b".repeat(40);
    await invoke("install", { ref });
    await invoke("update", { ref });
    assert.deepEqual(dispatched.map(({ command, audit, captureOutput, ref: selectedRef }) =>
      ({ command, audit, captureOutput, ref: selectedRef })), [
      { command: "preview", audit: true, captureOutput: true, ref: undefined },
      { command: "install", audit: true, captureOutput: false, ref: undefined },
      { command: "install", audit: true, captureOutput: false, ref },
      { command: "update", audit: undefined, captureOutput: false, ref },
    ]);
  } finally {
    if (previousConfig === undefined) delete process.env.KITIA_CONFIG_DIR;
    else process.env.KITIA_CONFIG_DIR = previousConfig;
  }
});
test("dashboard replaces an installed skill with the selected full revision through update confirmation", async (t) => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  t.after(() => {
    input.destroy();
    output.destroy();
  });
  output.isTTY = true;
  output.columns = 120;
  output.rows = 40;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const visibleFrame = () => {
    const start = rendered.lastIndexOf("\u001b[?2026h");
    const end = rendered.indexOf("\u001b[?2026l", start);
    return start >= 0 && end > start
      ? require("node:util").stripVTControlCharacters(rendered.slice(start, end))
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
      const frame = visibleFrame();
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
    }, 10_000);
  });
  const selectedSha = "b".repeat(40);
  const actions = [];
  const installed = {
    catalog: "Test", kind: "skill", id: "revision-skill", scope: "project", status: "current",
    source_repository: "org/repo", source_path: "skills/revision-skill", source_ref: "a".repeat(40),
  };
  let resolveHistory;
  const historyRequest = new Promise((resolve) => { resolveHistory = resolve; });
  let resolveUpdate;
  const updateRequest = new Promise((resolve) => { resolveUpdate = resolve; });
  let markUpdateStarted;
  const updateStarted = new Promise((resolve) => { markUpdateStarted = resolve; });
  const done = runDashboard([installed], input, output, [], {
    catalogResources: [{
      catalog: "Test", kind: "skill", id: "revision-skill",
      source_repository: "org/repo", source_path: "skills/revision-skill",
      source_ref: "a".repeat(40), license_status: "MIT",
    }],
    listSourceVersions: () => historyRequest,
    execute: async (action, resource, options) => {
      actions.push({ action, resource: resource.id, scope: resource.scope, ref: options.ref });
      markUpdateStarted();
      await updateRequest;
      return { code: 0, messages: ["Updated selected revision."], resources: [installed], errors: [] };
    },
  });
  let dashboardFinished = false;
  void done.then(() => { dashboardFinished = true; });
  await waitForFrame((frame) => frame.includes("INVENTORY"), "initial inventory");
  input.write("a");
  await waitForFrame((frame) => frame.includes("CATALOG RESOURCES"), "catalog resources");
  input.write("v");
  await waitForFrame((frame) => frame.includes("Loading commit history for revision-skill"),
    "revision history loading popup");
  resolveHistory([
    { sha: "a".repeat(40), prefix: "aaaaaaa", date: "2026-11-09T00:00:00Z", subject: "Current pin" },
    { sha: selectedSha, prefix: "bbbbbbb", date: "2026-11-08T00:00:00Z", subject: "Previous revision" },
  ]);
  const revisionFrame = await waitForFrame((frame) => frame.includes("RESOURCE REVISIONS"), "revision picker");
  const revisionBody = assertSeparatedPanelHeader(revisionFrame, "RESOURCE REVISIONS", "", [
    "Test / skill:revision-skill",
    "Select a commit to update; the catalog pin remains unchanged.",
  ]).filter((line) => line.trim());
  assert.equal(revisionBody.length, 2, "unpaginated revision rows stay below the divider without new column labels");
  assert.match(revisionBody[0], /› aaaaaaa\s+2026-11-09\s+Current pin/);
  assert.match(revisionBody[1], /bbbbbbb\s+2026-11-08\s+Previous revision/);
  input.write("\x1b[B");
  const selectedFrame = await waitForFrame((frame) => frame.includes("› bbbbbbb"), "second revision selection");
  assert.ok(selectedFrame.includes("› bbbbbbb"), "the second revision is selected before Enter");
  input.write("\r");
  const confirmationFrame = (await waitForFrame((frame) => frame.includes("CONFIRM UPDATE"),
    "update confirmation")).replace(/\s+/g, " ");
  assert.match(confirmationFrame, /CONFIRM UPDATE/);
  assert.match(confirmationFrame, /Replace the installed skill:revision-skill/);
  assert.match(confirmationFrame, /revision in project scope\?/);
  assert.match(confirmationFrame, /Selected revision: b{40}/);
  input.write("y");
  await waitForFrame((frame) => frame.includes("Updating skill:revision-skill"), "update loading popup");
  await updateStarted;
  assert.deepEqual(actions, [{
    action: "update", resource: "revision-skill", scope: "project", ref: selectedSha,
  }]);
  input.write("q");
  assert.equal(dashboardFinished, false, "input remains blocked while the loader popup is active");
  resolveUpdate();
  await waitForFrame((frame) => !frame.includes("Updating skill:revision-skill"),
    "the update loading popup to close");
  input.write("q");
  assert.equal(await done, true);
  input.destroy();
  output.destroy();
});
test("dashboard shows the loading popup for consecutive actions", async () => {
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
  output.rows = 40;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  let callCount = 0;
  const done = runDashboard([], input, output, [], {
    catalogResources: [{
      catalog: "Test", kind: "skill", id: "repeat-skill",
      source_repository: "org/repo", source_path: "skills/repeat-skill",
      source_ref: "a".repeat(40), license_status: "MIT",
    }],
    execute: async () => {
      callCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 250));
      return { code: 0, messages: ["Preview ready."], resources: [], errors: [] };
    },
  });
  const latestFrame = () => {
    const start = rendered.lastIndexOf("\u001b[?2026h");
    const end = rendered.indexOf("\u001b[?2026l", start);
    return start >= 0 && end > start ? rendered.slice(start, end) : "";
  };
  const waitFor = (predicate, message) =>
    waitForOutput(output, latestFrame, predicate, `dashboard to ${message}`, 5_000);
  let finished = false;
  try {
    await waitFor((frame) => frame.includes("INVENTORY"), "render Inventory");
    input.write("a");
    await waitFor((frame) => frame.includes("CATALOG RESOURCES"), "open catalog");
    input.write("p");
    await waitFor((frame) => frame.includes("LOADING"), "show the first loading popup");
    await waitFor((frame) => frame.includes("Preview ready."), "finish the first preview");
    assert.equal(callCount, 1);

    input.write("\r");
    await waitFor((frame) => frame.includes("CATALOG RESOURCES"), "return to catalog");
    input.write("p");
    await waitFor((frame) => frame.includes("LOADING"), "show the second loading popup");
    await waitFor(() => callCount === 2, "start the second preview");
    await waitFor((frame) => frame.includes("Preview ready."), "finish the second preview");
    input.write("\r");
    await waitFor((frame) => frame.includes("CATALOG RESOURCES"), "return to catalog again");
    input.write("q");
    assert.equal(await done, true);
    finished = true;
  } finally {
    if (!finished) {
      input.destroy();
      await done;
    } else {
      input.destroy();
    }
    output.destroy();
  }
});
test("dashboard revision picker applies a selected full SHA to a confirmed instruction update", async () => {
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
  output.rows = 40;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const selectedSha = "c".repeat(40);
  const installedInstruction = {
    catalog: "Test", kind: "instruction", id: "review", managed: true,
    scope: "project", status: "current", source_repository: "org/repo",
    source_path: ".github/instructions/review.instructions.md", source_ref: "a".repeat(40),
  };
  const actions = [];
  const done = runDashboard([installedInstruction], input, output, [], {
    listSourceVersions: () => [
      { sha: "a".repeat(40), prefix: "aaaaaaa", date: "2026-11-09T00:00:00Z", subject: "Current pin" },
      { sha: selectedSha, prefix: "ccccccc", date: "2026-11-08T00:00:00Z", subject: "Previous revision" },
    ],
    execute: async (action, resource, options) => {
      actions.push({ action, resource: resource.id, ref: options.ref });
      return { code: 0, messages: ["Updated selected revision."], resources: [installedInstruction], errors: [] };
    },
  });
  const visibleFrame = () => {
    const start = rendered.lastIndexOf("\u001b[?2026h");
    const end = rendered.indexOf("\u001b[?2026l", start);
    return start >= 0 && end > start
      ? require("node:util").stripVTControlCharacters(rendered.slice(start, end))
      : "";
  };
  const waitForFrame = (predicate, message) => new Promise((resolve, reject) => {
    let timeout;
    const cleanup = () => {
      clearTimeout(timeout);
      output.off("data", onData);
      output.off("end", onEnd);
      output.off("close", onClose);
      output.off("error", onError);
    };
    const checkFrame = () => {
      const frame = visibleFrame();
      if (!predicate(frame)) return false;
      cleanup();
      resolve(frame);
      return true;
    };
    const onData = () => { checkFrame(); };
    const onEnd = () => {
      cleanup();
      reject(new Error(`Dashboard output ended before rendering ${message}: ${visibleFrame()}`));
    };
    const onClose = () => {
      cleanup();
      reject(new Error(`Dashboard output closed before rendering ${message}: ${visibleFrame()}`));
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    if (checkFrame()) return;
    output.on("data", onData);
    output.once("end", onEnd);
    output.once("close", onClose);
    output.once("error", onError);
    timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Dashboard did not render ${message}: ${visibleFrame()}`));
    }, 10_000);
  });
  let finished = false;
  try {
    await waitForFrame((frame) =>
      frame.includes("INVENTORY") && frame.includes("instruction · review") && frame.includes("V revision"),
    "loaded instruction and revision shortcut");
    input.write("v");
    await waitForFrame((frame) => frame.includes("RESOURCE REVISIONS"), "revision picker");
    const revisionBody = assertSeparatedPanelHeader(selectedDetailsFrame(rendered), "RESOURCE REVISIONS", "", [
      "Test / instruction:review",
      "Select a commit to update; the catalog pin remains unchanged.",
    ]).filter((line) => line.trim());
    assert.equal(revisionBody.length, 2, "the existing update context moves into the header without consuming revision rows");
    assert.match(revisionBody[0], /› aaaaaaa\s+2026-11-09\s+Current pin/);
    input.write("\x1b[B");
    await waitForFrame((frame) => frame.includes("› ccccccc"), "selected revision");
    input.write("\r");
    await waitForFrame((frame) => frame.includes("CONFIRM UPDATE"), "update confirmation");
    assert.ok(visibleFrame().includes(selectedSha));
    input.write("y");
    await waitForFrame((frame) => frame.replace(/[│]/g, " ").replace(/\s+/g, " ").includes("Updated selected revision."),
      "successful update result");
    assert.deepEqual(actions, [{ action: "update", resource: "review", ref: selectedSha }]);
    input.write("q");
    assert.equal(await done, true);
    finished = true;
  } finally {
    input.destroy();
    if (!finished) await done.catch(() => {});
    output.destroy();
  }
});



let temporary;

afterEach(() => {
  if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
  temporary = null;
});
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
test("refreshing one catalog replaces only its resources in the catalog list", () => {
  const existingAlpha = { catalog: "Alpha", kind: "agent", id: "old-agent" };
  const existingBeta = { catalog: "Beta", kind: "skill", id: "unchanged-skill" };
  const updatedAlpha = { catalog: "Alpha", kind: "agent", id: "new-agent" };
  const unrelatedBetaUpdate = { catalog: "Beta", kind: "skill", id: "new-beta-skill" };

  assert.deepEqual(mergeRefreshedCatalogResources(
    [existingAlpha, existingBeta],
    [updatedAlpha, unrelatedBetaUpdate],
    ["alpha"],
  ), [updatedAlpha, existingBeta]);
});

test("Matt Pocock catalog preset resolves to its repository", () => {
  assert.deepEqual(parseArguments(["catalog", "add", "matt-pocock"]), {
    command: "catalog",
    action: "add",
    name: "matt-pocock",
    repository: "https://github.com/mattpocock/skills",
  });
});
test("Anthropics catalog preset resolves to its repository", () => {
  assert.deepEqual(parseArguments(["catalog", "add", "anthropics"]), {
    command: "catalog",
    action: "add",
    name: "Anthropics",
    repository: "https://github.com/anthropics/skills",
  });
});
test("GitHub Awesome Copilot catalog preset resolves to its repository", () => {
  assert.deepEqual(parseArguments(["catalog", "add", "github-awesome-copilot"]), {
    command: "catalog",
    action: "add",
    name: "github-awesome-copilot",
    repository: "https://github.com/github/awesome-copilot",
  });
});

test("first Kitia use preserves existing Kiti catalog settings", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-config-migration-"));
  const home = path.join(temporary, "home");
  const legacy = path.join(home, ".config", "kiti");
  const current = path.join(home, ".config", "kitia");
  const manifest = {
    catalog_version: 1,
    sources: [{ name: "Test", repository: "https://github.com/grasdouble/AI-Kit" }],
  };
  writeJson(path.join(legacy, "catalogSources.json"), manifest);
  writeJson(path.join(legacy, "source-catalogs", "Test.json"), { catalog_name: "Test" });

  const previous = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    KITIA_CONFIG_DIR: process.env.KITIA_CONFIG_DIR,
  };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.KITIA_CONFIG_DIR;
  try {
    assert.deepEqual(loadUserSourceConfiguration().map(({ name }) => name), ["Test"]);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(current, "catalogSources.json"), "utf8")), manifest);
    assert.equal(fs.existsSync(path.join(current, "source-catalogs", "Test.json")), true);
    assert.equal(fs.existsSync(path.join(legacy, "catalogSources.json")), true);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("onboarding defaults its project scan to the current directory", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-onboarding-target-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(temporary);
    const options = parseArguments(["onboarding"]);
    assert.equal(options.target, ".");
    assert.deepEqual(collectInstalledScopes({ project: options.target, user: temporary }, []).errors, []);
  } finally {
    process.chdir(previousCwd);
  }
});

test("dashboard shows the installed and available versions with the changelog link", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const previousVersion = process.env.KITIA_INSTALLED_VERSION;
  const previousFetch = global.fetch;
  process.env.KITIA_INSTALLED_VERSION = "1.0.0";
  global.fetch = async () => ({ ok: true, json: async () => ({ version: "1.0.2" }) });
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 120;
  output.rows = 40;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  let done;
  const plain = () => rendered.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  try {
    done = runDashboard([], input, output);
    await waitForOutput(output, plain, (text) => text.includes("NEW VERSION AVAILABLE"),
      "the available-version notice", 2_000);
    assert.match(plain(), /NEW VERSION AVAILABLE/);
    assert.match(plain(), /Installed: 1\.0\.0/);
    assert.match(plain(), /Available: 1\.0\.2/);
    assert.match(plain(), /github\.com\/grasdouble\/Kitia\/blob\/main\/CHANGELOG\.md#102/);
  } finally {
    try {
      if (done) {
        const previousOutputLength = plain().length;
        input.write("\x1b");
        try {
          await waitForOutput(output, () => plain().slice(previousOutputLength),
            (text) => text.includes("INVENTORY"), "inventory after Escape", 2_000);
        } catch {
          // Keep cleanup bounded if the dashboard cannot render its inventory screen.
        }
        input.write("q");
        let cleanupTimeout;
        await Promise.race([
          done.then(() => {}, () => {}),
          new Promise((resolve) => { cleanupTimeout = setTimeout(resolve, 2_000); }),
        ]).finally(() => clearTimeout(cleanupTimeout));
      }
    } finally {
      input.destroy();
      output.destroy();
      if (previousVersion === undefined) delete process.env.KITIA_INSTALLED_VERSION;
      else process.env.KITIA_INSTALLED_VERSION = previousVersion;
      global.fetch = previousFetch;
    }
  }
});

test("no-argument CLI defaults to the dashboard", () => {
  assert.deepEqual(parseArguments([]), { command: "dashboard", target: "." });
});


test("catalog freshness compares cached index with remote default branch", async () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-catalog-freshness-"));
  const previousConfig = process.env.KITIA_CONFIG_DIR;
  const configDirectory = path.join(temporary, "config");
  const repository = "https://github.com/example/test";
  const revision = "a".repeat(40);
  const remote = (ref) => async () => ({ stdout: `${ref}\tHEAD\n` });
  try {
    process.env.KITIA_CONFIG_DIR = configDirectory;
    writeJson(path.join(configDirectory, "catalogSources.json"), {
      catalog_version: 1,
      sources: [{ name: "Test", repository }],
    });
    writeJson(path.join(configDirectory, "source-catalogs", "Test.json"), {
      catalog_name: "Test",
      source_repository: "example/test",
      source_ref: revision,
      resources: [],
    });
    assert.deepEqual(await checkCatalogFreshness(remote(revision)), [
      { name: "Test", status: "current" },
    ]);
    assert.deepEqual(await checkCatalogFreshness(remote("b".repeat(40))), [
      { name: "Test", status: "outdated" },
    ]);
    assert.deepEqual(await checkCatalogFreshness(async () => {
      throw new Error("network unavailable");
    }), [{ name: "Test", status: "unknown" }]);
  } finally {
    if (previousConfig === undefined) delete process.env.KITIA_CONFIG_DIR;
    else process.env.KITIA_CONFIG_DIR = previousConfig;
  }
});

function createSource(name, repository) {
  const source = path.join(temporary, name);
  const skill = path.join(source, "skills", "demo-skill");
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, "SKILL.md"), [
    "---",
    "name: demo-skill",
    "description: A generated source skill.",
    "license: MIT",
    "---",
    "",
    "Synthetic body that must not appear in the index.",
    "",
  ].join("\n"));
  execFileSync("git", ["init", "--quiet", source]);
  execFileSync("git", ["-C", source, "remote", "add", "origin", repository]);
  execFileSync("git", ["-C", source, "add", "."]);
  execFileSync("git", [
    "-C", source, "-c", "user.name=Catalog fixtures", "-c",
    "user.email=fixtures@example.invalid", "-c", "commit.gpgsign=false",
    "commit", "--quiet", "-m", "Add synthetic skill",
  ]);
  return source;
}
test("user catalogs can be added, listed and removed without repository manifests", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-user-catalog-lifecycle-"));
  const repository = "https://github.com/example/user-catalog";
  const upstream = createSource("upstream", repository);
  const configDirectory = path.join(temporary, "config");
  const environmentKeys = [
    "KITIA_CONFIG_DIR", "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0",
  ];
  const previousEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  process.env.KITIA_CONFIG_DIR = configDirectory;
  process.env.GIT_CONFIG_COUNT = "1";
  process.env.GIT_CONFIG_KEY_0 = `url.${pathToFileURL(upstream).href}.insteadOf`;
  process.env.GIT_CONFIG_VALUE_0 = repository;
  const run = (args) => {
    const logs = [];
    const errors = [];
    const code = manageCatalogCommand({
      ...parseArguments(["catalog", ...args]),
      output: { log: (message) => logs.push(message), error: (message) => errors.push(message) },
    });
    return { code, logs, errors };
  };
  try {
    const added = run(["add", "team-alpha", repository]);
    assert.equal(added.code, 0, added.errors.join("\n"));
    assert.match(added.logs.join("\n"), /Added catalog team-alpha/);
    assert.deepEqual(run(["list"]).logs, [`team-alpha\t${repository}`]);
    assert.equal(fs.existsSync(path.join(configDirectory, "source-catalogs", "team-alpha.json")), true);
    assert.equal(parseArguments(["list", "--catalog", "team-alpha"]).catalog, "team-alpha");
    const loaded = loadCommandCatalogs({ command: "list", catalog: "team-alpha" }, () => {});
    assert.ok(loaded.sourceResources.length > 0);
    assert.ok(loaded.sourceResources.every((resource) => resource.catalog === "team-alpha"));
    assert.equal(run(["remove", "team-alpha"]).code, 0);
    assert.deepEqual(loadUserSourceConfiguration(), []);
    assert.equal(fs.existsSync(path.join(configDirectory, "source-catalogs", "team-alpha.json")), false);
  } finally {
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
test("catalog import skips same-name and same-repository entries but adds non-conflicting catalogs", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-import-catalog-config-"));
  const previousConfig = process.env.KITIA_CONFIG_DIR;
  const directory = path.join(temporary, "config");
  process.env.KITIA_CONFIG_DIR = directory;
  try {
    const existing = {
      catalog_version: 1,
      sources: [{ name: "Shared", repository: "https://github.com/example/existing" }],
    };
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "catalogSources.json"), JSON.stringify(existing));
    const summary = importCatalogConfigurationText(JSON.stringify({
      catalog_version: 1,
      sources: [
        { name: "Shared", repository: "https://github.com/example/other" },
        { name: "Renamed", repository: "https://github.com/example/existing" },
        { name: "New", repository: "https://github.com/example/new" },
        { name: "Offline", repository: "https://github.com/example/offline" },
      ],
    }), (names) => {
      assert.deepEqual(names, ["New", "Offline"]);
      return {
        refreshed: [{ name: "New", count: 2 }],
        failures: [{ name: "Offline", message: "network unavailable" }],
      };
    });
    assert.deepEqual(summary, {
      added: ["New", "Offline"],
      ignored: [
        { name: "Shared", reason: "Catalog name already exists." },
        {
          name: "Renamed",
          reason: "Repository already registered as another catalog (example/existing).",
        },
      ],
      refreshed: [{ name: "New", count: 2 }],
      refreshFailures: [{ name: "Offline", message: "network unavailable" }],
    });
    assert.deepEqual(loadUserSourceConfiguration().map(({ name }) => name), ["Shared", "New", "Offline"]);
  } finally {
    if (previousConfig === undefined) delete process.env.KITIA_CONFIG_DIR;
    else process.env.KITIA_CONFIG_DIR = previousConfig;
  }
});

test("catalog refresh updates one or all configured user indexes", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-refresh-catalog-"));
  const repositoryUrls = [
    "https://github.com/example/refresh-alpha",
    "https://github.com/example/refresh-beta",
  ];
  const alpha = createSource("alpha-upstream", repositoryUrls[0]);
  const beta = createSource("beta-upstream", repositoryUrls[1]);
  const configDirectory = path.join(temporary, "config");
  const sourceIndexDirectory = path.join(configDirectory, "source-catalogs");
  const betaEntry = { kind: "instruction", id: "review-policy", path: "policies/review-policy.instructions.md" };
  fs.mkdirSync(path.dirname(path.join(beta, betaEntry.path)), { recursive: true });
  fs.writeFileSync(path.join(beta, betaEntry.path), [
    "---", "name: review-policy", "description: Original policy.", "apply_to:", "  - src/**",
    "---", "", "Policy body.",
  ].join("\n"));
  execFileSync("git", ["-C", beta, "add", "."]);
  execFileSync("git", [
    "-C", beta, "-c", "user.name=Catalog fixtures", "-c",
    "user.email=fixtures@example.invalid", "-c", "commit.gpgsign=false",
    "commit", "--quiet", "-m", "Add source policy",
  ]);
  const sources = [
    { name: "Alpha", repository: repositoryUrls[0] },
    { name: "Beta", repository: repositoryUrls[1], mode: "custom", entries: [betaEntry] },
  ];
  const registry = { catalog_version: 1, sources };
  const envKeys = [
    "KITIA_CONFIG_DIR", "GIT_CONFIG_COUNT",
    "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0", "GIT_CONFIG_KEY_1", "GIT_CONFIG_VALUE_1",
  ];
  const previousEnvironment = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  try {
    process.env.KITIA_CONFIG_DIR = configDirectory;
    process.env.GIT_CONFIG_COUNT = "2";
    process.env.GIT_CONFIG_KEY_0 = `url.${pathToFileURL(alpha).href}.insteadOf`;
    process.env.GIT_CONFIG_VALUE_0 = repositoryUrls[0];
    process.env.GIT_CONFIG_KEY_1 = `url.${pathToFileURL(beta).href}.insteadOf`;
    process.env.GIT_CONFIG_VALUE_1 = repositoryUrls[1];
    writeJson(path.join(configDirectory, "catalogSources.json"), registry);
    writeJson(path.join(sourceIndexDirectory, "catalogSources.json"), registry);
    writeJson(path.join(sourceIndexDirectory, "Alpha.json"),
      createSourceIndex(repositoryUrls[0], "Alpha", alpha));
    writeJson(path.join(sourceIndexDirectory, "Beta.json"),
      createSourceIndex(repositoryUrls[1], "Beta", beta, { mode: "custom", entries: [betaEntry] }));
    const betaOriginalRef = JSON.parse(fs.readFileSync(path.join(sourceIndexDirectory, "Beta.json"), "utf8")).source_ref;

    const agent = path.join(alpha, "agents", "release.agent.md");
    fs.mkdirSync(path.dirname(agent), { recursive: true });
    fs.writeFileSync(agent, "---\nname: release\ndescription: Release agent.\n---\n\nAgent body.\n");
    fs.writeFileSync(path.join(beta, betaEntry.path), [
      "---", "name: review-policy", "description: Updated policy.", "apply_to:", "  - src/**",
      "---", "", "Updated policy body.",
    ].join("\n"));
    for (const source of [alpha, beta]) {
      execFileSync("git", ["-C", source, "add", "."]);
      execFileSync("git", [
        "-C", source, "-c", "user.name=Catalog fixtures", "-c",
        "user.email=fixtures@example.invalid", "-c", "commit.gpgsign=false",
        "commit", "--quiet", "-m", "Update source artifacts",
      ]);
    }

    const runCommand = (args) => {
      const logs = [];
      const errors = [];
      const code = manageCatalogCommand({
        ...parseArguments(args),
        output: { log: (message) => logs.push(message), error: (message) => errors.push(message) },
      });
      return { code, logs, errors };
    };
    const single = runCommand(["catalog", "refresh", "Alpha"]);
    assert.equal(single.code, 0);
    assert.match(single.logs.join("\n"), /Refreshed catalog Alpha/);
    const alphaIndex = JSON.parse(fs.readFileSync(path.join(sourceIndexDirectory, "Alpha.json"), "utf8"));
    assert.ok(alphaIndex.resources.some(({ kind, id }) => kind === "agent" && id === "release"));
    assert.equal(JSON.parse(fs.readFileSync(path.join(sourceIndexDirectory, "Beta.json"), "utf8")).source_ref,
      betaOriginalRef);

    const all = runCommand(["catalog", "refresh", "--all"]);
    assert.equal(all.code, 0);
    assert.match(all.logs.join("\n"), /Refreshed catalog Alpha/);
    assert.match(all.logs.join("\n"), /Refreshed catalog Beta/);
    const betaIndex = JSON.parse(fs.readFileSync(path.join(sourceIndexDirectory, "Beta.json"), "utf8"));
    assert.equal(betaIndex.resources.find(({ id }) => id === "review-policy").description, "Updated policy.");
    assert.deepEqual(loadUserSourceConfiguration().find(({ name }) => name === "Beta").entries, [betaEntry]);
    assert.deepEqual(loadUserSourceConfiguration().find(({ name }) => name === "Beta").mode, "custom");
    const userConfigurationFile = path.join(configDirectory, "catalogSources.json");
    const configurationBeforeUpdate = JSON.parse(fs.readFileSync(userConfigurationFile, "utf8"));
    const betaIndexBeforeUpdate = fs.readFileSync(path.join(sourceIndexDirectory, "Beta.json"), "utf8");
    assert.throws(() => updateCatalog("Beta", "Beta", repositoryUrls[1], {
      mode: "custom", entries: [{ kind: "instruction", path: "missing" }],
    }), /Source resource does not exist/);
    assert.deepEqual(JSON.parse(fs.readFileSync(userConfigurationFile, "utf8")), configurationBeforeUpdate);
    assert.equal(fs.readFileSync(path.join(sourceIndexDirectory, "Beta.json"), "utf8"), betaIndexBeforeUpdate);
    assert.throws(() => updateCatalog("Beta", "Alpha", repositoryUrls[1]), /Catalog already exists/);
    const updated = updateCatalog("Beta", "BetaEdited", repositoryUrls[1], {
      mode: "custom", entries: [{ kind: "instruction", path: "policies/" }],
    });
    assert.equal(updated.catalog_name, "BetaEdited");
    assert.deepEqual(updated.resources.map(({ kind, id }) => `${kind}:${id}`), [
      "instruction:review-policy",
    ]);
    const updatedSources = loadUserSourceConfiguration();
    assert.deepEqual(updatedSources.map(({ name }) => name), ["Alpha", "BetaEdited"]);
    assert.deepEqual(updatedSources.find(({ name }) => name === "BetaEdited").entries, [
      { kind: "instruction", path: "policies" },
    ]);
    assert.equal(fs.existsSync(path.join(sourceIndexDirectory, "Beta.json")), false);
    assert.equal(fs.existsSync(path.join(sourceIndexDirectory, "BetaEdited.json")), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(sourceIndexDirectory, "catalogSources.json"), "utf8")),
      JSON.parse(fs.readFileSync(userConfigurationFile, "utf8")));
  } finally {
    for (const key of envKeys) {
      if (previousEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnvironment[key];
    }
  }
});



test("Basic source indexing discovers categorized skills, agents, and instructions", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-categorized-source-"));
  const repository = "https://github.com/example/categorized";
  const source = createSource("categorized", repository);
  const skill = path.join(source, "skills", "engineering", "research");
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, "SKILL.md"), [
    "---",
    "name: research",
    "description: Research sources: follow first-party references.",
    "---",
    "",
    "Synthetic categorized skill.",
  ].join("\n"));
  const agent = path.join(source, "agents", "engineering", "release.agent.md");
  const friendlyNamedAgent = path.join(source, "agents", "accessibility-runtime-tester.agent.md");
  const instruction = path.join(source, ".github", "instructions", "checklist.instructions.md");
  fs.mkdirSync(path.dirname(agent), { recursive: true });
  fs.mkdirSync(path.dirname(instruction), { recursive: true });
  fs.writeFileSync(agent, [
    "---", "name: release", "description: Release agent.", "---", "", "Agent body.",
  ].join("\n"));
  fs.writeFileSync(friendlyNamedAgent, [
    "---", "name: Accessibility Runtime Tester", "---", "", "Accessibility agent.",
  ].join("\n"));
  fs.writeFileSync(instruction, [
    "---", "name: checklist", "description: Review checklist.",
    "applyTo: src/**", "---", "", "Instruction body.",
  ].join("\n"));
  fs.writeFileSync(path.join(source, "agents", "README.md"), "Not an agent resource.");
  const globalInstruction = path.join(source, "instructions", "global-guidance.md");
  fs.mkdirSync(path.dirname(globalInstruction), { recursive: true });
  fs.writeFileSync(globalInstruction, "# Global guidance\nApply this guidance across the repository.\n");
  execFileSync("git", ["-C", source, "add", "."]);
  execFileSync("git", [
    "-C", source, "-c", "user.name=Catalog fixtures", "-c",
    "user.email=fixtures@example.invalid", "-c", "commit.gpgsign=false",
    "commit", "--quiet", "-m", "Add categorized skill, agent and instructions",
  ]);

  const catalog = createSourceIndex(repository, "categorized", source);
  assert.equal(catalog.resources.find((entry) => entry.id === "research").source_path,
    "skills/engineering/research");
  assert.equal(catalog.resources.find((entry) => entry.id === "research").description,
    "Research sources: follow first-party references.");
  assert.deepEqual(catalog.resources.map(({ kind, id }) => `${kind}:${id}`).sort(), [
    "agent:accessibility-runtime-tester", "agent:release", "instruction:checklist",
    "instruction:global-guidance", "skill:demo-skill", "skill:research",
  ]);
  assert.equal(catalog.resources.find((entry) => entry.id === "release").source_path,
    "agents/engineering/release.agent.md");
  assert.equal(catalog.resources.find((entry) => entry.id === "accessibility-runtime-tester").description,
    "Accessibility agent.");
  const scopedInstruction = catalog.resources.find((entry) => entry.id === "checklist");
  assert.equal(scopedInstruction.source_path, ".github/instructions/checklist.instructions.md");
  assert.deepEqual(scopedInstruction.apply_to, ["src/**"]);
  const globalResource = catalog.resources.find((entry) => entry.id === "global-guidance");
  assert.equal(globalResource.source_path, "instructions/global-guidance.md");
  assert.deepEqual(globalResource.apply_to, ["**"]);
  assert.equal(catalog.resources.some(({ id }) => id === "readme"), false);
});
test("custom catalog mappings index explicit paths and default unscoped instructions globally", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-custom-source-"));
  const repository = "https://github.com/example/custom";
  const source = createSource("custom", repository);
  const skill = path.join(source, "custom-skills", "workflow", "review");
  const agent = path.join(source, "specialists", "release.agent.md");
  const instruction = path.join(source, "policies", "checklist.instructions.md");
  fs.mkdirSync(skill, { recursive: true });
  fs.mkdirSync(path.dirname(agent), { recursive: true });
  fs.mkdirSync(path.dirname(instruction), { recursive: true });
  fs.writeFileSync(path.join(skill, "SKILL.md"), [
    "---", "name: review", "description: Review changes.", "---", "", "Skill body.",
  ].join("\n"));
  fs.writeFileSync(agent, [
    "---", "name: release", "description: Release agent.", "---", "", "Agent body.",
  ].join("\n"));
  fs.writeFileSync(instruction, [
    "---", "name: checklist", "description: Review checklist.",
    "apply_to:", "  - src/**", "  - tests/**", "---", "", "Instruction body.",
  ].join("\n"));
  execFileSync("git", ["-C", source, "add", "."]);
  execFileSync("git", [
    "-C", source, "-c", "user.name=Catalog fixtures", "-c",
    "user.email=fixtures@example.invalid", "-c", "commit.gpgsign=false",
    "commit", "--quiet", "-m", "Add custom resource paths",
  ]);

  const configuration = validateSourceConfiguration({
    catalog_version: 1,
    sources: [{
      name: "custom",
      repository,
      mode: "custom",
      entries: [
        { kind: "skill", path: "custom-skills/workflow/review" },
        { kind: "agent", path: "specialists/release.agent.md" },
        { kind: "instruction", path: "policies/checklist.instructions.md" },
      ],
    }],
  })[0];
  assert.deepEqual(configuration.entries.map(({ kind, id }) => [kind, id]), [
    ["skill", undefined], ["agent", "release"], ["instruction", "checklist"],
  ]);
  const catalog = createSourceIndex(repository, "custom", source, configuration);
  assert.deepEqual(catalog.resources.map(({ kind, id }) => `${kind}:${id}`).sort(), [
    "agent:release", "instruction:checklist", "skill:review",
  ]);
  assert.equal(catalog.resources.find(({ kind }) => kind === "skill").source_path,
    "custom-skills/workflow/review");
  assert.deepEqual(catalog.resources.find(({ kind }) => kind === "instruction").apply_to,
    ["src/**", "tests/**"]);
  assert.equal(catalog.resources.some(({ id }) => id === "demo-skill"), false);
  const target = path.join(temporary, "target");
  fs.mkdirSync(target);
  const fileActions = [];
  const agentResource = catalog.resources.find(({ kind }) => kind === "agent");
  assert.deepEqual(installSourceFileResource({ ...agentResource, catalog: "custom" }, target, "both", {
    dryRun: true, onAction: (action) => fileActions.push(action),
  }), [".claude/agents/release.md", ".github/agents/release.agent.md"]);
  const instructionResource = catalog.resources.find(({ kind }) => kind === "instruction");
  assert.deepEqual(installSourceFileResource({
    ...instructionResource, catalog: "custom",
  }, target, "both", {
    dryRun: true, onAction: (action) => fileActions.push(action),
  }), [".claude/rules/checklist.md", ".github/instructions/checklist.instructions.md"]);
  assert.deepEqual(fileActions.map(({ path: relativePath }) => relativePath), [
    ".claude/agents/release.md", ".github/agents/release.agent.md",
    ".claude/rules/checklist.md", ".github/instructions/checklist.instructions.md",
  ]);

  const firstPath = path.join(target, ".claude/agents/release.md");
  const secondPath = path.join(target, ".github/agents/release.agent.md");
  fs.mkdirSync(path.dirname(firstPath), { recursive: true });
  fs.mkdirSync(path.dirname(secondPath), { recursive: true });
  fs.writeFileSync(firstPath, "existing claude agent\n");
  fs.writeFileSync(secondPath, "existing copilot agent\n");
  const originalRename = fs.renameSync;
  let renameCount = 0;
  fs.renameSync = (...args) => {
    renameCount += 1;
    if (renameCount === 3) throw new Error("injected third-file write failure");
    return originalRename(...args);
  };
  const thirdPath = path.join(target, ".claude/rules/checklist.md");
  fs.mkdirSync(path.dirname(thirdPath), { recursive: true });
  fs.writeFileSync(thirdPath, "existing instruction\n");
  try {
    const plan = new Map([
      [".claude/agents/release.md", { content: Buffer.from("new claude agent\n"), executable: false }],
      [".claude/rules/checklist.md", { content: Buffer.from("new instruction\n"), executable: false }],
      [".github/agents/release.agent.md", { content: Buffer.from("new copilot agent\n"), executable: false }],
    ]);
    assert.throws(() => writeInstallPlan(plan, target, { force: true }),
      /injected third-file write failure/);
  } finally {
    fs.renameSync = originalRename;
  }
  assert.equal(fs.readFileSync(firstPath, "utf8"), "existing claude agent\n");
  assert.equal(fs.readFileSync(secondPath, "utf8"), "existing copilot agent\n");
  assert.equal(fs.readFileSync(thirdPath, "utf8"), "existing instruction\n");
  assert.equal(fs.existsSync(path.join(target, ".agents/kitia-lock.json")), false);
  assert.throws(() => validateSourceConfiguration({
    catalog_version: 1,
    sources: [{
      name: "unsafe",
      repository: "https://github.com/example/unsafe",
      mode: "custom",
      entries: [{ kind: "agent", path: "../escape.agent.md" }],
    }],
  }), /safe repository-relative path/);
  fs.writeFileSync(instruction, "# Checklist without an explicit scope\n");
  const unscopedCatalog = createSourceIndex(repository, "custom", source, configuration);
  assert.deepEqual(unscopedCatalog.resources.find(({ kind }) => kind === "instruction").apply_to, ["**"]);
  fs.writeFileSync(instruction, "---\napply_to: []\n---\n\nInvalid policy.\n");
  assert.throws(() => createSourceIndex(repository, "custom", source, configuration),
    /example\/custom:policies\/checklist\.instructions\.md must define a non-empty/);
});

test("inventory labels custom catalogs from the most specific configured source folders", () => {
  const resource = (kind, id, source_path, catalog = "MattPucock") => ({
    catalog, kind, id, source_path, source_repository: "example/resources", managed: true,
  });
  const resources = [
    resource("skill", "review", "skills/engineering/review"),
    resource("skill", "review-special", "skills/engineering/review"),
    resource("skill", "writing", "skills/productivity/writing"),
    resource("agent", "release-bot", "agents/release.agent.md"),
    resource("instruction", "policy", "policies/checklist.instructions.md"),
    resource("agent", "first-release", "one/engineering/release.agent.md"),
    resource("agent", "second-release", "two/engineering/release.agent.md"),
    resource("skill", "basic", "skills/basic", "BasicCatalog"),
    resource("skill", "unmapped", "elsewhere/unmapped"),
    { ...resource("skill", "unmanaged", "skills/engineering/unmanaged"), managed: false },
  ];
  const catalogs = [
    {
      name: "MattPucock",
      mode: "custom",
      entries: [
        { kind: "skill", path: "skills" },
        { kind: "skill", id: "review-special", path: "skills/engineering/review/SKILL.md" },
        { kind: "skill", path: "skills/productivity" },
        { kind: "agent", id: "release-bot", path: "agents/release.agent.md" },
        { kind: "instruction", path: "policies/checklist.instructions.md" },
        { kind: "agent", path: "one/engineering" },
        { kind: "agent", path: "two/engineering" },
      ],
    },
    { name: "BasicCatalog", mode: "basic", entries: [] },
  ];

  const labels = resources.map((entry) => inventoryCatalogLabel(entry, catalogs, resources));
  assert.deepEqual(labels, [
    "MattPucock[engineering]",
    "MattPucock[engineering]",
    "MattPucock[productivity]",
    "MattPucock[agents]",
    "MattPucock[policies]",
    "MattPucock[one/engineering]",
    "MattPucock[two/engineering]",
    "BasicCatalog",
    "MattPucock",
    "-",
  ]);
  assert.deepEqual(filterInventory(resources, "", "MattPucock[engineering]", "all", catalogs)
    .map(({ id }) => id), ["review", "review-special"]);
  assert.equal(cycleFilter("all", resources.filter((entry) => entry.managed !== false),
    "catalog", "kind", "all", catalogs), "BasicCatalog");
});

test("custom catalog directory mappings discover nested skills, agents, and instructions", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-custom-directories-"));
  const repository = "https://github.com/example/custom-directories";
  const source = createSource("custom-directories", repository);
  const writeMarkdown = (relativePath, lines) => {
    const file = path.join(source, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, lines.join("\n"));
  };
  writeMarkdown("custom/skills/review/SKILL.md", [
    "---", "name: review", "description: Review changes.", "---", "", "Review skill.",
  ]);
  writeMarkdown("custom/skills/testing/SKILL.md", [
    "---", "name: testing", "description: Test changes.", "---", "", "Testing skill.",
  ]);
  writeMarkdown("custom/agents/release.agent.md", [
    "---", "name: release", "description: Release agent.", "---", "", "Release agent.",
  ]);
  writeMarkdown("custom/agents/security/security-review.agent.md", [
    "---", "name: security-review", "description: Security review agent.", "---", "", "Review agent.",
  ]);
  writeMarkdown("custom/instructions/security.instructions.md", [
    "---", "description: Security policy.", "apply_to: src/**", "---", "", "Security instructions.",
  ]);
  writeMarkdown("custom/instructions/testing/note.md", [
    "---", "description: Test policy.", "apply_to: tests/**", "---", "", "Test instructions.",
  ]);
  execFileSync("git", ["-C", source, "add", "."]);
  execFileSync("git", [
    "-C", source, "-c", "user.name=Catalog fixtures", "-c",
    "user.email=fixtures@example.invalid", "-c", "commit.gpgsign=false",
    "commit", "--quiet", "-m", "Add custom resource directories",
  ]);
  const configuration = validateSourceConfiguration({
    catalog_version: 1,
    sources: [{
      name: "custom-directories",
      repository,
      mode: "custom",
      entries: [
        { kind: "skill", path: "custom/skills/" },
        { kind: "agent", path: "custom/agents" },
        { kind: "instruction", path: "custom/instructions" },
      ],
    }],
  })[0];
  assert.deepEqual(configuration.entries.map(({ path: sourcePath }) => sourcePath), [
    "custom/skills", "custom/agents", "custom/instructions",
  ]);
  const catalog = createSourceIndex(repository, "custom-directories", source, configuration);
  assert.deepEqual(catalog.resources.map(({ kind, id }) => `${kind}:${id}`).sort(), [
    "agent:release", "agent:security-review", "instruction:note", "instruction:security",
    "skill:review", "skill:testing",
  ]);
  assert.equal(catalog.resources.find(({ id }) => id === "testing").source_path,
    "custom/skills/testing");
});



test("user source configuration rejects duplicate names and non-GitHub repositories", () => {
  assert.throws(() => validateSourceConfiguration({
    catalog_version: 1,
    sources: [
      { name: "duplicate", repository: "https://github.com/example/one" },
      { name: "Duplicate", repository: "https://github.com/example/two" },
    ],
  }), /Duplicate catalog source name/);
  assert.deepEqual(validateSourceConfiguration({
    catalog_version: 1,
    sources: [
      { name: "Test", repository: "https://github.com/example/test" },
      { name: "AI Kit", repository: "https://github.com/example/ai-kit" },
      { name: "skills_catalog.v2", repository: "https://github.com/example/skills" },
    ],
  }).map(({ name }) => name), ["Test", "AI Kit", "skills_catalog.v2"]);
  assert.throws(() => validateSourceConfiguration({
    catalog_version: 1,
    sources: [{ name: "unsupported", repository: "https://example.com/team/repo" }],
  }), /Invalid GitHub source repository URL/);
});

test("user registries load metadata for multiple independently named catalogs", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-user-catalogs-"));
  const indexDirectory = path.join(temporary, "source-catalogs");
  fs.mkdirSync(indexDirectory, { recursive: true });
  const sources = [
    { name: "team-alpha", repository: "https://github.com/example/team-alpha" },
    { name: "team-beta", repository: "https://github.com/example/team-beta" },
  ];
  const manifest = { catalog_version: 1, sources };
  fs.writeFileSync(path.join(temporary, "catalogSources.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(indexDirectory, "catalogSources.json"), JSON.stringify(manifest));
  for (const [index, source] of sources.entries()) {
    fs.writeFileSync(path.join(indexDirectory, `${source.name}.json`), JSON.stringify({
      catalog_version: 1,
      catalog_name: source.name,
      source_repository: `example/${source.name}`,
      source_ref: String(index + 1).repeat(40),
      resources: [{
        id: `demo-${source.name}`,
        kind: "skill",
        description: `${source.name} skill.`,
        source_path: `skills/category-${index}/demo-${source.name}`,
        license_status: "MIT",
      }],
    }));
  }

  const originalConfig = process.env.KITIA_CONFIG_DIR;
  process.env.KITIA_CONFIG_DIR = temporary;
  try {
    const loaded = loadCommandCatalogs({ command: "list" });
    assert.deepEqual(loaded.sourceResources.map(({ catalog, id }) => `${catalog}:${id}`).sort(), [
      "team-alpha:demo-team-alpha",
      "team-beta:demo-team-beta",
    ]);
  } finally {
    if (originalConfig === undefined) delete process.env.KITIA_CONFIG_DIR;
    else process.env.KITIA_CONFIG_DIR = originalConfig;
  }
});

test("source catalogs load from the user registry without repository manifests", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-user-catalogs-"));
  const indexDirectory = path.join(temporary, "source-catalogs");
  fs.mkdirSync(indexDirectory, { recursive: true });
  const sources = [
    { name: "team-alpha", repository: "https://github.com/example/team-alpha" },
    { name: "team-beta", repository: "https://github.com/example/team-beta" },
  ];
  const manifest = { catalog_version: 1, sources };
  writeJson(path.join(temporary, "catalogSources.json"), manifest);
  writeJson(path.join(indexDirectory, "catalogSources.json"), manifest);
  for (const [index, source] of sources.entries()) {
    writeJson(path.join(indexDirectory, `${source.name}.json`), {
      catalog_version: 1,
      catalog_name: source.name,
      source_repository: `example/${source.name}`,
      source_ref: String(index + 1).repeat(40),
      resources: [{
        id: `demo-${source.name}`,
        kind: "skill",
        description: `${source.name} skill.`,
        source_path: `skills/category-${index}/demo-${source.name}`,
        license_status: "MIT",
      }],
    });
  }
  const originalConfig = process.env.KITIA_CONFIG_DIR;
  process.env.KITIA_CONFIG_DIR = temporary;
  try {
    const loaded = loadCommandCatalogs({ command: "list" });
    assert.deepEqual(loaded.sourceResources.map(({ catalog, id }) => `${catalog}:${id}`).sort(), [
      "team-alpha:demo-team-alpha",
      "team-beta:demo-team-beta",
    ]);
  } finally {
    if (originalConfig === undefined) delete process.env.KITIA_CONFIG_DIR;
    else process.env.KITIA_CONFIG_DIR = originalConfig;
  }
});


test("source skills can be uninstalled from inventory after their catalog is removed", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-removed-source-"));
  const target = path.join(temporary, "target");
  const relativePath = ".agents/skills/retired-skill/SKILL.md";
  const skillFile = path.join(target, relativePath);
  fs.mkdirSync(path.dirname(skillFile), { recursive: true });
  fs.writeFileSync(skillFile, [
    "---",
    "name: retired-skill",
    "description: An installed skill from a removed source.",
    "metadata:",
    '  github-repo: "https://github.com/example/retired"',
    '  github-path: "skills/retired-skill"',
    `  github-ref: "${"a".repeat(40)}"`,
    "---",
    "",
    "Tracked skill body.",
    "",
  ].join("\n"));
  const record = {
    source_repository: "example/retired",
    source_path: "skills/retired-skill",
    source_ref: "a".repeat(40),
    files: { [relativePath]: installedFingerprint(target, relativePath) },
  };
  fs.mkdirSync(path.join(target, ".agents"), { recursive: true });
  fs.writeFileSync(path.join(target, ".agents/kitia-lock.json"), JSON.stringify({
    lock_version: 1,
    catalog: "grasdouble/Kitia",
    sources: { retired: { skills: { "retired-skill": record } } },
  }));

  const loaded = loadCommandCatalogs({
    command: "uninstall", kind: "skill", target,
  }, () => assert.fail("uninstall must not need source discovery"));
  assert.deepEqual(loaded.sourceResources.map(({ catalog, id }) => `${catalog}:${id}`), [
    "retired:retired-skill",
  ]);
  uninstallSourceResource(loaded.sourceResources[0], target);
  assert.equal(fs.existsSync(skillFile), false);
  assert.equal(fs.existsSync(path.dirname(skillFile)), false);
});

test("identical skill IDs from different sources cannot collide in one installation target", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-source-id-collision-"));
  const target = path.join(temporary, "target");
  const relativePath = ".agents/skills/demo-skill/SKILL.md";
  const skillFile = path.join(target, relativePath);
  fs.mkdirSync(path.dirname(skillFile), { recursive: true });
  fs.writeFileSync(skillFile, "Tracked by another source.\n");
  const record = {
    source_repository: "example/team-beta",
    source_path: "skills/demo-skill",
    source_ref: "b".repeat(40),
    files: { [relativePath]: installedFingerprint(target, relativePath) },
  };
  fs.mkdirSync(path.join(target, ".agents"), { recursive: true });
  fs.writeFileSync(path.join(target, ".agents/kitia-lock.json"), JSON.stringify({
    lock_version: 1,
    catalog: "grasdouble/Kitia",
    sources: { "team-beta": { skills: { "demo-skill": record } } },
  }));

  assert.throws(() => runSourceCommand({
    action: "install",
    catalog: "team-alpha",
    id: "demo-skill",
    target,
    tool: "copilot",
    scope: "project",
    sourceResources: [{
      catalog: "team-alpha", id: "demo-skill", kind: "skill",
      description: "A source skill.", source_repository: "example/team-alpha",
      source_path: "skills/demo-skill", source_ref: "a".repeat(40),
      license_status: "MIT",
    }],
  }, () => assert.fail("a colliding install must not invoke gh")), /already tracked from another catalog/);
});

test("skill freshness compares the latest SKILL.md revision at installed and catalog pins", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-skill-freshness-"));
  const target = path.join(temporary, "target");
  fs.mkdirSync(target);
  const skillCommit = "26d8943616ffc1be09e121a3a666c284c526a761";
  const previousRepositoryHead = "6f86fd3c8aeda1edebd04ec66261e36ec1d06b7c";
  const resource = {
    catalog: "AI-Kit",
    id: "conventional-commits",
    kind: "skill",
    description: "Conventional commits guidance.",
    source_repository: "grasdouble/AI-Kit",
    source_path: "skills/conventional-commits",
    source_ref: previousRepositoryHead,
    license_status: "MIT",
  };
  const relativePath = ".agents/skills/conventional-commits/SKILL.md";
  let installedRef = skillCommit;
  let skill = [
    "---",
    "name: conventional-commits",
    "description: Conventional commits guidance.",
    "metadata:",
    `  github-repo: "https://github.com/${resource.source_repository}"`,
    `  github-path: "${resource.source_path}"`,
    `  github-ref: "${installedRef}"`,
    `  github-pinned: "${installedRef}"`,
    "---",
    "",
    "Synthetic body.",
    "",
  ].join("\n");
  const skillFile = path.join(target, relativePath);
  fs.mkdirSync(path.dirname(skillFile), { recursive: true });
  fs.writeFileSync(skillFile, skill);
  const lockFile = path.join(target, ".agents/kitia-lock.json");
  writeJson(lockFile, {
    lock_version: 1,
    catalog: "grasdouble/Kitia",
    sources: {
      "AI-Kit": {
        skills: {
          "conventional-commits": {
            source_repository: resource.source_repository,
            source_path: resource.source_path,
            source_ref: installedRef,
            files: { [relativePath]: installedFingerprint(target, relativePath) },
          },
        },
      },
    },
  });
  const writeInstalledRef = (ref) => {
    skill = skill.replaceAll(installedRef, ref);
    installedRef = ref;
    fs.writeFileSync(skillFile, skill);
    const state = readInstallState(target);
    const record = state.sources["AI-Kit"].skills["conventional-commits"];
    record.source_ref = installedRef;
    record.files[relativePath] = installedFingerprint(target, relativePath);
    writeJson(lockFile, state);
  };
  const history = (revisions) => {
    let calls = 0;
    const run = (program, args) => {
      calls += 1;
      assert.equal(program, "gh");
      assert.equal(args[0], "api");
      assert.equal(args[1], "-X");
      assert.equal(args[2], "GET");
      assert.equal(args[3], "repos/grasdouble/AI-Kit/commits");
      assert.ok(args.includes("-f"));
      assert.ok(args.includes(`path=${resource.source_path}/SKILL.md`));
      assert.ok(args.includes("-F"));
      assert.ok(args.includes("per_page=1"));
      const ref = args.find((arg) => arg.startsWith("sha="))?.slice(4);
      assert.ok(ref && Object.hasOwn(revisions, ref), `unexpected history lookup for ${ref}`);
      return JSON.stringify([{ sha: revisions[ref] }]);
    };
    return { run, calls: () => calls, revisions };
  };

  const initialHistory = history({
    [skillCommit]: skillCommit,
    [previousRepositoryHead]: skillCommit,
  });
  const initial = checkInstalledResources(target, [resource], { run: initialHistory.run });
  assert.equal(initialHistory.calls(), 2, "both installed and catalog pins need path-history lookups");
  assert.equal(initial.updateAvailable, false);
  assert.equal(initial.resources[0].status, "current");
  assert.equal(dashboardStatus(initial.resources[0]), "current");
  const dashboardHistory = history({
    [skillCommit]: skillCommit,
    [previousRepositoryHead]: skillCommit,
  });
  const initialInventory = collectInstalledScopes(
    { project: target, user: target }, [resource], { run: dashboardHistory.run },
  );
  assert.deepEqual(initialInventory.errors, []);
  assert.equal(dashboardHistory.calls(), 2, "inventory scopes share both path-history lookups");
  assert.equal(initialInventory.resources[0].status, "current");
  assert.equal(dashboardStatus(initialInventory.resources[0]), "current");

  writeInstalledRef(previousRepositoryHead);
  const newerRepositoryHead = "7".repeat(40);
  resource.source_ref = newerRepositoryHead;
  const unrelatedRepositoryHistory = history({
    [previousRepositoryHead]: skillCommit,
    [newerRepositoryHead]: skillCommit,
  });
  assert.notEqual(previousRepositoryHead, newerRepositoryHead);
  assert.equal(
    unrelatedRepositoryHistory.revisions[previousRepositoryHead],
    unrelatedRepositoryHistory.revisions[newerRepositoryHead],
    "different repository commits with the same SKILL.md path commit must be current",
  );
  const unchangedAtNewerRepositoryHead = checkInstalledResources(
    target, [resource], { run: unrelatedRepositoryHistory.run },
  );
  assert.equal(unrelatedRepositoryHistory.calls(), 2);
  assert.equal(unchangedAtNewerRepositoryHead.updateAvailable, false);
  assert.equal(unchangedAtNewerRepositoryHead.resources[0].status, "current");
  assert.equal(dashboardStatus(unchangedAtNewerRepositoryHead.resources[0]), "current");

  const changedCatalogHead = "8".repeat(40);
  resource.source_ref = changedCatalogHead;
  const changedHistory = history({
    [previousRepositoryHead]: skillCommit,
    [changedCatalogHead]: "c".repeat(40),
  });
  const changed = checkInstalledResources(target, [resource], { run: changedHistory.run });
  assert.equal(changedHistory.calls(), 2);
  assert.equal(changed.updateAvailable, true);
  assert.equal(changed.resources[0].issues[0].code, "UPDATE_AVAILABLE");
  assert.equal(dashboardStatus(changed.resources[0]), "update");
  assert.throws(
    () => checkInstalledResources(target, [resource], {
      run: () => { throw new Error("offline"); },
    }),
    /Cannot check GitHub source history/,
  );
  const unavailableHistory = collectInstalledScopes(
    { project: target }, [resource], { run: () => { throw new Error("offline"); } },
  );
  assert.equal(unavailableHistory.resources.length, 0);
  assert.match(unavailableHistory.errors[0].message, /Cannot check GitHub source history/);
});

for (const { kind, id, sourcePath, installPath } of [
  {
    kind: "agent",
    id: "release-helper",
    sourcePath: "agents/release-helper.agent.md",
    installPath: ".copilot/agents/release-helper.agent.md",
  },
  {
    kind: "instruction",
    id: "review-policy",
    sourcePath: "instructions/review-policy.instructions.md",
    installPath: ".github/instructions/review-policy.instructions.md",
  },
]) {
  test(`${kind} freshness tracks its exact source file at both repository pins`, () => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), `kitia-${kind}-freshness-`));
    const target = path.join(temporary, "target");
    fs.mkdirSync(target);
    const installedRef = "a".repeat(40);
    const catalogRef = "b".repeat(40);
    const sourceRevision = "c".repeat(40);
    const updatedCatalogRef = "d".repeat(40);
    const updatedSourceRevision = "e".repeat(40);
    const resource = {
      catalog: "AI-Kit",
      id,
      kind,
      description: `${kind} fixture.`,
      source_repository: "grasdouble/AI-Kit",
      source_path: sourcePath,
      source_ref: catalogRef,
      license_status: "MIT",
    };
    const installedText = `Managed ${kind} fixture.\n`;
    const installedFile = path.join(target, installPath);
    fs.mkdirSync(path.dirname(installedFile), { recursive: true });
    fs.writeFileSync(installedFile, installedText);
    const lockFile = path.join(target, ".agents/kitia-lock.json");
    writeJson(lockFile, {
      lock_version: 1,
      catalog: "grasdouble/Kitia",
      sources: {
        "AI-Kit": {
          [`${kind}s`]: {
            [id]: {
              source_repository: resource.source_repository,
              source_path: resource.source_path,
              source_ref: installedRef,
              files: { [installPath]: installedFingerprint(target, installPath) },
            },
          },
        },
      },
    });
    const history = (revisions) => {
      let calls = 0;
      const run = (program, args) => {
        calls += 1;
        assert.equal(program, "gh");
        assert.equal(args[0], "api");
        assert.equal(args[1], "-X");
        assert.equal(args[2], "GET");
        assert.equal(args[3], "repos/grasdouble/AI-Kit/commits");
        assert.ok(args.includes(`path=${sourcePath}`), `${kind} history must query its exact source file`);
        const ref = args.find((arg) => arg.startsWith("sha="))?.slice(4);
        assert.ok(ref && Object.hasOwn(revisions, ref), `unexpected ${kind} history lookup for ${ref}`);
        return JSON.stringify([{ sha: revisions[ref] }]);
      };
      return { run, calls: () => calls };
    };

    const sameFileHistory = history({
      [installedRef]: sourceRevision,
      [catalogRef]: sourceRevision,
    });
    const current = checkInstalledResources(target, [resource], { run: sameFileHistory.run });
    assert.equal(sameFileHistory.calls(), 2);
    assert.equal(current.updateAvailable, false);
    assert.equal(current.resources[0].status, "current");
    assert.equal(dashboardStatus(current.resources[0]), "current");

    resource.source_ref = updatedCatalogRef;
    const changedFileHistory = history({
      [installedRef]: sourceRevision,
      [updatedCatalogRef]: updatedSourceRevision,
    });
    const changed = checkInstalledResources(target, [resource], { run: changedFileHistory.run });
    assert.equal(changedFileHistory.calls(), 2);
    assert.equal(changed.updateAvailable, true);
    assert.equal(changed.resources[0].issues[0].code, "UPDATE_AVAILABLE");
    assert.equal(dashboardStatus(changed.resources[0]), "update");

    const unavailable = collectInstalledScopes(
      { project: target }, [resource], { run: () => { throw new Error("offline"); } },
    );
    assert.equal(unavailable.resources.length, 0);
    assert.match(unavailable.errors[0].message, /Cannot check GitHub source history/);
    assert.equal(
      latestSourceVersionAtRef(
        { ...resource, source_repository: "https://gitlab.com/example/AI-Kit" },
        installedRef,
        () => assert.fail("non-GitHub resources must retain exact-pin comparison"),
      ),
      null,
    );
    const unsupported = { source_path: sourcePath.slice(0, sourcePath.lastIndexOf("/")) };
    const state = readInstallState(target);
    const record = state.sources["AI-Kit"][`${kind}s`][id];
    Object.assign(record, unsupported);
    writeJson(lockFile, state);
    const fallback = checkInstalledResources(
      target, [{ ...resource, ...unsupported }],
      { run: () => assert.fail("uninterpretable paths must retain exact-pin comparison") },
    );
    assert.equal(fallback.updateAvailable, true);
    assert.equal(fallback.resources[0].issues[0].code, "UPDATE_AVAILABLE");
  });
}

test("configured source skills use the same pinned install, check, update and uninstall lifecycle", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-source-lifecycle-"));
  const target = path.join(temporary, "target");
  fs.mkdirSync(target);
  const sourceResource = {
    catalog: "team-alpha",
    id: "demo-skill",
    kind: "skill",
    description: "A generated source skill.",
    source_repository: "example/team-alpha",
    source_path: "skills/demo-skill",
    source_ref: "a".repeat(40),
    license_status: "MIT",
  };
  let installedRef = sourceResource.source_ref;
  let updateArgs;
  const invoke = (args) => {
    if (args[args.indexOf("--pin") + 1] !== sourceResource.source_ref) updateArgs = args;
    assert.deepEqual(args.slice(0, 4), [
      "skill", "install", sourceResource.source_repository, sourceResource.source_path,
    ]);
    installedRef = args[args.indexOf("--pin") + 1];
    const skillFile = path.join(target, ".agents/skills/demo-skill/SKILL.md");
    fs.mkdirSync(path.dirname(skillFile), { recursive: true });
    fs.writeFileSync(skillFile, [
      "---",
      "name: demo-skill",
      "description: A generated source skill.",
      "metadata:",
      `  github-repo: "https://github.com/${sourceResource.source_repository}"`,
      `  github-path: "${sourceResource.source_path}"`,
      `  github-ref: "${installedRef}"`,
      `  github-pinned: "${installedRef}"`,
      "---",
      "",
      "Synthetic body.",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(path.dirname(skillFile), "reference.md"), "Supporting file.");
    return 0;
  };

  assert.equal(runSourceCommand({
    action: "install", id: sourceResource.id, catalog: sourceResource.catalog,
    resource: sourceResource, target, tool: "copilot",
  }, invoke), 0);
  const state = readInstallState(target);
  assert.equal(state.sources["team-alpha"].skills["demo-skill"].source_ref, sourceResource.source_ref);
  assert.equal(state.source_skills, undefined);
  assert.equal(readInstalledSourceSkills(target, [sourceResource]).length, 1);
  const checked = checkInstalledResources(target, [sourceResource], { catalog: "team-alpha" });
  assert.equal(checked.updateAvailable, false);
  assert.equal(
    checked.resources.find((resource) => resource.id === sourceResource.id).version,
    installedRef.slice(0, 7),
  );

  const updatedResource = { ...sourceResource, source_ref: "c".repeat(40) };
  const installed = readInstalledSourceSkills(target, [updatedResource]);
  assert.match(updateSourceResources(installed, target, {}, invoke).join("\n"), /Updated team-alpha catalog skill/);
  assert.equal(updateArgs.includes("--force"), false, "the first managed update attempt must not force GH overwrite");
  assert.equal(installedRef, updatedResource.source_ref);
  const failedResource = { ...updatedResource, source_ref: "d".repeat(40) };
  let plannedUpdate;
  updateSourceResources(
    readInstalledSourceSkills(target, [failedResource]),
    target,
    { dryRun: true, onAction: (action) => { plannedUpdate = action; } },
    () => assert.fail("a dry-run update must not invoke gh"),
  );
  assert.equal(plannedUpdate.command.args.includes("--force"), false, "dry-run plans must not force GH overwrite by default");
  const skillFile = path.join(target, ".agents/skills/demo-skill/SKILL.md");
  const installedSkill = fs.readFileSync(skillFile, "utf8");
  fs.writeFileSync(skillFile, "Locally modified managed skill.\n");
  let guardedGhCalls = 0;
  assert.throws(() => updateSourceResources(
    readInstalledSourceSkills(target, [failedResource]),
    target,
    {},
    () => {
      guardedGhCalls++;
      return 0;
    },
  ), (error) => {
    assert.equal(error.code, "LOCAL_CONFLICT");
    assert.equal(error.category, "tracked-modification");
    assert.deepEqual(error.paths, [".agents/skills/demo-skill/SKILL.md"]);
    assert.equal(error.recoverable, true);
    return true;
  });
  assert.equal(guardedGhCalls, 0, "local modifications must be rejected before invoking gh");
  assert.throws(() => updateSourceResources(
    readInstalledSourceSkills(target, [failedResource]),
    target,
    { ghForce: true, ghForceAgent: "github-copilot" },
    () => {
      guardedGhCalls++;
      return 0;
    },
  ), (error) => error.code === "LOCAL_CONFLICT");
  assert.equal(guardedGhCalls, 0, "GH-only force retry must not bypass Kitia's tracked-file guard");
  let forcedArgs;
  assert.throws(() => updateSourceResources(
    readInstalledSourceSkills(target, [failedResource]),
    target,
    { force: true },
    (args) => {
      forcedArgs = args;
      return 1;
    },
  ), /gh exited with status 1/);
  assert.ok(forcedArgs.includes("--force"), "explicit --force must still reach gh");
  fs.writeFileSync(skillFile, installedSkill);
  fs.writeFileSync(path.join(path.dirname(skillFile), "local-notes.txt"), "Keep this file.");
  guardedGhCalls = 0;
  assert.throws(() => updateSourceResources(
    readInstalledSourceSkills(target, [failedResource]),
    target,
    {},
    () => {
      guardedGhCalls++;
      return 0;
    },
  ), (error) => {
    assert.equal(error.code, "LOCAL_CONFLICT");
    assert.equal(error.category, "untracked-skill-content");
    assert.deepEqual(error.paths, [".agents/skills/demo-skill/local-notes.txt"]);
    assert.equal(error.recoverable, true);
    return true;
  });
  assert.equal(guardedGhCalls, 0, "untracked files must be protected before invoking gh");
  assert.throws(() => updateSourceResources(
    readInstalledSourceSkills(target, [failedResource]),
    target,
    { ghForce: true, ghForceAgent: "github-copilot" },
    () => {
      guardedGhCalls++;
      return 0;
    },
  ), (error) => error.code === "LOCAL_CONFLICT");
  assert.equal(guardedGhCalls, 0, "GH-only force retry must not bypass Kitia's untracked-file guard");
  let untrackedForcedArgs;
  assert.throws(() => updateSourceResources(
    readInstalledSourceSkills(target, [failedResource]),
    target,
    { force: true },
    (args) => {
      untrackedForcedArgs = args;
      return 1;
    },
  ), /gh exited with status 1/);
  assert.ok(untrackedForcedArgs.includes("--force"), "explicit --force may replace untracked content");
  fs.unlinkSync(path.join(path.dirname(skillFile), "local-notes.txt"));
  let ghFailure;
  assert.throws(() => updateSourceResources(
    readInstalledSourceSkills(target, [failedResource]),
    target,
    { nonInteractive: true },
    () => ({
      status: 1,
      stderr: "\u001b[31mGitHub API rate limit exceeded; retry later\u001b[0m token ghp_abcdefghijklmnopqrstuvwxyz123456 GH_TOKEN=super-secret-value\n",
      stdout: "ignored stdout",
    }),
  ), (error) => {
    ghFailure = error;
    return true;
  });
  assert.equal(
    ghFailure.message,
    "Could not update team-alpha catalog skill demo-skill for github-copilot: gh exited with status 1. GitHub reports an API rate limit; wait for the limit to reset, then retry. No agents were confirmed updated before this failure. gh diagnostic: GitHub API rate limit exceeded; retry later token [REDACTED] GH_TOKEN=[REDACTED]",
  );
  assert.doesNotMatch(ghFailure.message, /\u001b|\bghp_abcdefghijklmnopqrstuvwxyz123456\b|super-secret-value|ignored stdout/);
  let truncatedFailure;
  assert.throws(() => updateSourceResources(
    readInstalledSourceSkills(target, [failedResource]),
    target,
    { nonInteractive: true },
    () => ({ status: 1, stderr: "x".repeat(401) }),
  ), (error) => {
    truncatedFailure = error;
    return true;
  });
  assert.match(truncatedFailure.message, /x{400}… \[diagnostic truncated\]$/);
  assert.equal(ghFailure.code, "GH_UPDATE_FAILED", "unrelated GH failures must remain ordinary failures");
  const forceRequiredResource = { ...updatedResource, source_ref: "f".repeat(40) };
  let firstAttemptArgs;
  assert.throws(() => updateSourceResources(
    readInstalledSourceSkills(target, [forceRequiredResource]),
    target,
    {},
    (args) => {
      firstAttemptArgs = args;
      return { status: 1, stderr: "skills already installed: demo-skill (Use --force to overwrite)" };
    },
  ), (error) => {
    assert.equal(error.code, "GH_FORCE_REQUIRED");
    assert.equal(error.category, "github-force-required");
    assert.equal(error.recoverable, true);
    assert.equal(error.agent, "github-copilot");
    assert.match(error.userMessage, /already installed and requires --force/);
    assert.doesNotMatch(error.userMessage, /Skills already installed/);
    return true;
  });
  assert.equal(firstAttemptArgs.includes("--force"), false);
  for (const diagnostic of [
    "skills already installed: demo-skill (Use --force to overwrite!)",
    "Skills already installed: demo-skill (Use --force to overwrite!)",
    "Skills already installed:\ndemo-skill (Use --force to overwrite)",
    "prefix Skills already installed: demo-skill (Use --force to overwrite)",
  ]) {
    let nearMatchArgs;
    assert.throws(() => updateSourceResources(
      readInstalledSourceSkills(target, [forceRequiredResource]),
      target,
      {},
      (args) => {
        nearMatchArgs = args;
        return { status: 1, stderr: diagnostic };
      },
    ), (error) => error.code === "GH_UPDATE_FAILED");
    assert.equal(nearMatchArgs.includes("--force"), false);
  }
  updateSourceResources(
    readInstalledSourceSkills(target, [forceRequiredResource]),
    target,
    { ghForce: true, ghForceAgent: "github-copilot" },
    invoke,
  );
  assert.ok(updateArgs.includes("--force"));
  assert.equal(installedRef, forceRequiredResource.source_ref);
  assert.equal(
    readInstallState(target).sources["team-alpha"].skills["demo-skill"].source_ref,
    forceRequiredResource.source_ref,
  );

  let spawnOptions;
  const captured = runGhSkill(["skill", "install"], target, (_program, _args, options) => {
    spawnOptions = options;
    return { status: 1, stdout: "out", stderr: "actionable error" };
  }, { nonInteractive: true, captureOutput: true });
  assert.deepEqual(spawnOptions.stdio, ["ignore", "pipe", "pipe"]);
  assert.equal(spawnOptions.env.GH_PROMPT_DISABLED, "1");
  assert.deepEqual(captured, { status: 1, stdout: "out", stderr: "actionable error" });
  assert.throws(() => runGhSkill(
    ["skill", "install", "https://example.invalid/?token=secret"],
    target,
    () => { throw Object.assign(new Error("secret process details"), { code: "EACCES" }); },
  ), (error) => {
    assert.equal(error.code, "GH_SPAWN_FAILED");
    assert.match(error.message, /EACCES/);
    assert.doesNotMatch(error.message, /example\.invalid|token=secret|secret process details/);
    return true;
  });
  assert.equal(checkInstalledResources(
    target, [forceRequiredResource], { catalog: "team-alpha" },
  ).updateAvailable, false);
  const partialResource = { ...updatedResource, source_ref: "e".repeat(40) };
  const partialInstalled = readInstalledSourceSkills(target, [partialResource]);
  partialInstalled[0].installations.push({
    ...partialInstalled[0].installations[0],
    agent: "claude-code",
    path: ".claude/skills/demo-skill/SKILL.md",
  });
  let partialCalls = 0;
  assert.throws(() => updateSourceResources(
    partialInstalled,
    target,
    { nonInteractive: true },
    (args) => {
      partialCalls += 1;
      return partialCalls === 1 ? invoke(args) : { status: 1, stderr: "unexpected failure" };
    },
  ), (error) => {
    assert.equal(error.code, "GH_UPDATE_FAILED");
    assert.match(error.userMessage, /for claude-code: gh exited with status 1/);
    assert.match(error.userMessage, /did not provide a recognized cause/);
    assert.match(error.userMessage, /github-copilot/);
    assert.doesNotMatch(error.userMessage, /unexpected failure/);
    return true;
  });
  assert.equal(partialCalls, 2);

  assert.match(uninstallSourceResource(updatedResource, target).join("\n"), /Removed team-alpha catalog skill entry point/);
  assert.equal(fs.existsSync(path.join(target, ".agents/skills/demo-skill")), false);
  assert.equal(readInstalledSourceSkills(target, []).length, 0);
});


test("dashboard manages user catalogs and refreshes one or all catalogs", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const { addCatalogModal, catalogTransferModal, refreshCatalogModal, removeCatalogModal } =
    await import("../dist/dashboard/modals.mjs");
  const repository = "https://github.com/example/test";
  const userCatalogsReadyFrame = /^(?=[\s\S]*USER CATALOGS)(?=[\s\S]*ESC inventory)(?=[\s\S]*Q quit)(?![\s\S]*(?:ADD CATALOG|REMOVE CATALOG|IMPORT CATALOGS|REFRESH CATALOG))/;
  const catalogModal = removeCatalogModal({
    catalogs: [{ name: "Test", repository }],
    state: { step: "select", index: 0, name: "Test", message: "", failed: false },
    columns: 100,
  });
  assert.ok(catalogModal.lines.some(({ text }) => text.includes(`Test (${repository})`)));
  const refreshModal = refreshCatalogModal({
    catalogs: [{ name: "Test", repository }],
    state: { step: "scope", scope: "one", index: 0, name: "", message: "", failed: false },
    columns: 100,
  });
  assert.ok(refreshModal.lines.some(({ text }) => text.includes("ONE CATALOG")));
  assert.ok(refreshModal.lines.some(({ text }) => text.includes("ALL CATALOGS")));
  const setupModal = addCatalogModal({
    step: "mode", name: "Test", repository, mode: "basic", kind: "skill",
    path: "", entries: [], message: "", columns: 100,
  });
  assert.ok(setupModal.lines.some(({ text }) => text.includes("skills, agents, and instructions")));
  const skillPathModal = addCatalogModal({
    step: "path", name: "Test", repository, mode: "custom", kind: "skill",
    path: "custom/skills", entries: [], message: "", columns: 100,
  });
  assert.ok(skillPathModal.lines.map(({ bodyText, text }) => bodyText || text).join(" ").includes("parent folder containing multiple skills"));
  const agentPathModal = addCatalogModal({
    step: "path", name: "Test", repository, mode: "custom", kind: "agent",
    path: "custom/agents", entries: [], message: "", columns: 100,
  });
  assert.ok(agentPathModal.lines.map(({ bodyText, text }) => bodyText || text).join(" ").includes("folder containing multiple artifacts"));
  const drive = async (keys, removeCatalog) => {
    const input = new PassThrough();
    input.isTTY = true;
    input.setRawMode = () => {};
    input.ref = () => {};
    input.unref = () => {};
    const output = new PassThrough();
    output.isTTY = true;
    output.columns = 100;
    output.rows = 40;
    let renderedOutput = "";
    output.on("data", (chunk) => { renderedOutput += chunk.toString(); });
    const done = runDashboard([], input, output, [], {
      userCatalogs: [{ name: "Test", repository }],
      removeCatalog,
    });
    let dashboardFinished = false;
    void done.then(() => { dashboardFinished = true; }, () => { dashboardFinished = true; });
    try {
      for (const entry of keys) {
        const [key, expectedOutput] = Array.isArray(entry) ? entry : [entry];
        const previousLength = renderedOutput.length;
        input.write(key);
        if (expectedOutput) {
          await waitForOutput(output, () => {
            const text = renderedOutput.slice(previousLength);
            const start = text.lastIndexOf("\x1b[?2026h");
            const end = text.indexOf("\x1b[?2026l", start);
            return start >= 0 && end > start
              ? require("node:util").stripVTControlCharacters(text.slice(start, end))
              : "";
          }, (frame) => expectedOutput instanceof RegExp
            ? expectedOutput.test(frame) : frame.includes(expectedOutput),
          `output ${String(expectedOutput)}`);
        } else if (key !== "q") {
          await waitForOutput(output, () => renderedOutput,
            (text) => text.length > previousLength, `output after ${JSON.stringify(key)}`);
        }
      }
      for (let attempt = 0; attempt < 3 && !dashboardFinished; attempt += 1) {
        input.write("\x1b");
        await new Promise((resolve) => setTimeout(resolve, 20));
        input.write("q");
        await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 100))]);
      }
      if (!dashboardFinished) throw new Error("Dashboard did not exit after catalog-removal flow");
      return await done;
    } finally {
      input.destroy();
      output.destroy();
    }
  };
  const driveRefresh = async (keys, refreshCatalog, extraActions = {}, exitFrames = ["INVENTORY"]) => {
    const input = new PassThrough();
    input.isTTY = true;
    input.setRawMode = () => {};
    input.ref = () => {};
    input.unref = () => {};
    const output = new PassThrough();
    output.isTTY = true;
    output.columns = 100;
    output.rows = 40;
    let renderedOutput = "";
    output.on("data", (chunk) => { renderedOutput += chunk.toString(); });
    const done = runDashboard([], input, output, [], {
      userCatalogs: [{ name: "Test", repository }],
      refreshCatalog,
      removeCatalog: async () => ({ catalogs: [{ name: "Test", repository }], resources: [] }),
      ...extraActions,
    });
    let dashboardFinished = false;
    done.then(() => { dashboardFinished = true; }, () => { dashboardFinished = true; });
    const awaitDashboardExit = async () => {
      input.write("q");
      let timeout;
      try {
        return await Promise.race([
          done,
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error(
              `Dashboard did not exit after q for ${JSON.stringify(keys)}: ${latestFrame().slice(-400)}`,
            )), 5_000);
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
    };
    const latestFrame = () => {
      const end = renderedOutput.lastIndexOf("\x1b[?2026l");
      const start = renderedOutput.lastIndexOf("\x1b[?2026h", end);
      return start >= 0 && end > start
        ? require("node:util").stripVTControlCharacters(renderedOutput.slice(start, end))
        : "";
    };
    const latestFrameEnd = () => renderedOutput.lastIndexOf("\x1b[?2026l");
    try {
      for (const entry of keys) {
        const [key, expectedOutput] = Array.isArray(entry) ? entry : [entry];
        if (key === "q") {
          const result = await awaitDashboardExit();
          return { result, renderedOutput };
        }
        const previousEnd = latestFrameEnd();
        input.write(key);
        const expected = expectedOutput
          ? expectedOutput instanceof RegExp ? expectedOutput : new RegExp(expectedOutput)
          : key === "m" ? /USER CATALOGS/ : null;
        await waitForOutput(output, latestFrame, (frame) =>
          latestFrameEnd() > previousEnd && (!expected || expected.test(frame)),
        `latest frame after ${JSON.stringify(key)}`, 5_000);
      }
      for (const expectedFrame of exitFrames) {
        const previousEnd = latestFrameEnd();
        input.write("\x1b");
        const expected = expectedFrame instanceof RegExp ? expectedFrame : new RegExp(expectedFrame);
        await waitForOutput(output, latestFrame, (frame) =>
          latestFrameEnd() > previousEnd && expected.test(frame),
        `latest frame after Escape: ${expectedFrame}`, 5_000);
      }
      const result = await awaitDashboardExit();
      dashboardFinished = true;
      return { result, renderedOutput };
    } finally {
      if (!dashboardFinished && !input.destroyed) {
        input.destroy();
        let cleanupTimeout;
        try {
          await Promise.race([
            done.then(() => {}, () => {}),
            new Promise((resolve) => { cleanupTimeout = setTimeout(resolve, 1_000); }),
          ]);
        } finally {
          clearTimeout(cleanupTimeout);
        }
      } else if (!input.destroyed) {
        input.destroy();
      }
      output.destroy();
    }
  };
  const removed = [];
  assert.equal(await drive(
    [["m", "USER CATALOGS"], ["\x1b[3~", "Choose a user catalog to remove:"],
      ["\r", "CONFIRM CATALOG REMOVAL"], ["y", "ENTER / ESC CLOSE"],
      ["\r", "USER CATALOGS"], ["q"]],
    async (name) => {
      removed.push(name);
      return { catalogs: [], resources: [] };
    },
  ), true);
  assert.deepEqual(removed, ["Test"]);
  assert.equal(await drive(
    [["m", "USER CATALOGS"], ["\x1b[3~", "Choose a user catalog to remove:"],
      ["\x1b", userCatalogsReadyFrame], ["q"]],
    async (name) => {
      removed.push(name);
      return { catalogs: [], resources: [] };
    },
  ), true);
  assert.deepEqual(removed, ["Test"]);
  const refreshed = [];
  const refresh = async (name) => {
    refreshed.push(name);
    return {
      catalogs: [{ name: "Test", repository }], resources: [],
      refreshed: [{ name: name || "Test", count: 2 }], failures: [],
    };
  };
  const management = await driveRefresh(["m", "q"], refresh, {
    addCatalog: async () => ({ catalog: "New", count: 0 }),
    updateCatalog: async () => ({ catalog: "Test", count: 0 }),
  });
  assert.equal(management.result, true);
  assert.match(management.renderedOutput, /USER CATALOGS/);
  assert.match(management.renderedOutput, /A add/);
  assert.match(management.renderedOutput, /Delete remove/);
  assert.match(management.renderedOutput, /R refresh/);
  assert.match(management.renderedOutput, /ESC inventory/);
  const presetRequests = [];
  const presetManager = await driveRefresh([
    ["m", /USER CATALOGS/], ["p", /PRESET/], ["\x1b[B", /› Matt Pocock/],
    ["\r", /ADD CATALOG RESULT/],
    ["\r", userCatalogsReadyFrame], "q",
  ], refresh, {
    addCatalog: async (request) => {
      presetRequests.push(request);
      return { catalog: request.name, count: 3, catalogs: [request], resources: [] };
    },
  });
  assert.equal(presetManager.result, true);
  assert.deepEqual(presetRequests, [{
    name: "matt-pocock",
    repository: "https://github.com/mattpocock/skills",
    mode: "basic",
    entries: [],
  }]);
  const anthropicRequests = [];
  const anthropicManager = await driveRefresh([
    ["m", /USER CATALOGS/], ["p", /PRESET/],
    ["\r", /ADD CATALOG RESULT/],
    ["\r", userCatalogsReadyFrame], "q",
  ], refresh, {
    addCatalog: async (request) => {
      anthropicRequests.push(request);
      return { catalog: request.name, count: 6, catalogs: [request], resources: [] };
    },
  });
  assert.equal(anthropicManager.result, true);
  assert.match(anthropicManager.renderedOutput, /anthropics\/skills/);
  assert.deepEqual(anthropicRequests, [{
    name: "Anthropics",
    repository: "https://github.com/anthropics/skills",
    mode: "basic",
    entries: [],
  }]);
  const githubPresetRequests = [];
  const githubPresetManager = await driveRefresh([
    ["m", /USER CATALOGS/], ["p", /PRESET/], ["\x1b[B", /› Matt Pocock/],
    ["\x1b[B", /› GitHub Awesome Copilot/],
    ["\r", /ADD CATALOG RESULT/],
    ["\r", userCatalogsReadyFrame], "q",
  ], refresh, {
    addCatalog: async (request) => {
      githubPresetRequests.push(request);
      return { catalog: request.name, count: 3, catalogs: [request], resources: [] };
    },
  });
  assert.equal(githubPresetManager.result, true);
  assert.deepEqual(githubPresetRequests, [{
    name: "github-awesome-copilot",
    repository: "https://github.com/github/awesome-copilot",
    mode: "basic",
    entries: [],
  }]);
  let cancelledPresetAdded = false;
  const cancelledPreset = await driveRefresh([
    ["m", /USER CATALOGS/], ["p", /ADD CATALOG PRESET/],
    ["\x1b", userCatalogsReadyFrame], "q",
  ], refresh, {
    addCatalog: async () => {
      cancelledPresetAdded = true;
      return { catalog: "unexpected", count: 0 };
    },
  });
  assert.equal(cancelledPreset.result, true);
  assert.ok(cancelledPreset.renderedOutput.indexOf("Anthropics") < cancelledPreset.renderedOutput.indexOf("Matt Pocock"));
  assert.equal(cancelledPresetAdded, false);
  const transfers = [];
  const pastedConfiguration = JSON.stringify({
    catalog_version: 1,
    sources: [
      { name: "Catalog One", repository: "https://github.com/example/one", mode: "basic", entries: [] },
      { name: "Catalog Two", repository: "https://github.com/example/two", mode: "basic", entries: [] },
    ],
  });
  const importSummary = {
    added: ["Imported"],
    ignored: [{ name: "Existing", reason: "Catalog name already exists." }],
    refreshed: [{ name: "Imported", count: 4 }],
    refreshFailures: [{ name: "Other", message: "offline" }],
  };
  const transferManager = await driveRefresh([
    ["m", /USER CATALOGS/],
    ["i", /Paste the JSON catalog configuration below/],
    [pastedConfiguration, /CTRL\+S REVIEW/],
    ["\x13", /SPACE\/ENTER TOGGLE/],
    ["\x1b[B", /› \[x\] Catalog Two/],
    ["\r", /› \[ \] Catalog Two/],
    ["\x13", /Added \(1\): Imported/],
    ["\r", /USER CATALOGS/],
    "q",
  ], refresh, {
    transferCatalogs: async (action, content) => {
      transfers.push({ action, content });
      return {
        catalogs: [{ name: "Imported", repository }],
        resources: [],
        importSummary,
      };
    },
  });
  assert.equal(transferManager.result, true);
  const transferResult = catalogTransferModal({
    action: "import",
    step: "result",
    content: "",
    message: "Imported 1, ignored 1, refreshed 1, refresh failed 1.",
    summary: importSummary,
    working: false,
    columns: 100,
  }).lines.map(({ bodyText, text }) => bodyText || text).join("\n");
  assert.match(transferResult, /Added \(1\): Imported/);
  assert.match(transferResult, /Existing: Catalog name already exists/);
  assert.match(transferResult, /Refreshed \(1\): Imported · 4/);
  assert.match(transferResult, /Other: offline/);
  assert.equal(transfers.length, 1);
  assert.equal(transfers[0].action, "import");
  assert.deepEqual(JSON.parse(transfers[0].content).sources, [
    { name: "Catalog One", repository: "https://github.com/example/one", mode: "basic", entries: [] },
  ]);
  assert.match(transferManager.renderedOutput, /Catalog One/);
  assert.match(transferManager.renderedOutput, /Catalog Two/);
  let cancelledImport = false;
  const cancelImportManager = await driveRefresh([
    ["m", /USER CATALOGS/],
    ["i", /CTRL\+S REVIEW/],
    [pastedConfiguration, /CTRL\+S REVIEW/],
    ["\x13", /SPACE\/ENTER TOGGLE/],
    ["\x1b", /Paste the JSON catalog configuration below/],
    ["\x1b", userCatalogsReadyFrame],
    "q",
  ], refresh, {
    transferCatalogs: async () => {
      cancelledImport = true;
      return {};
    },
  });
  assert.equal(cancelImportManager.result, true);
  assert.equal(cancelledImport, false);
  assert.match(cancelImportManager.renderedOutput, /Catalog Two/);
  const exportTransfers = [];
  const exportManager = await driveRefresh(["m", "x", "\r", "\r", "q"], refresh, {
    transferCatalogs: async (action, content) => {
      exportTransfers.push({ action, content });
      return { catalogs: [{ name: "Test", repository }], resources: [] };
    },
  });
  assert.equal(exportManager.result, true);
  assert.deepEqual(exportTransfers, [{ action: "export", content: "" }]);
  assert.match(exportManager.renderedOutput, /EXPORT CATALOGS/);
  const managementText = require("node:util").stripVTControlCharacters(management.renderedOutput)
    .replace(/[│]/g, " ").replace(/\s+/g, " ");
  assert.match(managementText, /FRESHNESS\s+UNKNOWN/);
  const currentManager = await driveRefresh(["m", "q"], refresh, {
    checkCatalogFreshness: async () => [{ name: "Test", status: "current" }],
  });
  assert.match(currentManager.renderedOutput, /UP TO DATE/);
  const outdatedManager = await driveRefresh(["m", "q"], refresh, {
    checkCatalogFreshness: async () => [{ name: "Test", status: "outdated" }],
  });
  assert.match(outdatedManager.renderedOutput, /OUTDATED/);
  const addFromManager = await driveRefresh([
    ["m", /USER CATALOGS/], ["a", /ADD CATALOG/],
    ["\x1b", userCatalogsReadyFrame], "q",
  ], refresh, {
    addCatalog: async () => ({ catalog: "New", count: 0 }),
  });
  assert.equal(addFromManager.result, true);
  assert.match(addFromManager.renderedOutput, /ADD CATALOG/);
  const submittedDirectoryCatalogs = [];
  const directoryWizard = await driveRefresh([
    "m", "a", "DirectoryCatalog", "\r", repository, "\r", "\x1b[C", "\r", "\r",
    "custom/skills/", "\r",
    ["\r", /Catalog added: DirectoryCatalog · 2 resources indexed/],
    "\r",
    "q",
  ], refresh, {
    addCatalog: async (request) => {
      submittedDirectoryCatalogs.push(request);
      return { catalog: "DirectoryCatalog", count: 2 };
    },
  });
  assert.equal(directoryWizard.result, true);
  assert.deepEqual(submittedDirectoryCatalogs[0], {
    name: "DirectoryCatalog",
    repository,
    mode: "custom",
    entries: [{ kind: "skill", path: "custom/skills" }],
  });
  assert.match(directoryWizard.renderedOutput, /Catalog added: DirectoryCatalog · 2 resources indexed/);
  const submittedEdits = [];
  const editedCatalog = await driveRefresh([
    "m", "e", "\r", "\r", "\r", "\x1b[3~", "a", "\r", "custom/skills/",
    "\r", ["\r", /Catalog updated: Test · 1 resource indexed/], "\r", "q",
  ], refresh, {
    userCatalogs: [{
      name: "Test",
      repository,
      mode: "custom",
      entries: [{ kind: "skill", path: "custom/skills/old" }],
    }],
    updateCatalog: async (originalName, request) => {
      submittedEdits.push({ originalName, request });
      return {
        catalog: request.name,
        count: 1,
        catalogs: [{ ...request }],
        resources: [],
      };
    },
  });
  assert.equal(editedCatalog.result, true);
  assert.deepEqual(submittedEdits, [{
    originalName: "Test",
    request: {
      name: "Test",
      repository,
      mode: "custom",
      entries: [{ kind: "skill", path: "custom/skills" }],
    },
  }]);
  assert.match(editedCatalog.renderedOutput, /EDIT CATALOG/);
  assert.match(editedCatalog.renderedOutput, /Catalog updated: Test · 1 resource indexed/);
  const managerRemoved = [];
  const removedInManager = await driveRefresh([
    "m", "\x1b[3~", "\r", "y",
    ["\x1b", userCatalogsReadyFrame],
    "q",
  ], refresh, {
    removeCatalog: async (name) => {
      managerRemoved.push(name);
      return { catalogs: [], resources: [] };
    },
  });
  assert.equal(removedInManager.result, true);
  assert.deepEqual(managerRemoved, ["Test"]);
  const managerRefreshed = [];
  const refreshedInManager = await driveRefresh([
    ["m", /USER CATALOGS/], ["r", /REFRESH CATALOGS/],
    ["\r", /Choose a user catalog to refresh/],
    ["\r", /Refreshed Test · 1 resource indexed/],
    ["\r", userCatalogsReadyFrame], "q",
  ], async (name) => {
    managerRefreshed.push(name);
    return {
      catalogs: [{ name: "Test", repository }], resources: [],
      refreshed: [{ name, count: 1 }], failures: [],
    };
  });
  assert.equal(refreshedInManager.result, true);
  assert.deepEqual(managerRefreshed, ["Test"]);
  const freshnessChecks = [];
  const targetedFreshness = await driveRefresh(
    [
      ["m", /USER CATALOGS/], ["r", /REFRESH CATALOGS/],
      ["\r", /Choose a user catalog to refresh/], ["\x1b[B", /› Beta/],
      ["\r", /Refreshed Beta · 1 resource indexed/],
      ["\r", userCatalogsReadyFrame], "q",
    ],
    async (name) => ({
      catalogs: [
        { name: "Alpha", repository: "https://github.com/example/alpha" },
        { name: "Beta", repository: "https://github.com/example/beta" },
      ],
      resources: [],
      refreshed: [{ name, count: 1 }],
      failures: [],
    }),
    {
      userCatalogs: [
        { name: "Alpha", repository: "https://github.com/example/alpha" },
        { name: "Beta", repository: "https://github.com/example/beta" },
      ],
      checkCatalogFreshness: async (names) => {
        freshnessChecks.push(names);
        return (names || []).map((name) => ({ name, status: "current" }));
      },
    },
  );
  assert.equal(targetedFreshness.result, true);
  assert.deepEqual(freshnessChecks, [["Alpha", "Beta"], ["Beta"]]);
  const initialDashboard = await driveRefresh(["q"], refresh);
  assert.equal(initialDashboard.result, true);
  assert.doesNotMatch(initialDashboard.renderedOutput, /A add catalog|Delete remove selected|R refresh/);
  assert.doesNotMatch(initialDashboard.renderedOutput, /G refresh/);
  assert.match(initialDashboard.renderedOutput, /↑↓ navigate/);
  assert.match(initialDashboard.renderedOutput, /F filter/);
  assert.match(initialDashboard.renderedOutput, /↑↓ navigate/);
  const ignoredInventoryRefresh = await driveRefresh(["g", "q"], refresh);
  assert.equal(ignoredInventoryRefresh.result, true);
  assert.deepEqual(refreshed, []);
  const refreshedOne = await driveRefresh([
    ["m", /USER CATALOGS/], ["r", /REFRESH CATALOGS/],
    ["\r", /Choose a user catalog to refresh/],
    ["\r", /Refreshed Test · 2 resources indexed/],
    ["\r", userCatalogsReadyFrame], "q",
  ], refresh);
  assert.equal(refreshedOne.result, true);
  assert.deepEqual(refreshed, ["Test"]);
  const refreshedAll = await driveRefresh([
    ["m", /USER CATALOGS/], ["r", /REFRESH CATALOGS/], ["\x1b[C", /‹ ALL CATALOGS ›/],
    ["\r", /Refreshed 1 catalog · 2 resources indexed/],
    ["\r", userCatalogsReadyFrame], "q",
  ], refresh);
  assert.equal(refreshedAll.result, true);
  assert.deepEqual(refreshed, ["Test", undefined]);
  const failedRefresh = await driveRefresh(
    [
      ["m", /USER CATALOGS/], ["r", /REFRESH CATALOGS/],
      ["\r", /Choose a user catalog to refresh/],
      ["\r", /Catalog Test was not refreshed/],
      ["s", /CATALOG REFRESH ERRORS/],
    ],
    async () => ({
      catalogs: [{ name: "Test", repository }], resources: [], refreshed: [],
      failures: [{ name: "Test", message: "Repository not found." }],
    }),
    {},
    ["REFRESH CATALOG", userCatalogsReadyFrame],
  );
  assert.equal(failedRefresh.result, false);
  assert.ok(failedRefresh.renderedOutput.includes("Catalog Test was not refreshed."));
  assert.ok(failedRefresh.renderedOutput.includes("S SHOW DETAILS"));
  assert.ok(failedRefresh.renderedOutput.includes("CATALOG REFRESH ERRORS"));
  assert.ok(failedRefresh.renderedOutput.includes("Test: Repository not found."));
  assert.equal(failedRefresh.renderedOutput.includes("Refreshed Test · 0 resources indexed."), false);
});
test("catalog browser renders custom source folders in SOURCE and detail labels", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const candidates = [
    { catalog: "MattPucock", kind: "skill", id: "engineering-skill", source_repository: "matt/skills", source_path: "engineering/engineering-skill", managed: true },
    { catalog: "MattPucock", kind: "skill", id: "productivity-skill", source_repository: "matt/skills", source_path: "productivity/productivity-skill", managed: true },
    { catalog: "Basic", kind: "skill", id: "basic-skill", source_repository: "basic/skills", source_path: "skills/basic-skill", managed: true },
    { catalog: "MattPucock", kind: "skill", id: "unmapped-skill", source_repository: "matt/skills", source_path: "misc/unmapped-skill", managed: true },
  ];
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 140;
  output.rows = 50;
  let renderedOutput = "";
  output.on("data", (chunk) => { renderedOutput += chunk.toString(); });
  const done = runDashboard([], input, output, [], {
    catalogResources: candidates,
    userCatalogs: [{
      name: "MattPucock",
      repository: "matt/skills",
      mode: "custom",
      entries: [
        { kind: "skill", path: "engineering" },
        { kind: "skill", path: "productivity" },
      ],
    }, { name: "Basic", repository: "basic/skills", mode: "basic", entries: [] }],
  });
  input.write("a");
  await waitForOutput(output, () => renderedOutput,
    (text) => text.includes("\u001b[?2026l") && text.includes("CATALOG RESOURCES"),
    "catalog browser screen");
  input.write("q");
  assert.equal(await done, true);
  input.destroy();
  output.destroy();
  assert.match(renderedOutput, /MattPucock\[engineering\]/);
  assert.match(renderedOutput, /MattPucock\[productivity\]/);
  assert.match(renderedOutput, /Basic/);
  assert.match(renderedOutput, /unmapped-skill/);
  assert.doesNotMatch(renderedOutput, /MattPucock\[misc\]/);
});
test("catalog browser renders mapped source folders and keeps repository-less names", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const candidates = [
    {
      catalog: "MattPucock", kind: "skill", id: "grill-me",
      source_repository: "matt/skills", source_path: "skills/productivity/grill-me",
      description: "Interview practice", managed: true,
    },
    {
      catalog: "BasicCatalog", kind: "skill", id: "basic-skill",
      source_path: "skills/basic-skill", managed: true,
    },
  ];
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 160;
  output.rows = 40;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const done = runDashboard([], input, output, [], {
    catalogResources: candidates,
    userCatalogs: [{
      name: "MattPucock",
      repository: "matt/skills",
      mode: "custom",
      entries: [{ kind: "skill", path: "skills/productivity" }],
    }],
  });
  const plain = () => rendered.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  await waitForOutput(output, () => plain(), (text) => text.includes("INVENTORY"), "initial inventory");
  input.write("a");
  await waitForOutput(output, () => plain(), (text) => text.includes("CATALOG RESOURCES"), "catalog browser");
  assert.ok(plain().split(/\r?\n/).some((line) =>
    line.includes("MattPucock[productivity]") && line.includes("grill-me")));
  assert.ok(plain().split(/\r?\n/).some((line) => line.includes("basic-skill") && line.includes("BasicCatalog")));
  assert.match(plain(), /CATALOG[^\n]*\n[^\n]*MattPucock\[productivity\]/);

  const filterStart = rendered.length;
  input.write("f");
  await waitForOutput(output, () => rendered,
    (text) => text.length > filterStart, "filter input");
  for (const character of "MattPucock[productivity]") input.write(character);
  await waitForOutput(output, () => plain(), (text) => text.includes("AVAILABLE 1/2"),
    "filtered catalog result");
  assert.match(plain(), /AVAILABLE\s+1\/2/);
  assert.ok(plain().split(/\r?\n/).some((line) =>
    line.includes("MattPucock[productivity]") && line.includes("grill-me")));
  input.write("\x1b");
  await new Promise((resolve) => setTimeout(resolve, 50));
  input.write("q");
  assert.equal(await done, true);
  input.destroy();
  output.destroy();
});

test("dashboard refreshes its source catalog set before rebuilding installed skills", async () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-dashboard-source-refresh-"));
  const configDirectory = path.join(temporary, "config");
  const catalogDirectory = path.join(configDirectory, "source-catalogs");
  const target = path.join(temporary, "project");
  const repository = "https://github.com/example/dashboard-skill";
  const source = createSource("upstream", repository);
  const registry = { catalog_version: 1, sources: [{ name: "Test", repository }] };
  const previousConfigDirectory = process.env.KITIA_CONFIG_DIR;
  process.env.KITIA_CONFIG_DIR = configDirectory;
  try {
    const userTarget = path.join(temporary, "user");
    fs.mkdirSync(userTarget, { recursive: true });
    fs.mkdirSync(target, { recursive: true });
    writeJson(path.join(configDirectory, "catalogSources.json"), registry);
    writeJson(path.join(catalogDirectory, "catalogSources.json"), registry);
    writeJson(path.join(catalogDirectory, "Test.json"), createSourceIndex(repository, "Test", source));
    const resource = loadCommandCatalogs({ command: "list" }, () => {})
      .sourceResources.find(({ id }) => id === "demo-skill");
    assert.ok(resource);

    const execute = createDashboardActionHandler(async (options) => {
      const relativePath = ".agents/skills/demo-skill/SKILL.md";
      const skillFile = path.join(options.target, relativePath);
      fs.mkdirSync(path.dirname(skillFile), { recursive: true });
      fs.writeFileSync(skillFile, [
        "---",
        "name: demo-skill",
        "description: Installed from a source catalog.",
        "metadata:",
        `  github-repo: "${resource.source_repository}"`,
        `  github-path: "${resource.source_path}"`,
        `  github-pinned: "${resource.source_ref}"`,
        "---",
        "",
        "Installed skill body.",
        "",
      ].join("\n"));
      recordSourceInstallation(resource, options.target, "github-copilot");
      return 0;
    });
    const result = await execute(
      "install",
      resource,
      { target, userTarget },
      { sourceResources: [resource] },
      { scope: "project", tool: "copilot" },
    );

    assert.equal(result.code, 0);
    assert.ok(result.resources.some((entry) =>
      entry.catalog === "Test" && entry.kind === "skill" && entry.id === "demo-skill"),
    JSON.stringify(result));
  } finally {
    if (previousConfigDirectory === undefined) delete process.env.KITIA_CONFIG_DIR;
    else process.env.KITIA_CONFIG_DIR = previousConfigDirectory;
  }
});
test("dashboard lists unmanaged skills, agents, and instructions without a catalog", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-unmanaged-inventory-"));
  const target = path.join(temporary, "project");
  fs.mkdirSync(target, { recursive: true });
  const externalRepository = "https://github.com/example/external-skills";
  const sourceIndex = createSourceIndex(
    externalRepository, "External", createSource("external-upstream", externalRepository),
  );
  const externalResource = {
    ...sourceIndex.resources[0],
    catalog: "External",
    source_repository: sourceIndex.source_repository,
    source_ref: sourceIndex.source_ref,
  };
  const writeArtifact = (relativePath, content) => {
    const file = path.join(target, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  const sourceSkillPath = ".agents/skills/demo-skill/SKILL.md";
  writeArtifact(sourceSkillPath, [
    "---",
    "name: demo-skill",
    "description: Installed outside Kitia.",
    "metadata:",
    `  github-repo: "${externalResource.source_repository}"`,
    `  github-path: "${externalResource.source_path}"`,
    `  github-pinned: "${externalResource.source_ref}"`,
    "---",
    "",
    "External skill.",
    "",
  ].join("\n"));
  writeArtifact(".claude/skills/category/local-skill/SKILL.md", "Local skill.");
  writeArtifact(".claude/agents/review-helper.md", [
    "---",
    "name: review-helper",
    "description: Reviews code changes.",
    "---",
    "",
  ].join("\n"));
  writeArtifact(".github/instructions/repo-rules.instructions.md", [
    "---",
    "description: Repository-specific guidance.",
    "---",
    "",
  ].join("\n"));
  assert.ok(findUnmanagedArtifacts(target).some((artifact) =>
    artifact.kind === "instruction" && artifact.id === "repo-rules"),
  JSON.stringify(findUnmanagedArtifacts(target)));
  const trackedPath = ".agents/skills/kitia-tracked/SKILL.md";
  writeArtifact(trackedPath, "Tracked through Kitia.");
  const state = readInstallState(target);
  state.sources.Tracked = { skills: { "kitia-tracked": {
    source_repository: "example/tracked",
    source_path: "skills/kitia-tracked",
    source_ref: "a".repeat(40),
    files: { [trackedPath]: installedFingerprint(target, trackedPath) },
  } } };
  writeJson(path.join(target, ".agents/kitia-lock.json"), state);

  const result = collectInstalledScopes({ project: target }, [externalResource]);
  const unmanaged = result.resources.filter((resource) => resource.managed === false);
  assert.deepEqual(
    unmanaged.map(({ kind, id, catalog }) => `${catalog}:${kind}:${id}`).sort(),
    [
      "-:agent:review-helper",
      "-:instruction:repo-rules",
      "-:skill:category/local-skill",
      "-:skill:demo-skill",
    ],
    JSON.stringify(result),
  );
  assert.ok(unmanaged.every((resource) => resource.status === "unmanaged" && resource.scope === "project"));
  const resource = (id) => unmanaged.find((entry) => entry.id === id);
  assert.equal(resource("demo-skill").description, "Installed outside Kitia.");
  assert.equal(resource("review-helper").description, "Reviews code changes.");
  assert.equal(resource("repo-rules").description, "Repository-specific guidance.");
  assert.equal(
    resource("category/local-skill").description,
    ".claude/skills/category/local-skill/SKILL.md",
  );
  const rendered = renderInstalledResources(formatDashboardRows(result.resources, []), {
    columns: 120, isTTY: false,
  });
  assert.match(rendered, /project\s+-\s+skill\s+demo-skill\s+unmanaged/);
  assert.match(rendered, /Installed outside Kitia\./);
  assert.deepEqual(result.errors, []);
  assert.ok(result.resources.some((resource) =>
    resource.catalog === "Tracked" && resource.id === "kitia-tracked" && resource.managed !== false));
});

test("inventory TUI labels a tracked user skill with its custom source folder", async (t) => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-inventory-source-label-"));
  const target = path.join(temporary, "project");
  fs.mkdirSync(target, { recursive: true });
  const sourceResource = {
    catalog: "MattPucock",
    id: "grill-me",
    kind: "skill",
    description: "A relentless interview to sharpen a plan or design.",
    source_repository: "mattpocock/skills",
    source_path: "skills/productivity/grill-me",
    source_ref: "a".repeat(40),
    license_status: "MIT",
  };
  const writeArtifact = (relativePath, lines) => {
    const file = path.join(target, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, lines.join("\n"));
  };
  const sourceMetadata = [
    `  github-repo: "https://github.com/${sourceResource.source_repository}"`,
    `  github-path: "${sourceResource.source_path}"`,
    `  github-ref: "${sourceResource.source_ref}"`,
    `  github-pinned: "${sourceResource.source_ref}"`,
  ];
  const invokeInstall = (args) => {
    assert.deepEqual(args.slice(0, 4), [
      "skill", "install", sourceResource.source_repository, sourceResource.source_path,
    ]);
    writeArtifact(`.agents/skills/${sourceResource.id}/SKILL.md`, [
      "---", `name: ${sourceResource.id}`, `description: ${sourceResource.description}`, "metadata:",
      ...sourceMetadata, "---", "", "Tracked source content.", "",
    ]);
    return 0;
  };
  assert.equal(runSourceCommand({
    action: "install", id: sourceResource.id, catalog: sourceResource.catalog,
    resource: sourceResource, target, tool: "copilot",
  }, invokeInstall), 0);
  writeArtifact(".agents/skills/manual-skill/SKILL.md", [
    "---", "name: manual-skill", "description: Installed outside Kitia.", "metadata:",
    ...sourceMetadata, "---", "", "Untracked source content.", "",
  ]);

  const result = collectInstalledScopes({ user: target }, [sourceResource]);
  const tracked = result.resources.find((resource) => resource.id === "grill-me");
  assert.equal(tracked.catalog, "MattPucock");
  assert.equal(tracked.source_repository, sourceResource.source_repository);
  assert.equal(tracked.source_path, sourceResource.source_path);
  const untracked = result.resources.find((resource) => resource.id === "manual-skill");
  assert.equal(untracked.managed, false);
  assert.equal(untracked.catalog, "-");

  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 120;
  output.rows = 40;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const done = runDashboard(formatDashboardRows(result.resources, [sourceResource]), input, output, [], {
    userCatalogs: [{
      name: "MattPucock",
      mode: "custom",
      entries: [
        { kind: "skill", path: "skills/productivity" },
        { kind: "skill", path: "skills/engineering" },
        { kind: "skill", path: "skills/misc" },
        { kind: "skill", path: "skills/in-progress" },
      ],
    }],
  });
  t.after(async () => {
    if (!input.destroyed) input.destroy();
    await done.catch(() => {});
    if (!output.destroyed) output.destroy();
  });
  await waitForOutput(output, () => rendered,
    (text) => selectedDetailsFrame(text).includes("skill · grill-me") ||
      selectedDetailsFrame(text).includes("skill · manual-skill"),
    "initial selected inventory details");
  let initialFrame = selectedDetailsFrame(rendered);
  if (!initialFrame.includes("skill · grill-me")) {
    const previousLength = rendered.length;
    input.write("\x1b[B");
    await waitForOutput(output, () => rendered,
      (text) => text.length > previousLength && selectedDetailsFrame(text).includes("skill · grill-me"),
      "tracked skill details after moving selection");
    initialFrame = selectedDetailsFrame(rendered);
  }
  assert.ok(initialFrame.includes("manual-skill"), "unmanaged resource remains in the inventory list");
  assert.ok(initialFrame.includes("Unmanaged"), "unmanaged status remains visible in the list");
  const detailLines = assertSeparatedPanelHeader(initialFrame, "SELECTION DETAILS", "skill · grill-me");
  const catalogDetails = detailLines.join("").replace(/\s/g, "");
  assert.ok(catalogDetails.includes("CATALOGMattPucock[productivity]"));
  const descriptionDetails = detailLines.join(" ").replace(/\s+/g, " ");
  assert.ok(descriptionDetails.includes("DESCRIPTION A relentless interview to sharpen a plan or design."));
  input.write("q");
  assert.equal(await done, true);
  input.destroy();
  output.destroy();
});

test("inventory TUI renders multiple configured custom folders and preserves other catalog labels", async (t) => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const resource = (catalog, id, source_path, managed = true) => ({
    catalog,
    id,
    kind: "skill",
    description: id,
    managed,
    scope: "project",
    status: managed ? "current" : "unmanaged",
    source_repository: catalog === "-" ? undefined : `example/${catalog.toLowerCase()}`,
    source_path,
  });
  const resources = [
    resource("MattPucock", "engineering-skill", "custom/engineering/engineering-skill"),
    resource("MattPucock", "productivity-skill", "custom/productivity/productivity-skill"),
    resource("BasicCatalog", "basic-skill", "skills/basic-skill"),
    resource("MattPucock", "unmapped-skill", "other/unmapped-skill"),
    resource("-", "manual-skill", "", false),
  ];
  const userCatalogs = [
    {
      name: "MattPucock",
      repository: "https://github.com/example/mattpucock",
      mode: "custom",
      entries: [
        { kind: "skill", path: "custom/engineering" },
        { kind: "skill", path: "custom/productivity" },
      ],
    },
    { name: "BasicCatalog", repository: "https://github.com/example/basic", mode: "basic", entries: [] },
  ];
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 160;
  output.rows = 40;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const done = runDashboard(resources, input, output, [], { userCatalogs });
  t.after(async () => {
    if (!input.destroyed) input.destroy();
    await done.catch(() => {});
    if (!output.destroyed) output.destroy();
  });
  await waitForOutput(output, () => rendered,
    (text) => resources.some(({ id }) => selectedDetailsFrame(text).includes(`skill · ${id}`)),
    "initial selected inventory details");
  const expectedLabels = new Map([
    ["engineering-skill", "MattPucock[engineering]"],
    ["productivity-skill", "MattPucock[productivity]"],
    ["basic-skill", "BasicCatalog"],
    ["unmapped-skill", "MattPucock"],
    ["manual-skill", "-"],
  ]);
  let frame = selectedDetailsFrame(rendered);
  const observed = new Set();
  for (let index = 0; index < resources.length; index += 1) {
    const selected = resources.find(({ id }) => frame.includes(`skill · ${id}`));
    assert.ok(selected, `a resource is selected in frame ${index + 1}`);
    const expectedLabel = expectedLabels.get(selected.id);
    assert.ok(frame.includes("CATALOG") && frame.includes(expectedLabel),
      `${selected.id} shows its catalog/source-folder label ${expectedLabel}`);
    if (selected.id === "manual-skill") {
      assert.match(frame, /Unmanaged/);
      assert.match(frame, /CATALOG\s+-/);
    }
    observed.add(selected.id);
    if (index + 1 < resources.length) {
      const previousFrame = frame;
      const previousLength = rendered.length;
      input.write("\x1b[B");
      const nextOutput = await waitForOutput(output, () => rendered, (text) => {
        if (text.length <= previousLength) return false;
        const nextFrame = selectedDetailsFrame(text);
        return nextFrame && nextFrame !== previousFrame &&
          resources.some(({ id }) => nextFrame.includes(`skill · ${id}`));
      }, `next inventory detail after ${selected.id}`);
      frame = selectedDetailsFrame(nextOutput);
    }
  }
  assert.deepEqual(observed, new Set(resources.map(({ id }) => id)),
    "every tracked and unmanaged resource remains reachable in the inventory list");
  input.write("q");
  assert.equal(await done, true);
  input.destroy();
  output.destroy();
});

test("removing an unmanaged skill deletes its entire detected folder", async () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-dashboard-unmanaged-remove-"));
  const configDirectory = path.join(temporary, "config");
  const target = path.join(temporary, "project");
  const userTarget = path.join(temporary, "user");
  const skillDirectory = path.join(target, ".agents/skills/manual-skill");
  const previousConfigDirectory = process.env.KITIA_CONFIG_DIR;
  fs.mkdirSync(configDirectory, { recursive: true });
  fs.mkdirSync(skillDirectory, { recursive: true });
  fs.mkdirSync(userTarget, { recursive: true });
  const entryFile = path.join(skillDirectory, "SKILL.md");
  const extraFile = path.join(skillDirectory, "reference.txt");
  fs.writeFileSync(entryFile, "Unmanaged skill entry point.");
  fs.writeFileSync(extraFile, "User-owned supporting file.");
  process.env.KITIA_CONFIG_DIR = configDirectory;
  try {
    const result = await runDashboardWorker({
      task: "resource-action",
      action: "remove-unmanaged",
      resource: { catalog: "-", kind: "skill", id: "manual-skill", scope: "project", managed: false },
      dashboardOptions: { target, userTarget },
      catalogs: { sourceResources: [] },
      installOptions: {},
    });
    assert.equal(result.code, 0);
    assert.equal(fs.existsSync(skillDirectory), false);
    assert.equal(fs.existsSync(entryFile), false);
    assert.equal(fs.existsSync(extraFile), false);
    assert.ok(!result.resources.some((resource) => resource.id === "manual-skill"));
  } finally {
    if (previousConfigDirectory === undefined) delete process.env.KITIA_CONFIG_DIR;
    else process.env.KITIA_CONFIG_DIR = previousConfigDirectory;
  }
});

test("dashboard update dispatch reaches the CLI update command for the selected catalog resource", async () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-dashboard-update-dispatch-"));
  const configDirectory = path.join(temporary, "config");
  const sourceIndexDirectory = path.join(configDirectory, "source-catalogs");
  const target = path.join(temporary, "project");
  const userTarget = path.join(temporary, "user");
  const repository = "https://github.com/example/dashboard-update";
  const previousConfigDirectory = process.env.KITIA_CONFIG_DIR;
  process.env.KITIA_CONFIG_DIR = configDirectory;
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(userTarget, { recursive: true });
  const source = createSource("dashboard-update-upstream", repository);
  const configuration = { catalog_version: 1, sources: [{ name: "Test", repository }] };
  writeJson(path.join(configDirectory, "catalogSources.json"), configuration);
  writeJson(path.join(sourceIndexDirectory, "catalogSources.json"), configuration);
  writeJson(
    path.join(sourceIndexDirectory, "Test.json"),
    createSourceIndex(repository, "Test", source),
  );
  const resource = {
    ...createSourceIndex(repository, "Test", source).resources[0],
    catalog: "Test",
    scope: "project",
    status: "attention",
    managed: true,
  };
  let dispatched;
  try {
    const execute = createDashboardActionHandler(async (options) => {
      dispatched = options;
      return 0;
    });
    const result = await execute(
      "update",
      resource,
      { target, userTarget },
      { sourceResources: [resource] },
    );

    assert.equal(result.code, 0);
    assert.equal(dispatched.command, "update");
    assert.equal(dispatched.catalog, "Test");
    assert.equal(dispatched.kind, "skill");
    assert.equal(dispatched.id, resource.id);
    assert.equal(dispatched.target, target);
    assert.equal(dispatched.nonInteractive, true);
    assert.deepEqual(dispatched.sourceResources, [resource]);
    assert.equal(dispatched.ghForce, undefined, "the initial dashboard update must not request GH force");
    await execute(
      "update",
      resource,
      { target, userTarget },
      { sourceResources: [resource] },
      { ghForce: true, ghForceAgent: "github-copilot" },
    );
    assert.equal(dispatched.ghForce, true, "the explicit retry carries GH-only force state");
    assert.equal(dispatched.ghForceAgent, "github-copilot", "the GH retry identifies the failed agent");
    assert.equal(dispatched.force, false, "a GH retry must not activate Kitia's local-force override");
  } finally {
    if (previousConfigDirectory === undefined) delete process.env.KITIA_CONFIG_DIR;
    else process.env.KITIA_CONFIG_DIR = previousConfigDirectory;
  }
});
test("dashboard update reaches the production CLI and reports a safe local-conflict failure", async () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-dashboard-update-cli-"));
  const configDirectory = path.join(temporary, "config");
  const sourceIndexDirectory = path.join(configDirectory, "source-catalogs");
  const target = path.join(temporary, "project");
  const repository = "https://github.com/example/dashboard-update";
  const previousConfigDirectory = process.env.KITIA_CONFIG_DIR;
  process.env.KITIA_CONFIG_DIR = configDirectory;
  fs.mkdirSync(target, { recursive: true });
  const source = createSource("dashboard-update-cli-upstream", repository);
  const configuration = { catalog_version: 1, sources: [{ name: "Test", repository }] };
  writeJson(path.join(configDirectory, "catalogSources.json"), configuration);
  writeJson(path.join(sourceIndexDirectory, "catalogSources.json"), configuration);
  const index = createSourceIndex(repository, "Test", source);
  writeJson(path.join(sourceIndexDirectory, "Test.json"), index);
  const resource = {
    ...index.resources[0],
    catalog: "Test",
    source_repository: index.source_repository,
    source_ref: index.source_ref,
    scope: "project",
    managed: true,
  };
  const skillFile = path.join(target, ".agents/skills/demo-skill/SKILL.md");
  fs.mkdirSync(path.dirname(skillFile), { recursive: true });
  fs.writeFileSync(skillFile, [
    "---",
    "name: demo-skill",
    "description: A generated source skill.",
    "metadata:",
    `  github-repo: "https://github.com/${resource.source_repository}"`,
    `  github-path: "${resource.source_path}"`,
    `  github-ref: "${resource.source_ref}"`,
    `  github-pinned: "${resource.source_ref}"`,
    "---",
    "",
    "Synthetic installed skill.",
    "",
  ].join("\n"));

  try {
    recordSourceInstallation(resource, target, "github-copilot");
    fs.writeFileSync(skillFile, "Locally modified content that the updater must protect.\n");
    const execute = createDashboardActionHandler(executeCommand);
    await assert.rejects(
      execute("update", resource, { target }, { sourceResources: [resource] }),
      /Refusing to overwrite locally modified .*demo-skill.*SKILL\.md.*--force/,
    );
    const originalLog = console.log;
    const output = [];
    console.log = (line) => output.push(line);
    try {
      assert.equal(await runCliMain([
        "update", "skill", "demo-skill", "--target", target, "--dry-run", "--json",
      ]), 1);
    } finally {
      console.log = originalLog;
    }
    const report = JSON.parse(output.join("\n"));
    assert.equal(report.errors[0].code, "LOCAL_CONFLICT");
    assert.match(report.errors[0].message, /locally modified/);
    assert.equal(fs.readFileSync(skillFile, "utf8"), "Locally modified content that the updater must protect.\n");
  } finally {
    if (previousConfigDirectory === undefined) delete process.env.KITIA_CONFIG_DIR;
    else process.env.KITIA_CONFIG_DIR = previousConfigDirectory;
  }
});


function selectedDetailsFrame(rendered) {
  const end = rendered.lastIndexOf("\u001b[?2026l");
  const start = rendered.lastIndexOf("\u001b[?2026h", end);
  return start >= 0 && end > start
    ? require("node:util").stripVTControlCharacters(rendered.slice(start, end))
    : "";
}

function assertSeparatedPanelHeader(frame, title, firstBody, metadata = []) {
  const lines = frame.split(/\r?\n/);
  const titleRow = lines.findIndex((line) => {
    const column = line.indexOf(title);
    return column >= 2 && line[column - 2] === "│";
  });
  assert.ok(titleRow >= 0, `panel title ${title} is visible inside its frame`);
  const column = lines[titleRow].indexOf(title);
  const contentAt = (row) => lines[row]?.slice(column).split("│", 1)[0].trimEnd();
  for (const [offset, expected] of metadata.entries()) {
    const content = contentAt(titleRow + offset + 1);
    assert.ok(content !== undefined, `${title} metadata row ${offset + 1} remains visible`);
    if (expected instanceof RegExp) assert.match(content, expected);
    else assert.equal(content, expected, `${title} preserves its metadata text and order`);
  }
  const dividerRow = titleRow + metadata.length + 1;
  assert.match(lines[dividerRow].slice(column), /^─+\s*│/,
    `one divider follows ${title} and all its metadata`);
  assert.ok(contentAt(dividerRow + 1)?.trimStart().startsWith(firstBody),
    `${title} content starts immediately below the divider`);
  const body = [];
  for (const line of lines.slice(dividerRow + 1)) {
    if (line[column - 2] !== "│") break;
    const content = line.slice(column).split("│", 1)[0].trimEnd();
    assert.doesNotMatch(content, /^─+$/, `${title} has no duplicate divider`);
    body.push(content);
  }
  return body;
}


test("dashboard renders the resource list and selection panel at wide and narrow widths", async (t) => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  for (const columns of [160, 100]) {
    const input = new PassThrough();
    input.isTTY = true;
    input.setRawMode = () => {};
    input.ref = () => {};
    input.unref = () => {};
    const output = new PassThrough();
    output.isTTY = true;
    output.columns = columns;
    output.rows = 40;
    let rendered = "";
    output.on("data", (chunk) => { rendered += chunk.toString(); });
    const done = runDashboard([{
      catalog: "a-very-long-external-catalog-name-for-layout-smoke-testing",
      kind: "skill",
      id: "manual-skill",
      scope: "project",
      status: "current",
      managed: true,
      description: "A manually maintained skill.",
      source_repository: "example/manual-skill",
      source_path: "skills/manual-skill",
      source_ref: "abcdef0123456789abcdef0123456789abcdef01",
    }], input, output);
    t.after(async () => {
      if (!input.destroyed) input.destroy();
      await done.catch(() => {});
      if (!output.destroyed) output.destroy();
    });
    await waitForOutput(output, () => rendered,
      (text) => selectedDetailsFrame(text).includes("skill · manual-skill"), "selected inventory details");
    const frame = selectedDetailsFrame(rendered);
    input.write("q");
    assert.equal(await done, true);
    assert.match(frame, /INSTALLED RESOURCES/);
    assert.match(frame, /skill · manual-skill/);
    assert.match(frame, /REVISION[\s\S]*abcdef0/);
    const detailLines = assertSeparatedPanelHeader(frame, "SELECTION DETAILS", "skill · manual-skill");
    const compactDetailText = detailLines.join("").replace(/\s/g, "");
    assert.ok(compactDetailText.includes("https://github.com/example/manual-skill"),
      "the complete source URL remains available across wrapped detail rows");
    assert.ok(detailLines.join(" ").replace(/\s+/g, " ")
      .includes("DESCRIPTION A manually maintained skill."));
    const inventoryRow = frame.split(/\r?\n/).find((line) => line.includes("manual-skill") && line.includes("Current"));
    assert.ok(inventoryRow, "inventory row is rendered");
    assert.doesNotMatch(inventoryRow, /A manually maintained skill/);
    assert.doesNotMatch(frame, /DESC\s/);
    const header = frame.split(/\r?\n/).find((line) =>
      line.includes("RESOURCE") && line.includes("KIND") && line.includes("SCOPE") && line.includes("STATUS"));
    assert.ok(header, "inventory header is rendered");
    const column = (label) => header.indexOf(label);
    assert.ok(column("RESOURCE") < column("KIND") && column("KIND") < column("SCOPE") &&
      column("SCOPE") < column("STATUS"), "inventory columns preserve their resource/kind/scope/status order");
    if (columns >= 112) {
      assert.match(frame, /PATH[\s\S]*skills\/manual-skill/);
      assert.match(frame, /DESCRIPTION/);
      assert.match(frame, /STATUS/);
    }
    input.destroy();
    output.destroy();
  }
});
test("catalog browser renders ordered columns without list descriptions at wide and narrow widths", async (t) => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  for (const columns of [160, 100]) {
    const input = new PassThrough();
    input.isTTY = true;
    input.setRawMode = () => {};
    input.ref = () => {};
    input.unref = () => {};
    const output = new PassThrough();
    output.isTTY = true;
    output.columns = columns;
    output.rows = 40;
    let rendered = "";
    output.on("data", (chunk) => { rendered += chunk.toString(); });
    const sourceName = "MattPucock";
    const kind = "instruction";
    const done = runDashboard([], input, output, [], { catalogResources: [{
      catalog: sourceName,
      kind,
      id: "catalog-skill",
      description: "Catalog panel toggle behavior.",
    }] });
    t.after(async () => {
      if (!input.destroyed) input.destroy();
      await done.catch(() => {});
      if (!output.destroyed) output.destroy();
    });
    await waitForOutput(output, () => rendered, (text) => text.includes("INVENTORY"), "initial inventory");
    input.write("a");
    await waitForOutput(output, () => rendered,
      (text) => selectedDetailsFrame(text).includes("CATALOG RESOURCES"), "catalog resources table");
    const frame = selectedDetailsFrame(rendered);
    const header = frame.split(/\r?\n/).find((line) =>
      line.includes("RESOURCE") && line.includes("KIND") && line.includes("CATALOG") && line.includes("INSTALLED"));
    assert.ok(header, "catalog header is rendered");
    assert.ok(header.indexOf("RESOURCE") < header.indexOf("KIND") &&
      header.indexOf("KIND") < header.indexOf("CATALOG") && header.indexOf("CATALOG") < header.indexOf("INSTALLED"));
    const row = frame.split(/\r?\n/).find((line) =>
      line.includes(sourceName) && line.includes("instruction") && line.includes("catalog-skill"));
    assert.ok(row, "catalog row is rendered");
    const positions = ["catalog-skill", "instruction", sourceName].map((label) => row.indexOf(label));
    assert.ok(positions.every((position) => position >= 0), "resource, kind, and catalog values remain in the row");
    assert.ok(positions[0] < positions[1] && positions[1] < positions[2],
      `resource, kind, and catalog order is retained: ${JSON.stringify({ positions, row })}`);
    assert.doesNotMatch(row, /Catalog panel toggle behavior\./);
    assert.doesNotMatch(header, /DESC/);
    const detailLines = assertSeparatedPanelHeader(frame, "SELECTION DETAILS", "instruction ·");
    assert.ok(detailLines.join(" ").replace(/\s+/g, " ").includes("instruction · catalog-skill"),
      "the full resource title remains available when wrapped");
    assert.ok(detailLines.join(" ").replace(/\s+/g, " ")
      .includes("DESCRIPTION Catalog panel toggle behavior."));
    input.write("q");
    assert.equal(await done, true);
    input.destroy();
    output.destroy();
  }
});
test("preview starts with source files and keeps audit and tree pages separate", async () => {
  const { inspectionPageCount, inspectionPageView } = await import("../dist/dashboard/screens.mjs");
  const resource = { catalog: "AI-Kit", kind: "skill", id: "sample" };
  const firstFile = Array.from({ length: 80 }, (_, index) => `First file line ${index}`);
  const secondFile = ["Second file line 0", "Second file line 1"];
  const tree = ["sample/", "├── references/", "│   └── second.md", "└── SKILL.md"];
  const audit = [
    "Audit coverage: 2/2 files analyzed; no files skipped.",
    "  No configured audit rules matched. This is not a safety guarantee.",
  ];
  const content = [
    ...tree, "", "── SKILL.md ──", "", ...firstFile,
    "", "── references/second.md ──", "", ...secondFile, ...audit,
  ].join("\n");
  const options = { action: "preview", resource, content, columns: 90, rows: 40 };
  const sourceCount = inspectionPageCount(options);
  assert.equal(sourceCount, 5);
  const sourcePages = Array.from({ length: sourceCount }, (_, page) =>
    inspectionPageView({ ...options, page }));
  assert.match(sourcePages[0].title, /^FILE SKILL\.md/);
  assert.equal(sourcePages[0].lines[0], firstFile[0]);
  assert.deepEqual(sourcePages.flatMap(({ lines }) => lines), [...firstFile, ...secondFile]);
  assert.equal(sourcePages.at(-1).title, "FILE references/second.md");
  assert.deepEqual(inspectionPageView({ ...options, focus: "source", page: 0 }), sourcePages[0]);
  assert.deepEqual(inspectionPageView({ ...options, page: -1 }), sourcePages[0]);
  assert.deepEqual(inspectionPageView({ ...options, page: sourceCount }), sourcePages.at(-1));
  for (const [focus, title, expected] of [
    ["audit", "AUDIT REPORT", audit.map((line) => line.trim())],
    ["tree", "SOURCE TREE", tree],
  ]) {
    const count = inspectionPageCount({ ...options, focus });
    const pages = Array.from({ length: count }, (_, page) =>
      inspectionPageView({ ...options, focus, page }));
    assert.match(pages[0].title, new RegExp(`^${title}`));
    assert.deepEqual(pages.flatMap(({ lines }) => lines), expected);
    assert.equal(pages[0].pageCount, count);
    assert.deepEqual(inspectionPageView({ ...options, focus, page: count }), pages.at(-1));
  }
});

for (const [kind, sourcePath] of [
  ["skill", "skills/sample"],
  ["agent", "agents/sample.agent.md"],
  ["instruction", "instructions/sample.instructions.md"],
]) {
  test(`preview opens ${kind} content before its fallback tree and unavailable audit`, async () => {
    const { inspectionPageCount, inspectionPageView } = await import("../dist/dashboard/screens.mjs");
    const options = {
      action: "preview",
      resource: { catalog: "sample", kind, id: "sample", source_path: sourcePath },
      content: "# Pinned source\nRead the complete source before installing.",
      columns: 100,
      rows: 40,
      page: 0,
    };
    const source = inspectionPageView(options);
    assert.equal(source.lines[0], "# Pinned source");
    assert.match(source.title, /^FILE /);
    assert.equal(inspectionPageCount(options), 1);
    const tree = inspectionPageView({ ...options, focus: "tree" });
    assert.equal(tree.title, "SOURCE TREE");
    assert.deepEqual(tree.lines, [
      "sample/",
      `└── ${kind === "skill" ? "SKILL.md" : path.basename(sourcePath)}`,
    ]);
    const audit = inspectionPageView({ ...options, focus: "audit" });
    assert.equal(audit.title, "AUDIT REPORT");
    assert.equal(audit.lines.join(" "), "Audit report unavailable; no result was returned.");
    assert.doesNotMatch(audit.lines.join(" "), /No configured audit rules matched|no files skipped|clean/i);
  });
}

function rawSourcePreview(resource, lines) {
  return [
    `id: ${resource.id}`,
    `description: Review repository changes.`,
    `catalog: ${resource.catalog}`,
    `source: ${resource.source_repository}/${resource.source_path}@${resource.source_ref}`,
    "license: MIT",
    `upstream: https://github.com/${resource.source_repository}/tree/${resource.source_ref}/${resource.source_path}`,
    "", ...lines,
  ].join("\n");
}

const previewMarkdownLines = [
  "", "---", "name: reviewer", "---", "",
  "# Review checklist",
  "Item|Status|Note",
  "----|-----|----",
  "Tests|pass|done",
  "",
  "| Item | Status |",
  "| ---- | ------ |",
  "| Docs | ready |",
  "",
  "Section title", "-------------",
  "Another section", "==============",
  "**Review carefully** and *keep emphasis* with [reference](https://example.com/review).",
  "Keep `inline code`, <angle brackets>, & ampersands, café, 漢字 and 🙂 literal.  ",
  "\tIndented source retains tabs and trailing spaces.  ",
  "```javascript",
  "const review = \"approved\";",
  "/* Preserve comment state",
  "   across source lines. */",
  "```",
  "~~~unknown-preview-language",
  "const unrecognized = \"plain source\";",
  "~~~",
  "---", "----", "***", "___",
  "-- important body text --",
  "── ordinary body text ──",
  "— ordinary body text —",
  "– ordinary body text –",
  "",
  "```markdown",
  "── references/checklist.md ──", "",
  "This exact declared header is a fenced example.",
  "```",
  "~~~markdown",
  "── scripts/tools/review.sh ──", "",
  "This other declared header is also a fenced example.",
  "~~~",
  "── missing.md ──", "",
  "An undeclared path is body text.",
  "── SKILL.md ──", "",
  "A repeated entrypoint is body text.",
  "", "",
];

for (const [kind, sourcePath] of [
  ["skill", "skills/reviewer"],
  ["agent", "agents/reviewer.agent.md"],
  ["instruction", "instructions/reviewer.instructions.md"],
]) {
  test(`preview preserves Markdown and exact source page counts for ${kind}`, async () => {
    const { inspectionPageCount, inspectionPageView } = await import("../dist/dashboard/screens.mjs");
    const resource = {
      catalog: "sample", kind, id: "reviewer", source_repository: "org/repo",
      source_path: sourcePath, source_ref: "a".repeat(40),
    };
    const tree = [
      "reviewer/",
      "├── references/",
      "│   └── checklist.md",
      "├── scripts/",
      "│   └── tools/",
      "│       └── review.sh",
      "└── SKILL.md",
    ];
    const files = kind === "skill" ? [
      { path: "SKILL.md", lines: previewMarkdownLines },
      { path: "references/checklist.md", lines: ["", "# Checklist", "Keep every line.", ""] },
      { path: "scripts/tools/review.sh", lines: ["#!/bin/sh", "printf 'review complete\\n'", "", ""] },
    ] : [{ path: path.basename(sourcePath), lines: rawSourcePreview(resource, previewMarkdownLines).split("\n") }];
    const content = kind === "skill"
      ? [...tree, "", ...files.flatMap((file, index) => [
        ...(index ? [""] : []), `── ${file.path} ──`, "", ...file.lines,
      ]), ""].join("\n")
      : files[0].lines.join("\n");
    const options = { resource, content, columns: 240, rows: 100 };
    const count = inspectionPageCount(options);
    assert.equal(count, files.length, "only real source files contribute pages");
    const pages = Array.from({ length: count }, (_, page) => inspectionPageView({ ...options, page }));
    assert.deepEqual(pages.map(({ title }) => title), files.map((file) => `FILE ${file.path}`));
    assert.deepEqual(pages.map(({ lines }) => lines), files.map((file) => file.lines));
    assert.ok(pages.every(({ pageCount }) => pageCount === files.length));
    const treePage = inspectionPageView({ ...options, focus: "tree", page: 0 });
    assert.deepEqual(treePage.lines, kind === "skill" ? tree : [
      "reviewer/", `└── ${path.basename(sourcePath)}`,
    ]);
  });
}

test("preview independently paginates complete long source, audit and tree content at adaptive sizes", async () => {
  const { inspectionPageCount, inspectionPageView } = await import("../dist/dashboard/screens.mjs");
  const tree = [
    "sample/", "├── references/",
    ...Array.from({ length: 80 }, (_, index) => `│   ${index === 79 ? "└" : "├"}── file-${index}.md`),
    "└── SKILL.md",
  ];
  const source = Array.from({ length: 100 }, (_, index) => `Source line ${index}`);
  const audit = [
    "Audit coverage: 1/1 files analyzed; no files skipped.",
    ...Array.from({ length: 80 }, (_, index) => `  WARNING f.md:${index + 1} [PROMPT_OVERRIDE] Finding ${index}`),
  ];
  const options = {
    action: "preview",
    resource: { catalog: "sample", kind: "skill", id: "sample" },
    content: [...tree, "", "── SKILL.md ──", "", ...source, ...audit].join("\n"),
  };
  for (const [columns, rows] of [[120, 45], [72, 40], [120, 18], [60, 24], [56, 12], [120, 8]]) {
    for (const [focus, expected] of [["source", source], ["audit", audit], ["tree", tree]]) {
      const viewport = { ...options, columns, rows, focus };
      const count = inspectionPageCount(viewport);
      assert.ok(count > 1, `${focus} has multiple pages at ${columns}x${rows}`);
      const pages = Array.from({ length: count }, (_, page) => inspectionPageView({ ...viewport, page }));
      assert.deepEqual(
        pages.flatMap(({ lines }) => lines).join("").replace(/\s/g, ""),
        expected.join("").replace(/\s/g, ""),
        `${focus} retains every line at ${columns}x${rows}`,
      );
      assert.deepEqual(pages.map(({ page }) => page), Array.from({ length: count }, (_, page) => page));
      assert.ok(pages.every(({ pageCount }) => pageCount === count));
    }
  }
  assert.ok(
    inspectionPageCount({ ...options, columns: 72, rows: 30 }) >
    inspectionPageCount({ ...options, columns: 72, rows: 45 }),
    "a shorter terminal uses more source pages",
  );
});

test("preview wraps highlighted source without changing whitespace, Unicode or logical-file state", async () => {
  const { inspectionPageCount, inspectionPageView } = await import("../dist/dashboard/screens.mjs");
  const source = [
    "# Exact source",
    "**Emphasis** and [link](https://example.com/?a=1&b=2) with `inline code`.",
    "",
    "```javascript",
    "/* " + "comment continuation café 漢字 🙂 <>& ".repeat(70),
    "still inside the same comment */",
    "const message = `" + "wrapped template content ".repeat(70),
    "template continuation`;",
    "```",
    "\tTrailing whitespace stays intact.  ",
    "",
    "~~~unsupported-preview-language",
    "const plain = '<>&';",
    "~~~",
    "",
  ];
  const resource = { catalog: "sample", kind: "skill", id: "sample" };
  const content = ["sample/", "└── SKILL.md", "", "── SKILL.md ──", "", ...source, ""].join("\n");
  for (const [columns, rows] of [[72, 40], [60, 24]]) {
    const options = { resource, content, columns, rows };
    const width = columns - 6;
    const expected = source.flatMap((line) => {
      if (line.length <= width) return [line];
      const characters = Array.from(line);
      return Array.from({ length: Math.ceil(characters.length / width) }, (_, index) =>
        characters.slice(index * width, (index + 1) * width).join(""));
    });
    const count = inspectionPageCount(options);
    assert.ok(count > 2, "multiline tokens cross source pages");
    const pages = Array.from({ length: count }, (_, page) => inspectionPageView({ ...options, page }));
    assert.deepEqual(pages.flatMap(({ lines }) => lines), expected,
      `source text and wrapping remain exact at ${columns}x${rows}`);
    assert.ok(pages.every(({ lines }) => lines.every((line) => !line.includes("\u001b"))));
    assert.deepEqual(inspectionPageView({ ...options, focus: "tree", page: 0 }).lines,
      ["sample/", "└── SKILL.md"]);
    assert.equal(inspectionPageView({ ...options, focus: "audit", page: 0 }).lines.join(" "),
      "Audit report unavailable; no result was returned.");
  }
});

for (const [kind, columns, rows, hasAudit] of [
  ["skill", 120, 45, true],
  ["agent", 72, 40, true],
  ["instruction", 120, 18, true],
  ["instruction", 72, 40, false],
]) {
  test(`catalog preview independently navigates ${kind} panes at ${columns}x${rows}${hasAudit ? "" : " without an audit"}`, async () => {
    const { PassThrough } = require("node:stream");
    const { stripVTControlCharacters } = require("node:util");
    const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
    const { inspectionPageView } = await import("../dist/dashboard/screens.mjs");
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
    const calls = [];
    const resource = {
      catalog: "sample", kind, id: "reviewer", source_repository: "org/repo", source_ref: "a".repeat(40),
      source_path: kind === "skill" ? "skills/reviewer" : `${kind}s/reviewer.md`,
    };
    const sourceLines = [
      "Source marker 0", "Item|Status|Note", "----|-----|----", "Tests|pass|done",
      ...Array.from({ length: 99 }, (_, index) => `Source marker ${index + 1}`),
    ];
    const sourceOutput = [
      ...(kind === "skill" ? [
        "reviewer/", "├── references/",
        ...Array.from({ length: 60 }, (_, index) => `│   ${index === 59 ? "└" : "├"}── reference-${index}.md`),
        "└── SKILL.md", "", "── SKILL.md ──", "", ...sourceLines,
      ] : rawSourcePreview(resource, sourceLines).split("\n")),
      ...(hasAudit ? [
        "Audit coverage: 1/1 files analyzed; no files skipped.",
        ...Array.from({ length: 60 }, (_, index) =>
          `  WARNING ${kind === "skill" ? "SKILL.md" : resource.source_path}:${index + 1} [PROMPT_OVERRIDE] Audit marker ${index}`),
      ] : []),
    ].join("\n");
    const options = { action: "preview", resource, content: sourceOutput, columns, rows };
    const done = runDashboard([], input, output, [], {
      catalogResources: [resource],
      execute: async (action) => {
        calls.push(action);
        return { code: 0, messages: [sourceOutput], resources: [], errors: [] };
      },
    });
    const press = async (key, expected) => {
      const start = rendered.length;
      input.write(key);
      const frame = await waitForOutput(output,
        () => stripVTControlCharacters(rendered.slice(start)),
        (text) => text.includes(expected), `${JSON.stringify(expected)} after ${JSON.stringify(key)}`);
      return frame;
    };
    const navigate = async (key, focus, page) => {
      const view = inspectionPageView({ ...options, focus, page });
      return press(key, view.lines.find((line) => line.trim()));
    };
    try {
      await new Promise((resolve) => setTimeout(resolve, 80));
      await press("a", "CATALOG RESOURCES");
      const initial = await press("p", kind === "skill" ? "Source marker 0" : "id: reviewer");
      assert.match(initial, /SOURCE PREVIEW/);
      assert.match(initial, new RegExp(`FILE ${kind === "skill" ? "SKILL\\.md" : "reviewer\\.md"}`));
      if (kind === "skill") assert.match(initial, /----\|-----\|----/);
      if (columns >= 120 && rows >= 40) {
        assert.match(initial, /AUDIT REPORT/);
        assert.match(initial, /SOURCE TREE/);
        assert.match(initial, /Audit coverage:/);
      } else {
        assert.doesNotMatch(initial, /AUDIT REPORT|SOURCE TREE/);
      }
      await navigate("\x1b[C", "source", 1);
      const audit = await navigate("a", "audit", 0);
      if (hasAudit) {
        assert.match(audit, /Audit coverage:/);
        await navigate("\x1b[C", "audit", 1);
      } else {
        assert.match(audit.replace(/\s+/g, " "), /Audit report unavailable; no result was returned\./);
        assert.doesNotMatch(audit, /No configured audit rules matched|no files skipped/);
      }
      const treePages = kind === "skill" ? 2 : 1;
      await navigate("t", "tree", 0);
      if (treePages > 1) await navigate("\x1b[C", "tree", 1);
      await navigate("s", "source", 1);
      await navigate("\x1b[D", "source", 0);
      await navigate("a", "audit", hasAudit ? 1 : 0);
      if (hasAudit) await navigate("\x1b[D", "audit", 0);
      await navigate("t", "tree", treePages - 1);
      if (treePages > 1) await navigate("\x1b[D", "tree", 0);
      await navigate("\t", "source", 0);
      assert.deepEqual(calls, ["preview"]);
      await press("\r", "CATALOG RESOURCES");
    } finally {
      await press("\x1b", "INVENTORY");
      input.write("q");
      await done;
      input.destroy();
      output.destroy();
    }
  });
}
test("dashboard toggles the selection panel with D", async (t) => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 160;
  output.rows = 40;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const done = runDashboard([{
    catalog: "sample-catalog",
    kind: "skill",
    id: "manual-skill",
    scope: "project",
    status: "current",
    managed: true,
    description: "Description toggle behavior.",
  }], input, output);
  t.after(async () => {
    if (!input.destroyed) input.destroy();
    await done.catch(() => {});
    if (!output.destroyed) output.destroy();
  });
  await waitForOutput(output, () => rendered,
    (text) => selectedDetailsFrame(text).includes("skill · manual-skill"), "initial selected details");
  const beforeHide = rendered.length;
  input.write("d");
  await waitForOutput(output, () => rendered.slice(beforeHide),
    (text) => text.includes("\u001b[?2026l") && !selectedDetailsFrame(text).includes("SELECTION DETAILS"),
    "hidden details frame");
  const beforeShow = rendered.length;
  input.write("d");
  await waitForOutput(output, () => rendered.slice(beforeShow),
    (text) => text.includes("\u001b[?2026l") && selectedDetailsFrame(text).includes("SELECTION DETAILS"),
    "shown details frame");
  input.write("q");
  assert.equal(await done, true);
  input.destroy();
  output.destroy();
});

test("dashboard toggles the catalog entry panel with D", async (t) => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 160;
  output.rows = 40;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const candidates = [{
    catalog: "sample-catalog",
    kind: "skill",
    id: "catalog-skill",
    description: "Catalog panel toggle behavior.",
  }];
  const done = runDashboard([], input, output, [], { catalogResources: candidates });
  t.after(async () => {
    if (!input.destroyed) input.destroy();
    await done.catch(() => {});
    if (!output.destroyed) output.destroy();
  });
  await waitForOutput(output, () => rendered, (text) => text.includes("INVENTORY"), "initial inventory");
  input.write("a");
  await waitForOutput(output, () => rendered,
    (text) => selectedDetailsFrame(text).includes("CATALOG RESOURCES") &&
      selectedDetailsFrame(text).includes("skill · catalog-skill"),
    "catalog entry details");
  const entryFrame = selectedDetailsFrame(rendered);
  const entryDetails = assertSeparatedPanelHeader(entryFrame, "SELECTION DETAILS", "skill · catalog-skill");
  const entryText = entryDetails.join(" ").replace(/\s+/g, " ");
  assert.ok(entryText.includes("CATALOG sample-catalog"));
  assert.ok(entryText.includes("DESCRIPTION Catalog panel toggle behavior."));
  const beforeHide = rendered.length;
  input.write("d");
  await waitForOutput(output, () => rendered.slice(beforeHide),
    (text) => text.includes("\u001b[?2026l") && !selectedDetailsFrame(text).includes("SELECTION DETAILS"),
    "hidden catalog entry frame");
  const beforeShow = rendered.length;
  input.write("d");
  await waitForOutput(output, () => rendered.slice(beforeShow),
    (text) => text.includes("\u001b[?2026l") && selectedDetailsFrame(text).includes("SELECTION DETAILS"),
    "shown catalog entry frame");
  input.write("q");
  assert.equal(await done, true);
  input.destroy();
  output.destroy();
});

test("dashboard toggles catalog management details with D", async (t) => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 160;
  output.rows = 24;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const done = runDashboard([], input, output, [], {
    userCatalogs: [{ name: "Sample", repository: "example/sample" }],
    checkCatalogFreshness: async () => [{ name: "Sample", status: "current" }],
  });
  t.after(async () => {
    if (!input.destroyed) input.destroy();
    await done.catch(() => {});
    if (!output.destroyed) output.destroy();
  });
  await waitForOutput(output, () => rendered, (text) => text.includes("INVENTORY"), "initial inventory");
  input.write("m");
  await waitForOutput(output, () => rendered,
    (text) => selectedDetailsFrame(text).includes("USER CATALOGS 1") &&
      selectedDetailsFrame(text).includes("REPOSITORY example/sample"),
    "catalog management details");
  const managementFrame = selectedDetailsFrame(rendered);
  assert.match(managementFrame, /USER CATALOGS 1/);
  assert.match(managementFrame, /Sample/);
  assert.match(managementFrame, /REPOSITORY example\/sample/);
  assert.match(managementFrame, /FRESHNESS UP TO DATE/);
  assert.match(managementFrame, /CONNECTED CATALOGS 1/);
  assert.match(managementFrame, /FRESHNESS UP TO DATE/);
  const beforeHide = rendered.length;
  input.write("d");
  await waitForOutput(output, () => rendered.slice(beforeHide),
    (text) => text.includes("\u001b[?2026l") && !selectedDetailsFrame(text).includes("FRESHNESS UP TO DATE"),
    "hidden management details frame");
  const beforeShow = rendered.length;
  input.write("d");
  await waitForOutput(output, () => rendered.slice(beforeShow),
    (text) => text.includes("\u001b[?2026l") && selectedDetailsFrame(text).includes("FRESHNESS UP TO DATE"),
    "shown management details frame");
  input.write("q");
  assert.equal(await done, true);
  input.destroy();
  output.destroy();
});

for (const [screen, dimensions] of [
  ["inventory", [[160, 40], [112, 50], [100, 50], [160, 30], [120, 36], [100, 36]]],
  ["catalog", [[160, 40], [112, 40], [100, 50], [160, 30], [120, 36], [100, 38]]],
  ["management", [[160, 40], [112, 40], [100, 50], [160, 24], [120, 36], [100, 29]]],
]) {
  for (const [columns, rows] of dimensions) {
    test(`${screen} rows, details and shortcuts stay reachable at ${columns}x${rows}`, { timeout: 5_000 }, async () => {
      const { PassThrough } = require("node:stream");
      const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
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
      const resources = Array.from({ length: 60 }, (_, index) => ({
        catalog: "sample",
        kind: "skill",
        id: `resource-${String(index).padStart(2, "0")}`,
        scope: "project",
        status: "current",
        managed: true,
        tags: ["review"],
        license_status: "MIT",
        license_spdx: "MIT",
        description: `Selected description ${index}.`,
        source_repository: "org/repo",
        source_path: "skills/sample",
        source_ref: "main",
      }));
      const catalogs = resources.map((_, index) => ({
        name: `catalog-${String(index).padStart(2, "0")}`,
        repository: `org/repo-${index}`,
      }));
      const done = runDashboard(screen === "inventory" ? resources : [], input, output, [], {
        ...(screen === "catalog" ? { catalogResources: resources } : {}),
        ...(screen === "management" ? { userCatalogs: catalogs } : {}),
      });
      const title = (index) => screen === "management"
        ? `catalog-${String(index).padStart(2, "0")}`
        : `resource-${String(index).padStart(2, "0")}`;
      const frame = () => {
        const value = selectedDetailsFrame(rendered);
        assert.ok(value.trimEnd().split(/\r?\n/).length <= rows,
          `${screen} fits the ${columns}x${rows} viewport`);
        return value;
      };
      const waitForFrame = async (expected, start = 0) => {
        await waitForOutput(output, () => rendered.slice(start),
          (text) => text.includes(expected) && text.includes("\u001b[?2026l"),
          `complete frame containing ${JSON.stringify(expected)}`);
        return frame();
      };
      const press = async (key, expected) => {
        const start = rendered.length;
        input.write(key);
        return waitForFrame(expected, start);
      };
      const assertListAndShortcuts = (value, detailsVisible = true, query = "") => {
        const plain = value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
        const lines = plain.split(/\r?\n/);
        const tableTitle = screen === "inventory" ? "INSTALLED RESOURCES"
          : screen === "catalog" ? "CATALOG RESOURCES" : "CONNECTED CATALOGS 60";
        assert.ok(plain.includes(tableTitle));
        if (screen !== "management") {
          const headerPattern = screen === "inventory"
            ? /RESOURCE\s+KIND\s+SCOPE\s+STATUS/
            : /RESOURCE\s+KIND\s+CATALOG\s+INSTALLED/;
          const tableHeader = lines.find((line) => headerPattern.test(line));
          assert.ok(tableHeader, "resource column headings remain visible");
          assert.match(tableHeader, headerPattern);
          const resultCount = query ? 10 : 60;
          assert.ok(plain.includes(`${resultCount} results`), "the list metadata matches active filters");
          assert.ok(lines.some((line) => /resource-\d\d/.test(line)), "data rows remain visible below the headings");
          assert.equal(plain.includes("SELECTION DETAILS"), detailsVisible);
        } else {
          assert.ok(lines.some((line) => /catalog-\d\d/.test(line)) &&
            lines.some((line) => /org\/repo-\d/.test(line)),
          "catalog card names and repositories remain visible");
          assert.equal(plain.includes("FRESHNESS"), detailsVisible);
          assert.equal(plain.includes("Refresh updates metadata only; installed content stays unchanged."),
            detailsVisible && rows >= 30);
        }
        const shortcutTokens = screen === "inventory"
          ? ["F filter", "C catalog", "K kind", "L license", "D details", "1/2/3 sections", "M catalogs", "↑↓ navigate", "? guide", "Q quit"]
          : screen === "catalog"
            ? ["ENTER install", "V revisions", "P preview/audit", "F filter", "C catalog", "K kind", "L license", "D details", "1/2/3 sections", "ESC back", "↑↓ navigate", "? guide", "Q quit"]
            : ["D details", "ESC inventory", "1/2/3 sections", "↑↓ navigate", "? guide", "Q quit"];
        for (const token of shortcutTokens) assert.ok(plain.includes(token), `shortcut remains reachable: ${token}`);
      };
      const assertSelection = (value, index) => {
        assertListAndShortcuts(value);
        if (screen === "management") {
          assert.ok(value.includes(`catalog-${String(index).padStart(2, "0")}`));
        } else {
          const selectedRow = value.split(/\r?\n/).find((line) =>
            line.includes("›") && line.includes(`resource-${String(index).padStart(2, "0")}`));
          assert.ok(selectedRow, "the selected list row remains in the visible page");
        }
        if (screen === "management") {
          assert.match(value, new RegExp(`org/repo-${index}(?:\\s|│)`));
          assert.match(value, /FRESHNESS/);
          assert.equal(value.includes("Refresh updates metadata only; installed content stays unchanged."), rows >= 30);
          if (rows < 30) assert.match(value, /FRESHNESS UNKNOWN/);
        } else if (screen === "catalog" || rows >= 40) {
          const detailLines = assertSeparatedPanelHeader(value, "SELECTION DETAILS",
            `skill · resource-${String(index).padStart(2, "0")}`);
          const compactDetailText = detailLines.join("").replace(/\s/g, "");
          assert.ok(compactDetailText.includes(`DESCRIPTIONSelecteddescription${index}.`),
            "the selected description remains complete in the details viewport");
          assert.ok(compactDetailText.includes("org/repo"), "the complete source repository remains in the details panel");
        } else if (rows < 40) {
          assert.ok(value.includes("Healthy · no recorded issues") || value.includes("PgUp/PgDn"),
            "short detail panes keep status visible or expose paging");
        }
      };
      try {
        const inventoryFrame = await waitForFrame("INVENTORY");
        const initial = screen === "inventory" ? inventoryFrame
          : await press(screen === "catalog" ? "a" : "m", title(0));
        assertSelection(initial, 0);
        assertSelection(await press("\u001b[A", title(59)), 59);
        const hidden = await press("d", "↑↓ navigate");
        assert.doesNotMatch(hidden, /SELECTION DETAILS|Refresh updates metadata only; installed content stays unchanged\./);
        assertListAndShortcuts(hidden, false);
        assertSelection(await press("d", title(59)), 59);
        assertSelection(await press("\u001b[B", title(0)), 0);
        if (screen !== "management") {
          await press("f", "TYPE to search");
          const filtered = await press("resource-5", "resource-5▏");
          assert.ok(filtered.includes("resource-50"), "live filtering selects a matching resource");
          await press("\r", screen === "catalog" ? "C catalog" : "F filter");
          assertListAndShortcuts(frame(), true, "resource-5");
          const lastMatch = await press("\u001b[A", title(59));
          assertListAndShortcuts(lastMatch, true, "resource-5");
          assert.ok(lastMatch.split(/\r?\n/).some((line) => line.includes("›") && line.includes("resource-59")),
            "filtered navigation keeps the last matching row selected and visible");
          if (screen === "catalog") {
            assertListAndShortcuts(await press("l", "License [MIT]"), true, "resource-5");
          }
          if (screen === "inventory") {
            assertListAndShortcuts(await press("c", "Catalog [sample]"), true, "resource-5");
            assertListAndShortcuts(await press("k", "Kind [skill]"), true, "resource-5");
          }
        }
        input.write("q");
        assert.equal(await done, true);
      } finally {
        input.write("\u001b");
        input.write("q");
        let timeout;
        await Promise.race([done, new Promise((resolve) => { timeout = setTimeout(resolve, 250); })]);
        clearTimeout(timeout);
        input.destroy();
        output.destroy();
      }
    });
  }
}


test("inventory columns reserve usable ID space and expose custom Catalog suffixes at 120 columns", async () => {
  const { detailPanelLayout, tableColumns } = await import("../dist/dashboard/helpers.mjs");
  const listWidth = detailPanelLayout(120).listWidth - 4;
  const catalogWidth = "MattPucock[productivity]".length;
  const columns = tableColumns(listWidth, 21, catalogWidth);
  const wide = tableColumns(160 - 6, 40, catalogWidth);
  const narrower = tableColumns(100 - 6, 40, catalogWidth);
  assert.ok(columns.id >= 20);
  assert.equal(columns.catalog, catalogWidth);
  assert.equal(wide.id >= 12, true);
  assert.equal(narrower.id >= 12, true);
  assert.equal(wide.catalog > narrower.catalog, true);
  assert.equal(tableColumns(60 - 6).catalog, 0);
});

test("dashboard uses a shared list/details split at wide terminal widths", async () => {
  const { detailPanelLayout } = await import("../dist/dashboard/helpers.mjs");
  assert.deepEqual(detailPanelLayout(160), {
    sideBySide: true, listWidth: 106, detailsWidth: 51,
  });
  assert.deepEqual(detailPanelLayout(100), {
    sideBySide: false, listWidth: undefined, detailsWidth: undefined,
  });
});


test("versions parser selects every source kind and install/update accept full SHAs or strict hexadecimal prefixes", () => {
  const sha = "c".repeat(40);
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-versions-args-"));
  const previous = process.env.KITIA_CONFIG_DIR;
  process.env.KITIA_CONFIG_DIR = temporary;
  writeJson(path.join(temporary, "catalogSources.json"), {
    catalog_version: 1, sources: [{ name: "Test", repository: "https://github.com/example/resources" }],
  });
  try {
    for (const kind of ["skill", "agent", "instruction"]) {
      assert.deepEqual(parseArguments(["versions", kind, "demo-resource", "--catalog", "Test"]), {
        command: "versions", kind, id: "demo-resource", catalog: "Test",
      });
      assert.equal(parseArguments(["install", kind, "demo-resource", "--ref", sha]).ref, sha);
      assert.equal(parseArguments(["update", kind, "demo-resource", "--ref", sha.slice(0, 7)]).ref, sha.slice(0, 7));
    }
  } finally {
    if (previous === undefined) delete process.env.KITIA_CONFIG_DIR;
    else process.env.KITIA_CONFIG_DIR = previous;
  }
  assert.throws(() => parseArguments(["install", "skill", "demo-skill", "--ref", "abc"]), /7- to 40-character hexadecimal/);
  assert.throws(() => parseArguments(["install", "skill", "demo-skill", "--ref", "g".repeat(7)]), /7- to 40-character hexadecimal/);
  assert.throws(() => parseArguments(["update", "--ref", sha]), /specific skill, agent, or instruction install or update/);
});
test("bundle commands and offline installs are no longer accepted", () => {
  assert.throws(() => parseArguments([
    "bundle", "export", "bundle.json", "Team:skill:demo-skill", "--signing-key", "private.pem",
  ]), /Unknown command: bundle/);
  assert.throws(() => parseArguments(["install", "skill", "demo-skill", "--offline"]), /Unknown option: --offline/);
});




test("an explicit skill ref is installed and recorded without changing the catalog resource pin", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-explicit-ref-"));
  const target = path.join(temporary, "target");
  fs.mkdirSync(target);
  const catalogResource = {
    catalog: "team-alpha", id: "demo-skill", kind: "skill",
    description: "A source skill.", source_repository: "example/team-alpha",
    source_path: "skills/demo-skill", source_ref: "a".repeat(40), license_status: "MIT",
  };
  const requestedRef = "b".repeat(40);
  let installedRef;
  const invoke = (args) => {
    installedRef = args[args.indexOf("--pin") + 1];
    const skillFile = path.join(target, ".agents/skills/demo-skill/SKILL.md");
    fs.mkdirSync(path.dirname(skillFile), { recursive: true });
    fs.writeFileSync(skillFile, [
      "---", "name: demo-skill", "description: A source skill.", "metadata:",
      `  github-repo: "https://github.com/${catalogResource.source_repository}"`,
      `  github-path: "${catalogResource.source_path}"`,
      `  github-ref: "${installedRef}"`, `  github-pinned: "${installedRef}"`,
      "---", "", "Pinned test revision.", "",
    ].join("\n"));
    return 0;
  };
  assert.equal(runSourceCommand({
    action: "install", id: catalogResource.id, catalog: catalogResource.catalog,
    resource: { ...catalogResource, source_ref: requestedRef }, target, tool: "copilot",
  }, invoke), 0);
  assert.equal(installedRef, requestedRef);
  assert.equal(catalogResource.source_ref, "a".repeat(40));
  assert.equal(readInstallState(target).sources["team-alpha"].skills["demo-skill"].source_ref, requestedRef);
  assert.deepEqual(updateSourceResources(
    readInstalledSourceSkills(target, [catalogResource]), target, {},
    invoke,
  ), [`Updated ${catalogResource.catalog} catalog skill: ${catalogResource.id}`]);
  assert.equal(installedRef, catalogResource.source_ref);
  assert.equal(readInstallState(target).sources["team-alpha"].skills["demo-skill"].source_ref, catalogResource.source_ref);
  assert.equal(catalogResource.source_ref, "a".repeat(40));
  assert.equal(buildSourceSkillArgs("install", { ...catalogResource, source_ref: requestedRef }, "github-copilot")
    .at(-1), requestedRef);
});
test("CLI install --ref replaces only the selected scope and retains skill update safety", async () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-cli-ref-replace-"));
  const projectTarget = path.join(temporary, "project");
  const userTarget = path.join(temporary, "user");
  const oppositeOnlyTarget = path.join(temporary, "opposite-only-project");
  const modifiedTarget = path.join(temporary, "modified");
  const untrackedTarget = path.join(temporary, "untracked");
  const configDirectory = path.join(temporary, "config");
  const indexDirectory = path.join(configDirectory, "source-catalogs");
  const binDirectory = path.join(temporary, "bin");
  fs.mkdirSync(indexDirectory, { recursive: true });
  fs.mkdirSync(binDirectory);
  const catalogResource = {
    catalog: "Test", kind: "skill", id: "demo-skill",
    source_repository: "example/team-alpha", source_path: "skills/demo-skill",
    source_ref: "a".repeat(40), license_status: "MIT",
  };
  const seedTarget = (target) => {
    const directory = path.join(target, ".agents/skills/demo-skill");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "SKILL.md"), [
      "---", "name: demo-skill", "description: A source skill.", "metadata:",
      `  github-repo: "https://github.com/${catalogResource.source_repository}"`,
      `  github-path: "${catalogResource.source_path}"`,
      `  github-ref: "${catalogResource.source_ref}"`, `  github-pinned: "${catalogResource.source_ref}"`,
      "---", "", "Old installed body.", "",
    ].join("\n"));
    recordSourceInstallation(catalogResource, target, "github-copilot");
  };
  for (const target of [projectTarget, userTarget, modifiedTarget, untrackedTarget]) seedTarget(target);
  fs.mkdirSync(oppositeOnlyTarget);
  const modifiedFile = path.join(modifiedTarget, ".agents/skills/demo-skill/SKILL.md");
  fs.appendFileSync(modifiedFile, "Local edit.\n");
  fs.writeFileSync(path.join(untrackedTarget, ".agents/skills/demo-skill/reference.md"), "Untracked content.");
  writeJson(path.join(configDirectory, "catalogSources.json"), {
    catalog_version: 1, sources: [{ name: "Test", repository: "https://github.com/example/team-alpha" }],
  });
  writeJson(path.join(indexDirectory, "catalogSources.json"), {
    catalog_version: 1, sources: [{ name: "Test", repository: "https://github.com/example/team-alpha" }],
  });
  writeJson(path.join(indexDirectory, "Test.json"), {
    catalog_version: 1, catalog_name: "Test", source_repository: "example/team-alpha",
    source_ref: catalogResource.source_ref,
    resources: [{
      kind: "skill", id: catalogResource.id, source_path: catalogResource.source_path,
      description: "A source skill.", license_status: "MIT",
    }],
  });
  const selectedRef = "b".repeat(40);
  const receivedPin = path.join(temporary, "received-pin");
  fs.writeFileSync(path.join(binDirectory, "gh"), [
    "#!/usr/bin/env node",
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'const file = ".agents/skills/demo-skill/SKILL.md";',
    'const ref = process.argv[process.argv.indexOf("--pin") + 1];',
    'fs.writeFileSync(process.env.KITIA_TEST_GH_PIN, ref);',
    'fs.mkdirSync(path.dirname(file), { recursive: true });',
    'let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : `---\\nname: demo-skill\\ndescription: A source skill.\\nmetadata:\\n  github-repo: "https://github.com/example/team-alpha"\\n  github-path: "skills/demo-skill"\\n  github-ref: "${ref}"\\n  github-pinned: "${ref}"\\n---\\n\\nFresh install.\\n`;',
    'text = text.replace(/github-ref: "[^"]+"/, `github-ref: "${ref}"`).replace(/github-pinned: "[^"]+"/, `github-pinned: "${ref}"`).replace("Old installed body.", "Updated body.");',
    'fs.writeFileSync(file, text);',
    "",
  ].join("\n"), { mode: 0o755 });
  const previousConfig = process.env.KITIA_CONFIG_DIR;
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  const previousCwd = process.cwd();
  const previousPin = process.env.KITIA_TEST_GH_PIN;
  process.env.KITIA_CONFIG_DIR = configDirectory;
  process.env.KITIA_TEST_GH_PIN = receivedPin;
  const output = { log() {}, error() {} };
  const invoke = async (scope, target) => {
    const args = scope === "user"
      ? ["install", "skill", "demo-skill", "--catalog", "Test", "--ref", selectedRef, "--scope", "user"]
      : ["install", "skill", "demo-skill", "--catalog", "Test", "--ref", selectedRef, "--target", target];
    const options = {
      ...parseArguments(args),
      output,
      onProgress() {},
      spawnProcess: nodeScriptSpawn(path.join(binDirectory, "gh")),
    };
    if (scope === "user") assert.equal(options.target, userTarget);
    return executeCommand(options, null);
  };
  try {
    assert.equal(await invoke("project", projectTarget), 0);
    assert.equal(fs.readFileSync(receivedPin, "utf8"), selectedRef, "gh receives the requested full SHA via --pin");
    assert.equal(readInstallState(projectTarget).sources.Test.skills["demo-skill"].source_ref, selectedRef);
    assert.equal(readInstallState(userTarget).sources.Test.skills["demo-skill"].source_ref, catalogResource.source_ref);

    process.env.HOME = userTarget;
    process.env.USERPROFILE = userTarget;
    process.chdir(projectTarget);
    const projectRefBeforeUserReplacement = readInstallState(projectTarget).sources.Test.skills["demo-skill"].source_ref;
    assert.equal(await invoke("user", userTarget), 0);
    assert.equal(fs.readFileSync(receivedPin, "utf8"), selectedRef);
    assert.equal(readInstallState(userTarget).sources.Test.skills["demo-skill"].source_ref, selectedRef);
    assert.equal(
      readInstallState(projectTarget).sources.Test.skills["demo-skill"].source_ref,
      projectRefBeforeUserReplacement,
      "user-scope replacement leaves the project installation unchanged",
    );

    await assert.rejects(invoke("project", modifiedTarget), (error) =>
      error.code === "LOCAL_CONFLICT" && error.category === "tracked-modification");
    assert.match(fs.readFileSync(modifiedFile, "utf8"), /Local edit\./);
    await assert.rejects(invoke("project", untrackedTarget), (error) =>
      error.code === "LOCAL_CONFLICT" && error.category === "untracked-skill-content");
    assert.equal(readInstallState(modifiedTarget).sources.Test.skills["demo-skill"].source_ref, catalogResource.source_ref);
    assert.equal(readInstallState(untrackedTarget).sources.Test.skills["demo-skill"].source_ref, catalogResource.source_ref);
    assert.equal(await invoke("project", oppositeOnlyTarget), 0);
    assert.equal(fs.readFileSync(receivedPin, "utf8"), selectedRef);
    assert.equal(readInstallState(oppositeOnlyTarget).sources.Test.skills["demo-skill"].source_ref, selectedRef);

    process.env.HOME = userTarget;
    process.env.USERPROFILE = userTarget;
    process.chdir(userTarget);
    await assert.rejects(invoke("project", userTarget), (error) =>
      error.code === "AMBIGUOUS_RESOURCE" && /project and user scopes resolve to the same target/.test(error.message));
    await assert.rejects(invoke("user", userTarget), (error) =>
      error.code === "AMBIGUOUS_RESOURCE" && /project and user scopes resolve to the same target/.test(error.message));
  } finally {
    if (previousConfig === undefined) delete process.env.KITIA_CONFIG_DIR;
    else process.env.KITIA_CONFIG_DIR = previousConfig;
    if (previousPin === undefined) delete process.env.KITIA_TEST_GH_PIN;
    else process.env.KITIA_TEST_GH_PIN = previousPin;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousUserProfile;
    process.chdir(previousCwd);
  }
});
test("async GitHub skill runner relays sanitized output and bounds a hung process", async () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-gh-timeout-"));
  const script = path.join(temporary, "gh.js");
  fs.writeFileSync(script, `process.stderr.write("\\u001b[31mDownloading token=verysecretcredential https://user:anothersecret@example.invalid/resource?api_key=querysecret\\u001b[0m\\n"); setTimeout(() => {}, 5000);\n`);
  const progress = [];
  await assert.rejects(
    runGhSkillAsync(["skill", "install"], temporary, {
      nonInteractive: true,
      timeout: 1500,
      onProgress: (message) => progress.push(message),
      spawnProcess: nodeScriptSpawn(script),
    }),
    (error) => error.code === "GH_TIMEOUT" &&
      /timed out/i.test(error.userMessage) &&
      /network connectivity/i.test(error.userMessage),
  );
  const output = progress.join("\n");
  assert.match(output, /gh stderr: Downloading token=\[REDACTED\]/i);
  assert.match(output, /https:\/\/\[REDACTED\]@example\.invalid\/resource\?\[REDACTED\]/);
  assert.doesNotMatch(output, /verysecretcredential|anothersecret|querysecret|\u001b|\x1b/);
  assert.ok(progress.some((message) => /timed out/i.test(message)));
});
test("async GitHub skill runner coalesces carriage-return status output", async () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-gh-progress-coalesce-"));
  const script = path.join(temporary, "gh.js");
  fs.writeFileSync(script, [
    "let status = 0;",
    'const timer = setInterval(() => { process.stdout.write(`Status ${++status}\\r`); if (status === 40) { clearInterval(timer); process.stdout.write("Final status\\r"); process.exit(0); } }, 5);',
    "",
  ].join("\n"));
  const progress = [];
  const result = await runGhSkillAsync(["skill", "install"], temporary, {
    timeout: 3000,
    onProgress: (message) => progress.push(message),
    spawnProcess: nodeScriptSpawn(script),
  });
  assert.equal(result.status, 0);
  assert.ok(progress.length <= 4, `expected coalesced events, received ${progress.length}`);
  assert.equal(progress.at(-1), "gh stdout: Final status");
});
test("progress-enabled source install preserves the injected GitHub runner", async () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-async-gh-injection-"));
  const target = path.join(temporary, "project");
  fs.mkdirSync(target);
  const resource = {
    catalog: "Test",
    kind: "skill",
    id: "injected-skill",
    source_repository: "example/repo",
    source_path: "skills/injected-skill",
    source_ref: "b".repeat(40),
    license_status: "MIT",
  };
  const commandOptions = {
    action: "install",
    kind: "skill",
    id: resource.id,
    target,
    tool: "copilot",
    scope: "project",
    nonInteractive: true,
    resource,
    sourceResources: [resource],
    onProgress: () => {},
  };
  const expectedArgs = [
    "skill", "install", "example/repo", "skills/injected-skill",
    "--agent", "github-copilot", "--scope", "project", "--pin", "b".repeat(40),
  ];
  let invoked;
  await assert.rejects(
    runSourceCommand(commandOptions, (args, cwd) => {
      invoked = { args, cwd };
      return 1;
    }),
    (error) => error.code === "GH_INSTALL_FAILED",
  );
  assert.equal(invoked.cwd, fs.realpathSync(target));
  assert.deepEqual(invoked.args, expectedArgs);

  assert.equal(await runSourceCommand(commandOptions, async (args, cwd) => {
    invoked = { args, cwd };
    const skillPath = path.join(target, ".agents", "skills", resource.id, "SKILL.md");
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(skillPath, [
      "---", `name: ${resource.id}`, "description: Injected runner fixture.", "metadata:",
      `  github-repo: "https://github.com/${resource.source_repository}"`,
      `  github-path: "${resource.source_path}"`,
      `  github-ref: "${resource.source_ref}"`, `  github-pinned: "${resource.source_ref}"`,
      "---", "", "Installed by the injected runner.", "",
    ].join("\n"));
    return 0;
  }), 0);
  assert.deepEqual(invoked, { args: expectedArgs, cwd: fs.realpathSync(target) });
  assert.equal(readInstallState(target).sources.Test.skills["injected-skill"].source_ref, resource.source_ref);

  const rejectedRunnerError = new Error("injected runner rejection");
  await assert.rejects(
    runSourceCommand(commandOptions, () => Promise.reject(rejectedRunnerError)),
    (error) => error === rejectedRunnerError,
  );
});
test("real GH update progress and sanitized output reach the TUI through its worker", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-worker-progress-"));
  const configDirectory = path.join(temporary, "config");
  const sourceIndexDirectory = path.join(configDirectory, "source-catalogs");
  const target = path.join(temporary, "project");
  const userTarget = path.join(temporary, "user");
  const ghScript = path.join(temporary, "gh.js");
  const ghPreload = path.join(temporary, "gh-spawn-preload.cjs");
  const repository = "https://github.com/example/worker-progress";
  const previousEnvironment = Object.fromEntries(
    ["KITIA_CONFIG_DIR", "KITIA_TEST_SKILL_FILE", "KITIA_TEST_SKILL_CONTENT", "KITIA_TEST_GH_SCRIPT"]
      .map((key) => [key, process.env[key]]),
  );
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(userTarget, { recursive: true });
  fs.writeFileSync(ghPreload, [
    'const childProcess = require("node:child_process");',
    "const originalSpawn = childProcess.spawn;",
    'childProcess.spawn = (command, args, options) => command === "gh"',
    "  ? originalSpawn(process.execPath, [process.env.KITIA_TEST_GH_SCRIPT, ...args], options)",
    "  : originalSpawn(command, args, options);",
    "",
  ].join("\n"));
  const source = createSource("worker-progress-upstream", repository);
  const oldRef = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  fs.appendFileSync(path.join(source, "skills", "demo-skill", "SKILL.md"), "\nSecond source revision.\n");
  execFileSync("git", ["-C", source, "add", "."]);
  execFileSync("git", [
    "-C", source, "-c", "user.name=Catalog fixtures", "-c",
    "user.email=fixtures@example.invalid", "-c", "commit.gpgsign=false",
    "commit", "--quiet", "-m", "Update synthetic skill",
  ]);
  const sourceIndex = createSourceIndex(repository, "Test", source);
  const newResource = {
    ...sourceIndex.resources.find(({ kind }) => kind === "skill"),
    catalog: "Test",
    source_repository: sourceIndex.source_repository,
    source_ref: sourceIndex.source_ref,
  };
  const newRef = sourceIndex.source_ref;
  const skillFile = path.join(target, ".agents", "skills", newResource.id, "SKILL.md");
  const makeSkill = (ref) => [
    "---",
    `name: ${newResource.id}`,
    "description: Worker progress fixture.",
    "metadata:",
    `  github-repo: "https://github.com/${newResource.source_repository}"`,
    `  github-path: "${newResource.source_path}"`,
    `  github-pinned: "${ref}"`,
    "---",
    "",
    "Fixture skill.",
    "",
  ].join("\n");
  fs.mkdirSync(path.dirname(skillFile), { recursive: true });
  fs.writeFileSync(skillFile, makeSkill(oldRef));
  recordSourceInstallation({ ...newResource, source_ref: oldRef }, target, "github-copilot");
  writeJson(path.join(configDirectory, "catalogSources.json"), {
    catalog_version: 1,
    sources: [{ name: "Test", repository }],
  });
  writeJson(path.join(sourceIndexDirectory, "catalogSources.json"), {
    catalog_version: 1,
    sources: [{ name: "Test", repository }],
  });
  writeJson(path.join(sourceIndexDirectory, "Test.json"), sourceIndex);

  fs.writeFileSync(ghScript, [
    'const fs = require("node:fs");',
    `const output = ${JSON.stringify("\u001b[32mFetching https://user:passsecret@example.invalid/resource?token=querysecret token=verysecretcredential\u001b[0m\n")};`,
    "setTimeout(() => process.stdout.write(output), 500);",
    "setTimeout(() => { fs.writeFileSync(process.env.KITIA_TEST_SKILL_FILE, process.env.KITIA_TEST_SKILL_CONTENT); process.exit(0); }, 800);",
    "",
  ].join("\n"));
  process.env.KITIA_CONFIG_DIR = configDirectory;
  process.env.KITIA_TEST_SKILL_FILE = skillFile;
  process.env.KITIA_TEST_SKILL_CONTENT = makeSkill(newRef);
  process.env.KITIA_TEST_GH_SCRIPT = ghScript;

  const installedResource = {
    ...newResource,
    source_ref: oldRef,
    scope: "project",
    status: "attention",
    managed: true,
    issues: [{ code: "UPDATE_AVAILABLE", paths: [".agents/skills/demo-skill/SKILL.md"] }],
  };
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 120;
  output.rows = 40;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const done = runDashboard([installedResource], input, output, [], {
    catalogResources: [newResource],
    listSourceVersions: async () => [
      { sha: oldRef, prefix: oldRef.slice(0, 7), date: "2026-11-09T00:00:00Z", subject: "Installed pin" },
      { sha: newRef, prefix: newRef.slice(0, 7), date: "2026-11-08T00:00:00Z", subject: "Selected update" },
    ],
    execute: (action, resource, options) => {
      const { onProgress, ...installOptions } = options;
      return runDashboardWorker({
        task: "resource-action",
        action,
        resource,
        dashboardOptions: { target, userTarget },
        catalogs: { sourceResources: [newResource] },
        installOptions,
      }, onProgress, { execArgv: ["--require", ghPreload] });
    },
  });
  const visibleFrame = () => {
    const start = rendered.lastIndexOf("\u001b[?2026h");
    const end = rendered.indexOf("\u001b[?2026l", start);
    return start >= 0 && end > start
      ? require("node:util").stripVTControlCharacters(rendered.slice(start, end))
      : "";
  };
  const waitForFrame = (predicate, message) =>
    waitForOutput(output, visibleFrame, predicate, `dashboard ${message}`, 10_000);
  let finished = false;
  try {
    await waitForFrame((frame) => frame.includes("↑↓ navigate"), "Inventory");
    input.write("a");
    await waitForFrame((frame) => frame.includes("CATALOG RESOURCES"), "Catalog");
    input.write("v");
    await waitForFrame((frame) => frame.includes("RESOURCE REVISIONS"), "version picker");
    input.write("\x1b[B");
    await waitForFrame((frame) => frame.includes(`› ${newRef.slice(0, 7)}`), "selected commit");
    input.write("\r");
    await waitForFrame((frame) => frame.includes("CONFIRM UPDATE"), "update confirmation");
    input.write("y");
    const phase = await waitForFrame(
      (frame) => frame.includes(`Invoking GitHub CLI to update ${newResource.id} for github-copilot`),
      "the actual worker's GitHub update phase",
    );
    assert.ok(phase.includes("Invoking GitHub CLI to update"));
    const ghOutput = await waitForFrame((frame) => frame.includes("Fetching https://[REDACTED]@example.invalid/resource?[REDACTED]"),
      "sanitized GitHub progress output");
    assert.ok(ghOutput.includes("token=[REDACTED]"));
    assert.doesNotMatch(ghOutput, /passsecret|querysecret|verysecretcredential|[\u001b]/);
    for (let attempt = 0; attempt < 100 &&
        !fs.readFileSync(skillFile, "utf8").includes(`github-pinned: "${newRef}"`); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(fs.readFileSync(skillFile, "utf8").includes(`github-pinned: "${newRef}"`));
    await waitForFrame((frame) => frame.includes("Q quit") && !frame.includes("LOADING"), "completed update result");
    input.write("q");
    let exitTimeout;
    const exited = await Promise.race([
      done,
      new Promise((_, reject) => {
        exitTimeout = setTimeout(() => reject(new Error("Dashboard did not exit after q")), 5_000);
      }),
    ]).finally(() => clearTimeout(exitTimeout));
    assert.equal(exited, true);
    finished = true;
  } finally {
    input.destroy();
    if (!finished) {
      let cleanupTimeout;
      await Promise.race([
        done.catch(() => {}),
        new Promise((resolve) => {
          cleanupTimeout = setTimeout(resolve, 5_000);
        }),
      ]).finally(() => clearTimeout(cleanupTimeout));
    }
    output.destroy();
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
