"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  listSourceVersions, listSourceVersionsAsync, uniqueSourceVersionPrefixes,
  formatSourceVersionTable, resolveSourceVersionPrefix,
} = require("../dist/catalog/sources/skills.js");

test("source history displays unique, aligned prefixes when seven-character SHAs collide", () => {
  const versions = [
    { sha: `abcdef0${"0".repeat(33)}`, date: "2025-04-03T12:13:14Z", subject: "first" },
    { sha: `abcdef0${"1".repeat(33)}`, date: "2025-04-03T12:13:14Z", subject: "second" },
  ];
  const prefixes = uniqueSourceVersionPrefixes(versions);
  assert.deepEqual(prefixes, ["abcdef00", "abcdef01"]);
  for (const [index, prefix] of prefixes.entries()) {
    assert.equal(resolveSourceVersionPrefix(versions, prefix), versions[index].sha);
  }
  const [header, , ...rows] = formatSourceVersionTable(versions);
  const dateColumn = header.indexOf("DATE");
  assert.equal(rows[0].indexOf(versions[0].date), dateColumn);
  assert.equal(rows[1].indexOf(versions[1].date), dateColumn);
});

test("source history resolves only unique listed SHA prefixes", () => {
  const versions = [{ sha: "abcdef0".padEnd(40, "0") }, { sha: "abcdef1".padEnd(40, "1") }];
  assert.equal(resolveSourceVersionPrefix(versions, "ABCDEF0"), versions[0].sha);
  assert.throws(() => resolveSourceVersionPrefix(versions, "abcdef"), /ambiguous/);
  assert.throws(() => resolveSourceVersionPrefix(versions, "1234567"), /not found/);
});

test("source history queries the kind-specific GitHub file path", () => {
  const resources = [
    { kind: "skill", id: "demo-skill", source_repository: "example/skills", source_path: "skills/demo-skill" },
    { kind: "agent", id: "reviewer", source_repository: "example/agents", source_path: "agents/reviewer.agent.md" },
    { kind: "instruction", id: "review", source_repository: "example/instructions", source_path: ".github/instructions/review.instructions.md" },
  ];
  for (const [resource, historyPath] of resources.map((resource, index) =>
    [resource, ["skills/demo-skill/SKILL.md", "agents/reviewer.agent.md", ".github/instructions/review.instructions.md"][index]])) {
    const calls = [];
    const versions = listSourceVersions(resource, (program, args) => {
      calls.push([program, args]);
      return JSON.stringify([{
        sha: "d".repeat(40),
        commit: { committer: { date: "2025-04-03T12:13:14Z" }, message: `Improve ${resource.kind}\n\nDetails` },
      }]);
    });
    assert.equal(versions[0].subject, `Improve ${resource.kind}`);
    assert.deepEqual(calls, [[
      "gh",
      [
        "api", "-X", "GET", `repos/${resource.source_repository}/commits`, "-f", `path=${historyPath}`,
        "-F", "per_page=100", "-F", "page=1",
      ],
    ]]);
  }
});

test("async source history keeps GitHub queries off the dashboard event loop", async () => {
  const resource = {
    kind: "agent", id: "reviewer", source_repository: "example/agents",
    source_path: "agents/reviewer.agent.md",
  };
  const calls = [];
  const versions = await listSourceVersionsAsync(resource, async (program, args) => {
    calls.push([program, args]);
    await new Promise((resolve) => setImmediate(resolve));
    return JSON.stringify([{
      sha: "e".repeat(40),
      commit: { committer: { date: "2025-04-03T12:13:14Z" }, message: "Async history" },
    }]);
  });
  assert.equal(versions[0].subject, "Async history");
  assert.equal(calls[0][0], "gh");
  assert.ok(calls[0][1].includes("-F") && calls[0][1].includes("path=agents/reviewer.agent.md"));
});

test("source version history caps API pagination and reports authentication/network failures", () => {
  const resource = {
    kind: "skill", id: "demo-skill", source_repository: "example/skills",
    source_path: "skills/demo-skill",
  };
  let pages = 0;
  assert.equal(listSourceVersions(resource, (_program, args) => {
    pages += 1;
    assert.equal(args[args.indexOf("-F") + 1], "per_page=100");
    return JSON.stringify(Array.from({ length: 100 }, (_, index) => ({
      sha: index.toString(16).padStart(40, "0"),
      commit: { committer: { date: "2025-04-03T12:13:14Z" }, message: `change ${index}` },
    })));
  }).length, 500);
  assert.equal(pages, 5);
  assert.throws(() => listSourceVersions(resource, () => {
    const error = new Error("gh failed");
    error.stderr = Buffer.from("HTTP 401: authentication required");
    throw error;
  }), /HTTP 401: authentication required/);
  assert.throws(() => listSourceVersions(resource, () => { throw new Error("network unavailable"); }), /network unavailable/);
  assert.throws(() => listSourceVersions({ ...resource, source_path: "../escape" }, () => assert.fail()), /GitHub source resources with supported file paths/);
});
