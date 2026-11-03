"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { validateCatalog } = require("../dist/catalog/resources/files.js");

const { validateEntry } = require("../dist/catalog/entries.js");

const root = path.resolve(__dirname, "..");

test("Kitia loads with no repository-maintained catalog manifests", () => {
  assert.equal(fs.existsSync(path.join(root, "catalogs/catalog.json")), false);
  assert.equal(fs.existsSync(path.join(root, "catalogs/catalogSources.json")), false);
  assert.deepEqual(validateCatalog(root), []);
  assert.equal(fs.existsSync(path.join(root, "skills")), false);
});

test("catalog validation rejects derived-only resource fields in source entries", () => {
  assert.throws(() => validateEntry({
    id: "demo",
    kind: "skill",
    description: "Synthetic test resource",
    owner: "Kitia",
    category: "general",
    tags: ["test"],
    status: "stable",
    use_when: "Testing catalog validation.",
    example: "Use the test fixture.",
    expected_output: "Validation rejects the extra field.",
    prerequisites: ["Node.js"],
    limitations: ["Test only."],
    group: "general",
    compatibility: {
      claude: { status: "compatible" },
      copilot: { status: "compatible" },
    },
    apply_to: ["**/*"],
    source: "skills/demo/SKILL.md",
  }, "synthetic resource"), /unsupported fields: source/);
});


test("skill distribution excludes nested dependency trees", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-skill-files-"));
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

