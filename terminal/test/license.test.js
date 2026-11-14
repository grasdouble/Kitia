"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { createSourceIndex } = require("../dist/catalog/sources/manage.js");
const { listCatalogResources } = require("../dist/cli/catalog.js");
const { parseArguments } = require("../dist/cli/arguments.js");

let temporary;
after(() => {
  if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
});

test("source indexes distinguish SPDX expressions from unknown upstream license values", () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-spdx-catalog-"));
  const repository = path.join(temporary, "repo");
  const resources = [
    { id: "mit-only", license: "MIT" },
    { id: "dual-license", license: "MIT OR Apache-2.0" },
    { id: "custom-license", license: "Acme  commercial license" },
    { id: "no-license" },
  ];
  for (const resource of resources) {
    const directory = path.join(repository, "skills", resource.id);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "SKILL.md"), [
      "---",
      `name: ${resource.id}`,
      `description: ${resource.id} test resource.`,
      ...(resource.license ? [`license: ${resource.license}`] : []),
      "---",
      "Resource body.",
    ].join("\n"));
  }
  execFileSync("git", ["init", "--quiet", repository]);
  execFileSync("git", ["-C", repository, "remote", "add", "origin", "https://github.com/example/licenses"]);
  execFileSync("git", ["-C", repository, "add", "."]);
  execFileSync("git", [
    "-C", repository, "-c", "user.name=License fixtures", "-c",
    "user.email=fixtures@example.invalid", "-c", "commit.gpgsign=false",
    "commit", "--quiet", "-m", "Add license test resources",
  ]);

  const catalog = createSourceIndex("https://github.com/example/licenses", "licenses", repository);
  const byId = new Map(catalog.resources.map((resource) => [resource.id, resource]));
  assert.equal(byId.get("mit-only").license_status, "MIT");
  assert.equal(byId.get("mit-only").license_spdx, "MIT");
  assert.equal(byId.get("dual-license").license_status, "MIT OR Apache-2.0");
  assert.equal(byId.get("dual-license").license_spdx, "MIT OR Apache-2.0");
  assert.equal(byId.get("custom-license").license_status, "Acme  commercial license");
  assert.equal(byId.get("custom-license").license_spdx, undefined);
  assert.equal(byId.get("no-license").license_status, "not-declared");
  assert.equal(byId.get("no-license").license_spdx, undefined);

  assert.deepEqual(listCatalogResources(catalog.resources,
    parseArguments(["list", "--license", "Apache-2.0"])).map(({ id }) => id), ["dual-license"]);
  assert.deepEqual(listCatalogResources(catalog.resources,
    parseArguments(["search", "mit", "--license", "MIT"])).map(({ id }) => id), ["mit-only", "dual-license"]);
  assert.deepEqual(listCatalogResources(catalog.resources,
    parseArguments(["list", "--license", "Acme  commercial license"])).map(({ id }) => id), ["custom-license"]);
  assert.deepEqual(listCatalogResources(catalog.resources,
    parseArguments(["list", "--license", "not-declared"])).map(({ id }) => id), ["no-license"]);
});
