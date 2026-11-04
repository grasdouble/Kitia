"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run the package smoke test with npm run cli:test:package-smoke.");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-package-test-"));
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
    "cli/bin/kitia.js",
    "cli/dist/cli/main.js",
    "docs/cli-contract.md",
    "cli/schemas/catalog-lock-v1.schema.json",
    "cli/migrations/run.js",
  ]) {
    assert.ok(packed.has(file), `Missing package file: ${file}`);
  }
  assert.equal([...packed].some((file) => file.startsWith("cli/test/")), false);
  assert.equal([...packed].some((file) => file.startsWith("catalogs/")), false);
  assert.deepEqual([...packed].filter((file) => file.startsWith("cli/bin/")), ["cli/bin/kitia.js"]);

  const consumer = path.join(temporary, "consumer");
  fs.mkdirSync(consumer);
  const home = path.join(temporary, "home");
  fs.mkdirSync(home);
  const consumerEnvironment = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    KITIA_CONFIG_DIR: path.join(temporary, "config"),
  };
  fs.writeFileSync(path.join(consumer, "package.json"), '{"private":true}\n');
  npm(["install", "--no-audit", "--no-fund", path.join(temporary, archive.filename)], consumer);
  const installedRoot = path.join(consumer, "node_modules/@grasdouble/kitia");
  const manifest = JSON.parse(fs.readFileSync(path.join(installedRoot, "package.json"), "utf8"));
  assert.deepEqual(manifest.bin, { kitia: "cli/bin/kitia.js" });

  const cli = path.join(installedRoot, manifest.bin.kitia);
  execFileSync(process.execPath, [cli, "dashboard"], {
    cwd: consumer,
    encoding: "utf8",
    env: consumerEnvironment,
  });
  const listed = JSON.parse(execFileSync(process.execPath, [cli, "list", "--json"], {
    cwd: consumer,
    encoding: "utf8",
    env: consumerEnvironment,
  }));
  assert.deepEqual(listed, []);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
