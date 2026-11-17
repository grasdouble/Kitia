"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { createDashboardActionHandler } = require("../dashboard.ts");

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

test("dashboard adapter adds audit and output capture only to preview/install commands", async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-dashboard-inspection-"));
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
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
