"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { listCatalogResources } = require("../dist/cli/catalog.js");
const { filterCatalogResources, filterInventory, cycleFilter, cycleCatalogFilter, cycleInventoryLicense } = require("../dist/dashboard/helpers.mjs");

test("catalog discovery ranks exact identifiers and preserves existing filters", () => {
  const resources = [
    { id: "release-helper", kind: "skill", catalog: "main", description: "Helps with release notes", tags: ["release"] },
    { id: "release", kind: "agent", catalog: "main", description: "Prepares software releases", tags: ["automation"] },
    { id: "release-guide", kind: "instruction", catalog: "other", description: "Release process", tags: ["release"] },
  ];
  const ranked = listCatalogResources(resources, { query: "release" });
  assert.deepEqual(ranked.map(({ id }) => id), ["release", "release-helper", "release-guide"]);
  assert.deepEqual(listCatalogResources(resources, {
    query: "release", kind: "skill", tag: "release",
  }).map(({ id }) => id), ["release-helper"]);
  assert.deepEqual(filterCatalogResources(resources, "release", "main", "all")
    .map(({ id }) => id), ["release", "release-helper"]);
});

test("catalog browser search covers discovery metadata fields", () => {
  const resource = {
    id: "deploy-helper", kind: "skill", catalog: "main",
    category: "deployment", owner: "platform", tags: ["release"],
    status: "stable", license_status: "MIT", license_spdx: "MIT",
    use_when: "shipping software", example: "deploy release",
    expected_output: "deployment plan", source_repository: "org/tools",
    source_path: "skills/deploy-helper",
  };
  for (const query of [
    "deployment", "platform", "release", "stable", "MIT", "shipping",
    "deploy", "plan", "org/tools", "skills/deploy-helper",
  ]) {
    assert.deepEqual(filterCatalogResources([resource], query, "all", "all"), [resource], query);
  }
});

test("catalog browser filters combine catalog, kind, and SPDX license constraints", () => {
  const resources = [
    { id: "release-helper", kind: "skill", catalog: "main", tags: ["release"], status: "stable", license_status: "MIT", license_spdx: "MIT" },
    { id: "release-agent", kind: "agent", catalog: "main", tags: ["review"], status: "experimental", license_status: "Apache-2.0", license_spdx: "Apache-2.0" },
    { id: "release-guide", kind: "instruction", catalog: "other", tags: ["review"], status: "stable", license_status: "Proprietary" },
  ];
  assert.deepEqual(filterCatalogResources(resources, "", "all", "all", [], { license: "Apache-2.0" })
    .map(({ id }) => id), ["release-agent"]);
  assert.deepEqual(filterCatalogResources(resources, "release", "main", "skill", [], { license: "MIT" })
    .map(({ id }) => id), ["release-helper"]);
});

test("catalog cycling respects paired scope and SPDX license choices", () => {
  const resources = [
    { id: "a", catalog: "one", kind: "skill", license_status: "MIT", license_spdx: "MIT" },
    { id: "b", catalog: "one", kind: "skill", license_status: "Apache-2.0", license_spdx: "Apache-2.0" },
    { id: "c", catalog: "one", kind: "agent", license_status: "MIT", license_spdx: "MIT" },
    { id: "d", catalog: "two", kind: "skill", license_status: "GPL-3.0-only", license_spdx: "GPL-3.0-only" },
  ];
  const filters = { catalog: "one", kind: "skill", license: "all" };
  assert.equal(cycleCatalogFilter("all", resources, "catalog", { ...filters, kind: "agent" }), "one");
  assert.equal(cycleCatalogFilter("all", resources, "kind", { ...filters, catalog: "two" }), "skill");
  assert.equal(cycleCatalogFilter("all", resources, "license", filters), "Apache-2.0");
});


test("Inventory license filtering and cycling respect active catalog and kind", () => {
  const resources = [
    { id: "one-skill", catalog: "one", kind: "skill", source_repository: "org/one", source_path: "skills/one", license_status: "MIT", license_spdx: "MIT" },
    { id: "one-agent", catalog: "one", kind: "agent", source_repository: "org/one", source_path: "agents/one.md", license_status: "Apache-2.0", license_spdx: "Apache-2.0" },
    { id: "two-skill", catalog: "two", kind: "skill", source_repository: "org/two", source_path: "skills/two", license_status: "Proprietary" },
  ];
  assert.equal(cycleInventoryLicense("all", resources, "one", "skill"), "MIT");
  assert.deepEqual(filterInventory(resources, "", "one", "skill", [], undefined, "MIT")
    .map(({ id }) => id), ["one-skill"]);
  assert.equal(cycleInventoryLicense("MIT", resources, "one", "skill"), "all");
  assert.equal(cycleInventoryLicense("stale", resources, "two", "skill"), "Proprietary");
});

test("inventory paired filter cycling remains scoped to its paired facet", () => {
  const resources = [
    { id: "one-skill", catalog: "one", kind: "skill", tags: ["x"], source_repository: "org/one", source_path: "skills/one-skill" },
    { id: "one-agent", catalog: "one", kind: "agent", tags: ["y"], source_repository: "org/one", source_path: "agents/one-agent.md" },
    { id: "two-skill", catalog: "two", kind: "skill", tags: ["y"], source_repository: "org/two", source_path: "skills/two-skill" },
  ];
  assert.equal(cycleFilter("all", resources, "kind", "catalog", "one"), "agent");
});
