"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { buildSite } = require("../scripts/build-site.js");
const { createSiteServer } = require("../scripts/serve-site.js");

const root = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kiti-site-test-"));
const output = path.join(temporary, "public");
const originalConfigDir = process.env.KITI_CONFIG_DIR;
process.env.KITI_CONFIG_DIR = path.join(temporary, "config");

after(() => {
  fs.rmSync(temporary, { recursive: true, force: true });
  if (originalConfigDir === undefined) delete process.env.KITI_CONFIG_DIR;
  else process.env.KITI_CONFIG_DIR = originalConfigDir;
});

test("site build publishes public source metadata without leaking user catalog configuration", () => {
  fs.mkdirSync(path.join(temporary, "config"), { recursive: true });
  fs.writeFileSync(path.join(temporary, "config", "catalogSources.json"), JSON.stringify({
    catalog_version: 1,
    sources: [{ name: "Test", repository: "https://github.com/grasdouble/AI-Kit" }],
  }));
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, "stale.html"), "stale");
  buildSite(output);

  for (const page of ["index.html", "catalog.html", "documentation.html", "contribute.html", "app.js"]) {
    assert.ok(fs.existsSync(path.join(output, page)), `Missing site page: ${page}`);
  }
  assert.equal(fs.existsSync(path.join(output, "stale.html")), false);
  assert.equal(fs.existsSync(path.join(output, "assets/catalog-dashboard.png")), false);
  const published = JSON.parse(fs.readFileSync(path.join(output, "data/catalog.json"), "utf8"));
  assert.deepEqual(published.resources, []);
  const sourceDirectory = path.join(output, "data/source-catalogs");
  assert.deepEqual(fs.readdirSync(sourceDirectory), ["catalogSources.json"]);
  assert.deepEqual(JSON.parse(fs.readFileSync(
    path.join(sourceDirectory, "catalogSources.json"), "utf8",
  )), { catalog_version: 1, sources: [] });
});

test("local site server serves catalog data and pages without exposing arbitrary files", async () => {
  const server = createSiteServer({
    sourceDataDirectory: path.join(output, "data/source-catalogs"),
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (url) => new Promise((resolve, reject) => {
    http.get(new URL(url, base), (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body }));
    }).on("error", reject);
  });
  try {
    const page = await get("/");
    assert.equal(page.status, 200);
    assert.match(page.body, /Your catalogs/);
    assert.match(page.body, /ILLUSTRATIVE DATA/);
    assert.match(page.body, /Artifact content stays upstream/);
    const publicCatalog = await get("/catalog.html");
    assert.equal(publicCatalog.status, 200);
    assert.match(publicCatalog.body, /PUBLIC INDEX/);
    assert.match(publicCatalog.body, /local Kiti dashboard/);
    const guide = await get("/documentation.html");
    assert.equal(guide.status, 200);
    assert.match(guide.body, /One dashboard for connected catalogs/);
    const sources = await get("/contribute.html");
    assert.equal(sources.status, 200);
    assert.match(sources.body, /Kiti does not own an AI artifact catalog/);
    assert.equal((await get("/data/catalog.json")).status, 200);
    assert.equal(JSON.parse((await get("/data/catalog.json")).body).resources.length, 0);
    assert.equal((await get("/data/source-catalogs/catalogSources.json")).status, 200);
    assert.equal((await get("/data/source-catalogs/unknown.json")).status, 404);
    assert.equal((await get("/missing.js")).status, 404);
    assert.equal((await get("/../package.json")).status, 404);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
