const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { publishMarkers, runRelease } = require("../scripts/release-publish.js");

function plan(entries) {
  return JSON.stringify({ version: 1, plan: [entries] });
}

function event(packageName, tag) {
  return JSON.stringify({ type: "git-tag", packageName, tag });
}

test("release markers use successful published entries, excluding tag-only plans", () => {
  const planOutput = plan([
    { kind: "publish", name: "@example/cli", version: "1.2.0", access: "public", tag: "latest" },
    { kind: "tag-only", name: "@example/private", version: "1.2.0" },
  ]);
  const report = [
    event("@example/cli", "@example/cli@1.2.0"),
    event("@example/private", "@example/private@1.2.0"),
  ].join("\n");

  assert.deepEqual(publishMarkers(planOutput, report), ["New tag: @example/cli@1.2.0"]);
});

test("release markers accept root-package tags and leave no-op publishes empty", () => {
  const rootPlan = plan([
    { kind: "publish", name: "@grasdouble/kitia", version: "1.1.1", access: "public", tag: "latest" },
  ]);
  assert.deepEqual(publishMarkers(rootPlan, event("@grasdouble/kitia", "v1.1.1")), ["New tag:"]);
  assert.deepEqual(publishMarkers(plan([]), ""), []);
  assert.deepEqual(publishMarkers(rootPlan, ""), []);
});

test("release markers ignore tag events outside the planned publish versions", () => {
  const planOutput = plan([
    { kind: "publish", name: "kitia", version: "2.0.0", access: "public", tag: "latest" },
  ]);
  assert.deepEqual(publishMarkers(planOutput, event("kitia", "kitia@1.9.0")), []);
  assert.deepEqual(publishMarkers(planOutput, event("other", "other@2.0.0")), []);
});

test("malformed structured release data fails instead of emitting guessed markers", () => {
  assert.throws(() => publishMarkers("{", ""), SyntaxError);
  assert.throws(() => publishMarkers(JSON.stringify({ version: 99, plan: [] }), ""), /Unsupported/);
  assert.throws(() => publishMarkers(plan([]), "{\n"), /Invalid Changesets output event on line 1/);
  assert.throws(() => publishMarkers(plan([]), JSON.stringify({ type: "git-tag" })), /Invalid Changesets git-tag event/);
});

test("publish wrapper emits only reported successes and preserves a publish error", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-release-test-"));
  const stdout = { value: "", write(chunk) { this.value += chunk.toString(); } };
  const stderr = { write() {} };
  const targets = [
    { kind: "publish", name: "@example/one", version: "1.0.1", access: "public", tag: "latest" },
    { kind: "publish", name: "@example/two", version: "1.0.1", access: "public", tag: "latest" },
  ];
  let calls = 0;
  try {
    const code = await runRelease({
      cwd: tempRoot,
      tempRoot,
      stdout,
      stderr,
      run: async (command, args, options) => {
        assert.equal(command, "pnpm");
        calls++;
        if (calls === 1) {
          assert.deepEqual(args.slice(0, 4), ["exec", "changeset", "publish-plan", "--output"]);
          fs.writeFileSync(args[4], plan(targets));
          return { code: 0 };
        }
        assert.deepEqual(args, ["exec", "changeset", "publish"]);
        fs.writeFileSync(options.env.CHANGESETS_OUTPUT, event("@example/one", "@example/one@1.0.1"));
        return { code: 1 };
      },
    });
    assert.equal(code, 1);
    assert.equal(stdout.value, "New tag: @example/one@1.0.1\n");
    assert.equal(calls, 2);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("publish wrapper keeps a no-op release successful without emitting markers", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-release-test-"));
  const stdout = { value: "", write(chunk) { this.value += chunk.toString(); } };
  const stderr = { write() {} };
  let calls = 0;
  try {
    const code = await runRelease({
      cwd: tempRoot,
      tempRoot,
      stdout,
      stderr,
      run: async (_command, args, options) => {
        calls++;
        if (calls === 1) {
          fs.writeFileSync(args[4], plan([]));
          return { code: 0 };
        }
        fs.writeFileSync(options.env.CHANGESETS_OUTPUT, "");
        return { code: 0 };
      },
    });
    assert.equal(code, 0);
    assert.equal(stdout.value, "");
    assert.equal(calls, 2);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
