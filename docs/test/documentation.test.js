"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const YAML = require("yaml");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function markdownFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? markdownFiles(file) : entry.name.endsWith(".md") ? [file] : [];
  });
}

test("local Markdown links resolve", () => {
  const files = [
    ...["README.md", "CONTRIBUTING.md", "CHANGELOG.md"]
      .map((file) => path.join(root, file)),
    ...markdownFiles(path.join(root, "docs")),
    ...markdownFiles(path.join(root, "cli", "migrations")),
    ...markdownFiles(path.join(root, ".github")),
  ];
  for (const file of files) {
    for (const [, url] of fs.readFileSync(file, "utf8").matchAll(/\[[^\]\n]*\]\(([^\s)]+)\)/g)) {
      if (/^[a-z]+:/i.test(url)) continue;
      const [relative] = url.split("#");
      assert.ok(fs.existsSync(path.resolve(path.dirname(file), relative || path.basename(file))),
        `${path.relative(root, file)}: missing ${url}`);
    }
  }
});


test("package, workflow, and docs agree on runtime and project identity", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.name, "@grasdouble/kitia");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.engines.node, ">=22");
  assert.deepEqual(pkg.bin, { kitia: "cli/bin/kitia.js" });
  assert.match(pkg.repository.url, /github\.com\/grasdouble\/Kitia\.git$/);
  assert.match(read("README.md"), /^# Kitia/m);
});

test("release workflow pins the Lufa Changesets action and preserves publishing contracts", () => {
  const workflow = YAML.parse(read(".github/workflows/npm-publish.yml"));
  const pkg = JSON.parse(read("package.json"));
  const steps = workflow.jobs.release.steps;
  const release = steps.find((step) => step.uses?.startsWith(
    "grasdouble/Lufa-CICD/actions/changesets-release@",
  ));
  const setupNode = steps.find((step) => step.uses?.startsWith("actions/setup-node@"));

  assert.deepEqual(workflow.on, { push: { branches: ["main"] } });
  assert.deepEqual(workflow.permissions, {
    contents: "write",
    "pull-requests": "write",
    "id-token": "write",
  });
  assert.ok(release);
  assert.equal(
    release.uses,
    "grasdouble/Lufa-CICD/actions/changesets-release@4d341814e051c0f528b4ffc5537dd7ec13e85963",
  );
  assert.deepEqual(release.with, {
    "version-command": "pnpm run changeset:version",
    "publish-command": "pnpm run release",
    "pr-title": "chore: version packages",
    "commit-message": "chore: version packages",
    "create-github-releases": "true",
    "release-token": "${{ secrets.GITHUB_TOKEN }}",
  });
  assert.equal(setupNode.with["node-version"], 22);
  assert.equal(setupNode.with["registry-url"], "https://registry.npmjs.org");
  assert.equal(pkg.scripts["changeset:version"], "changeset version && pnpm install --lockfile-only --ignore-scripts");
  assert.equal(pkg.scripts.release, "changeset publish");
});
