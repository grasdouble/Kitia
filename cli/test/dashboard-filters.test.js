"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { listCatalogResources } = require("../dist/cli/catalog.js");
const { filterCatalogResources, cycleFilter } = require("../dist/dashboard/helpers.mjs");

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

test("catalog browser filters compose tag, status, and SPDX license constraints", () => {
  const resources = [
    { id: "release-helper", kind: "skill", catalog: "main", tags: ["release"], status: "stable", license_status: "MIT", license_spdx: "MIT" },
    { id: "release-agent", kind: "agent", catalog: "main", tags: ["review"], status: "experimental", license_status: "Apache-2.0", license_spdx: "Apache-2.0" },
    { id: "release-guide", kind: "instruction", catalog: "other", tags: ["review"], status: "stable", license_status: "Proprietary" },
  ];
  assert.deepEqual(filterCatalogResources(resources, "", "all", "all", [], { tag: "review" })
    .map(({ id }) => id), ["release-agent", "release-guide"]);
  assert.deepEqual(filterCatalogResources(resources, "", "all", "all", [], { status: "stable" })
    .map(({ id }) => id), ["release-helper", "release-guide"]);
  assert.deepEqual(filterCatalogResources(resources, "", "all", "all", [], { license: "Apache-2.0" })
    .map(({ id }) => id), ["release-agent"]);
  assert.deepEqual(filterCatalogResources(resources, "release", "main", "skill", [], {
    tag: "release", status: "stable", license: "MIT",
  }).map(({ id }) => id), ["release-helper"]);
  assert.equal(cycleFilter("all", resources, "tag", "kind", "all"), "release");
});
