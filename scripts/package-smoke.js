"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run the package smoke test with npm run test:package.");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kiti-package-test-"));
const buildFile = path.join(root, "dist/catalog-build.json");
const previousBuild = fs.existsSync(buildFile) ? fs.readFileSync(buildFile) : null;
const npm = (args, cwd) => execFileSync(process.execPath, [npmCli, "--silent", ...args], {
  cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
});

try {
  const [archive] = JSON.parse(npm([
    "pack", "--json", "--pack-destination", temporary,
  ], root));
  const packed = new Set(archive.files.map(({ path: file }) => file));
  for (const file of [
    "package.json",
    "README.md",
    "catalogs/catalog.json",
    "catalogs/catalogSources.json",
    "catalogs/CATALOG.md",
    "bin/kiti.js",
    "dist/cli/main.js",
    "dist/catalog/resources/install-plan.js",
    "docs/cli-contract.md",
    "schemas/catalog-lock-v1.schema.json",
    "migrations/run.js",
  ]) {
    assert.ok(packed.has(file), `Missing package file: ${file}`);
  }
  assert.equal([...packed].some((file) => file.startsWith("tests/")), false);
  assert.equal([...packed].some((file) => file.startsWith("site-build/")), false);
  assert.deepEqual([...packed].filter((file) => file.startsWith("bin/")), ["bin/kiti.js"]);

  const catalog = JSON.parse(fs.readFileSync(path.join(root, "catalogs/catalog.json"), "utf8"));

  const consumer = path.join(temporary, "consumer");
  fs.mkdirSync(consumer);
  fs.writeFileSync(path.join(consumer, "package.json"), '{"private":true}\n');
  npm(["install", "--no-audit", "--no-fund", path.join(temporary, archive.filename)], consumer);
  const installedRoot = path.join(consumer, "node_modules/kiti");
  const manifest = JSON.parse(fs.readFileSync(path.join(installedRoot, "package.json"), "utf8"));
  assert.deepEqual(manifest.bin, { kiti: "./bin/kiti.js" });

  const cli = path.join(consumer, "node_modules/.bin/kiti");
  const listed = JSON.parse(execFileSync(cli, [
    "list", "--catalog", "internal", "--json",
  ], { cwd: consumer, encoding: "utf8" }));
  assert.deepEqual(catalog.resources, []);
  assert.deepEqual(listed, []);
} finally {
  if (previousBuild) fs.writeFileSync(buildFile, previousBuild);
  else fs.rmSync(buildFile, { force: true });
  fs.rmSync(temporary, { recursive: true, force: true });
}
