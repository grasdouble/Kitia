"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { checkInstalledVersion } = require("../dist/dashboard/version-check.mjs");

test("version check returns an update notice and changelog link for a newer release", async () => {
  let requestedUrl;
  const result = await checkInstalledVersion("1.0.0", async (url, options) => {
    requestedUrl = [url, options];
    return new Response(JSON.stringify({ version: "1.0.2" }), { status: 200 });
  });
  assert.deepEqual(result, {
    label: "1.0.0 - New version available",
    notice: {
      installed: "1.0.0",
      available: "1.0.2",
      changelogUrl: "https://github.com/grasdouble/Kitia/blob/main/CHANGELOG.md#102",
    },
  });
  assert.equal(requestedUrl[0], "https://registry.npmjs.org/@grasdouble%2Fkitia/latest");
  assert.equal(requestedUrl[1].headers.accept, "application/json");
});

test("version check leaves current and unknown versions without a notice", async () => {
  const fetchVersion = async () => new Response(JSON.stringify({ version: "1.0.0" }), { status: 200 });
  assert.deepEqual(await checkInstalledVersion("1.0.0", fetchVersion), {
    label: "1.0.0", notice: null,
  });
  assert.deepEqual(await checkInstalledVersion("unknown", fetchVersion), {
    label: "unknown", notice: null,
  });
});

test("version check reports registry failures to the caller", async () => {
  await assert.rejects(checkInstalledVersion("1.0.0", async () =>
    new Response("unavailable", { status: 503 })), /npm registry unavailable/);
});
