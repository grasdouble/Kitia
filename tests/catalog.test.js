"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { buildCatalog } = require("../scripts/generate-catalog.js");
const { validateCatalog } = require("../dist/catalog/resources/files.js");

const root = path.resolve(__dirname, "..");

test("Kiti's internal catalog intentionally contains no AI resource bodies", () => {
  const generated = buildCatalog(root);
  const resources = validateCatalog(root);
  assert.deepEqual(generated.resources, []);
  assert.deepEqual(resources, []);
  assert.deepEqual(JSON.parse(fs.readFileSync(
    path.join(root, "catalogs/catalog.json"), "utf8",
  )).resources, []);
  assert.equal(fs.existsSync(path.join(root, "skills")), false);
});


test("skill distribution excludes nested dependency trees", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kiti-skill-files-"));
  try {
    const realRoot = fs.realpathSync(temporary);
    const skillRoot = path.join(realRoot, "skills/demo-skill");
    fs.mkdirSync(path.join(skillRoot, "node_modules/package"), { recursive: true });
    fs.writeFileSync(path.join(skillRoot, "SKILL.md"), "Skill body.\n");
    fs.writeFileSync(path.join(skillRoot, "node_modules/package/runtime.js"), "Not part of the skill.\n");
    const files = require("../dist/catalog/resources/files.js").readSourceFiles(
      { kind: "skill", source: skillRoot },
      realRoot,
    );
    assert.deepEqual(files.map(([name]) => name), ["SKILL.md"]);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

