"use strict";

const assert = require("node:assert/strict");
const React = require("react");
const { test } = require("node:test");
let InkText;

function childText(node) {
  if (Array.isArray(node)) return node.map(childText).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (React.isValidElement(node)) return childText(node.props.children);
  return "";
}

function visibleInkText(node, output = []) {
  if (Array.isArray(node)) {
    for (const child of node) visibleInkText(child, output);
  } else if (React.isValidElement(node)) {
    if (node.type === InkText) output.push(childText(node.props.children));
    visibleInkText(node.props.children, output);
  }
  return output;
}

async function captureDashboardFrame(resources, actions = {}, keys = [], dimensions = { columns: 120, rows: 56 }) {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = dimensions.columns;
  output.rows = dimensions.rows;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const done = runDashboard(resources, input, output, [], actions);
  await new Promise((resolve) => setTimeout(resolve, 120));
  for (const key of keys) {
    input.write(key);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  const start = rendered.lastIndexOf("\u001b[?2026h");
  const end = rendered.indexOf("\u001b[?2026l", start);
  assert.ok(start >= 0 && end > start, "runDashboard should emit a synchronized frame");
  const frame = rendered.slice(start, end)
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b\]8;;[^\u001b]*(?:\u0007|\u001b\\)/g, "");
  input.write("q");
  assert.equal(await done, true);
  input.destroy();
  output.destroy();
  return frame;
}

function catalogProps(resource) {
  return {
    candidates: [resource],
    resources: [],
    catalogs: [],
    query: "",
    filterMode: false,
    catalogFilter: "all",
    kindFilter: "all",
    selectedIndex: 0,
    versionLabel: "test",
    screenName: "Catalog",
    showDetails: true,
    columns: 300,
    rows: 40,
  };
}

test("CatalogScreen exposes source license and pin only when provenance exists", async () => {
  const { Text } = await import("ink");
  InkText = Text;
  const { CatalogScreen } = await import("../dist/dashboard/screens.mjs");
  const source = {
    catalog: "sample",
    kind: "skill",
    id: "demo",
    description: "A test resource.",
    license_status: "MIT",
    source_repository: "org/repo",
    source_path: "skills/demo",
    source_ref: "0123456789abcdef0123456789abcdef01234567",
  };
  const sourceTree = CatalogScreen(catalogProps(source));
  const sourceText = visibleInkText(sourceTree);
  assert.ok(sourceText.includes("LICENSE"));
  assert.ok(sourceText.includes("MIT"));
  assert.ok(sourceText.includes("PINNED SOURCE"));
  assert.ok(sourceText.includes("org/repo/skills/demo@0123456789abcdef0123456789abcdef01234567"));

  const localTree = CatalogScreen(catalogProps({
    catalog: "local",
    kind: "skill",
    id: "local-demo",
    description: "A local resource.",
  }));
  const localText = visibleInkText(localTree);
  assert.ok(localText.includes("LICENSE"));
  assert.ok(localText.includes("not declared"));
  assert.ok(!localText.includes("PINNED SOURCE"));
  assert.ok(!localText.some((text) => text.includes("@0123456789abcdef0123456789abcdef01234567")));
});

test("CatalogScreen wraps complete descriptions and pinned sources at narrow widths", async () => {
  const { CatalogScreen } = await import("../dist/dashboard/screens.mjs");
  const description = "A long description with enough detail to wrap across several narrow terminal lines without losing any words.";
  const sourcePath = "skills/long-resource-folder/with-an-extraordinarily-long-unbroken-source-path-segment";
  const sourceRef = "0123456789abcdef0123456789abcdef01234567";
  const source = `org/very-long-example-repository/${sourcePath}@${sourceRef}`;
  for (const columns of [56, 120]) {
    const tree = CatalogScreen({
      ...catalogProps({
        catalog: "sample",
        kind: "skill",
        id: "long-resource",
        description,
        license_status: "MIT",
        source_repository: "org/very-long-example-repository",
        source_path: sourcePath,
        source_ref: sourceRef,
      }),
      columns,
    });
    const text = visibleInkText(tree).join("");
    assert.ok(text.replace(/\s/g, "").includes(description.replace(/\s/g, "")));
    assert.ok(text.includes(source));
  }
});

test("InventoryScreen wraps complete locations and descriptions at narrow widths", async () => {
  const { InventoryScreen } = await import("../dist/dashboard/screens.mjs");
  const description = "A long inventory description that must remain complete when shown in a narrow terminal.";
  const location = "/workspace/projects/a-resource-folder/with-an-extraordinarily-long-unbroken-path-segment";
  const sourceRef = "0123456789abcdef0123456789abcdef01234567";
  for (const columns of [56, 120]) {
    const tree = InventoryScreen({
      resources: [{
        catalog: "local",
        kind: "skill",
        id: "long-resource",
        scope: "project",
        status: "current",
        managed: false,
        paths: [location],
        source_repository: "example/long-repository-name",
        description,
        source_ref: sourceRef,
      }],
      errors: [],
      query: "",
      filterMode: false,
      catalogFilter: "all",
      kindFilter: "all",
      selectedIndex: 0,
      versionLabel: "test",
      actionMessage: "",
      catalogAvailable: false,
      canExecute: false,
      showDetails: true,
      columns,
      rows: 40,
    });
    const text = visibleInkText(tree).join("");
    assert.ok(text.replace(/\s/g, "").includes(description.replace(/\s/g, "")));
    assert.ok(text.includes(location));
    assert.ok(text.includes("https://github.com/example/long-repository-name"));
    assert.ok(text.includes(sourceRef));
  }
});
test("narrow inventory terminal links wrapped URL fragments to the complete location", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 40;
  output.rows = 80;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const url = "https://github.com/grasdouble/AI-Kit";
  const done = runDashboard([{
    catalog: "AI-Kit",
    kind: "skill",
    id: "demo",
    scope: "project",
    status: "current",
    managed: true,
    source_repository: "grasdouble/AI-Kit",
    description: "Demo resource.",
  }], input, output);
  await new Promise((resolve) => setTimeout(resolve, 120));
  input.write("q");
  assert.equal(await done, true);
  input.destroy();
  output.destroy();

  const anchors = [...rendered.matchAll(/\u001b\]8;;([^\u001b]*)\u001b\\([^\u001b]*)\u001b\]8;;\u001b\\/g)];
  const locationAnchors = anchors.filter(([, href]) => href === url);
  assert.ok(locationAnchors.length > 1, "the narrow location URL wraps into hyperlink fragments");
  assert.ok(locationAnchors.every(([, href]) => href === url), "every fragment targets the complete URL");
  assert.ok(locationAnchors.map(([, , text]) => text).join("").includes(url),
    "the linked visible fragments retain the complete URL");
  assert.ok(locationAnchors.some(([, , text]) => text === "AI-Kit"),
    "URL wrapping preserves the complete final repository segment");
});
test("inventory detail keeps update paths complete within narrow and short layouts", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const path = ".agents/skills/engineering/a-resource-with-a-deliberately-long-name/SKILL.md";
  const issue = `Update available: ${path}`;
  for (const { columns, rows } of [{ columns: 40, rows: 36 }, { columns: 100, rows: 56 }]) {
    const input = new PassThrough();
    input.isTTY = true;
    input.setRawMode = () => {};
    input.ref = () => {};
    input.unref = () => {};
    const output = new PassThrough();
    output.isTTY = true;
    output.columns = columns;
    output.rows = rows;
    let rendered = "";
    output.on("data", (chunk) => { rendered += chunk.toString(); });
    const done = runDashboard([{
      catalog: "engineering",
      kind: "skill",
      id: "long-update",
      scope: "project",
      status: "attention",
      issues: [{ code: "UPDATE_AVAILABLE", paths: [path] }],
    }], input, output);
    await new Promise((resolve) => setTimeout(resolve, 120));
    input.write("q");
    assert.equal(await done, true);
    input.destroy();
    output.destroy();

    const frameStart = rendered.lastIndexOf("\u001b[?2026h");
    assert.notEqual(frameStart, -1, "Ink should emit a complete synchronized terminal frame");
    const frameEnd = rendered.indexOf("\u001b[?2026l", frameStart);
    assert.notEqual(frameEnd, -1, "the synchronized terminal frame should be closed");
    const frame = rendered.slice(frameStart, frameEnd)
      .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(/\u001b\]8;;[^\u001b]*(?:\u0007|\u001b\\)/g, "");
    const frameLines = frame.split(/\r?\n/);
    assert.equal(frameLines.length, rows, `the rendered frame should occupy ${rows} rows`);
    assert.ok(frameLines[rows - 1].includes("└"),
      "the final rendered row should remain occupied by the shortcut-panel border");
    assert.ok(frame.includes("SHORTCUTS"), "the compact layout retains its framed shortcut panel");
    const updateText = frame.replace(/[│\s]/g, "");
    assert.ok(updateText.includes(issue.replace(/\s/g, "")),
      `complete update path should remain available at ${columns}x${rows}`);
    if (columns === 40) assert.ok(frame.includes("SUMMARY"), "short layouts retain a compact summary panel");
  }
});

test("update confirmation distinguishes GH-backed skills from offline bundles and other resources", async () => {
  const { confirmationModal } = await import("../dist/dashboard/modals.mjs");
  const base = {
    catalog: "Test", id: "update-me", scope: "user", status: "update", managed: true,
    source_repository: "example/repo",
  };
  const confirmationText = (resource) => confirmationModal({
    confirmation: { action: "update", resource },
    selectedButton: 1,
    stage: 1,
    columns: 120,
  }).lines.map(({ bodyText, text }) => bodyText || text).join(" ");
  const ghText = confirmationText({ ...base, kind: "skill" });
  assert.ok(ghText.includes("Kitia passes gh skill install --force to replace the installed copy,"));
  assert.ok(ghText.includes("checks local conflicts first and asks before proceeding if any are found."));
  assert.ok(!ghText.includes("signed offline bundle"));

  const bundleText = confirmationText({
    ...base, kind: "skill", bundle_id: "b".repeat(64),
  });
  assert.ok(bundleText.includes("imported signed offline bundle"));
  assert.ok(bundleText.includes("no gh command or gh --force is used"));
  assert.ok(!bundleText.includes("gh skill install --force"));

  const agentText = confirmationText({ ...base, kind: "agent" });
  assert.ok(agentText.includes("does not use gh --force"));
  assert.ok(!agentText.includes("gh skill install --force"));
});

test("managed inventory U confirms an update and renders the successful result", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const resource = {
    catalog: "Test",
    kind: "skill",
    id: "update-me",
    scope: "project",
    status: "attention",
    managed: true,
    issues: [{ code: "UPDATE_AVAILABLE", paths: [".agents/skills/update-me/SKILL.md"] }],
    source_repository: "example/repo",
    source_path: "skills/update-me/SKILL.md",
    source_ref: "a".repeat(40),
    description: "A managed resource with an available update.",
  };
  const updatedResource = { ...resource, status: "current", issues: [] };
  const executions = [];
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 120;
  output.rows = 56;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const done = runDashboard([resource], input, output, [], {
    showOnboarding: false,
    execute: async (...args) => {
      executions.push(args);
      return {
        code: 0,
        messages: ["Update complete"],
        resources: [updatedResource],
        errors: [],
      };
    },
  });
  let finished = false;
  const latestFrame = () => {
    const start = rendered.lastIndexOf("\u001b[?2026h");
    const end = rendered.indexOf("\u001b[?2026l", start);
    return start >= 0 && end > start
      ? rendered.slice(start, end)
        .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
        .replace(/\u001b\]8;;[^\u001b]*(?:\u0007|\u001b\\)/g, "")
      : "";
  };
  const waitForFrame = async (predicate, description) => {
    const deadline = Date.now() + 5_000;
    while (!predicate(latestFrame())) {
      if (Date.now() >= deadline) throw new Error(`Dashboard did not render ${description}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return latestFrame();
  };

  try {
    await waitForFrame((frame) => frame.includes("SHORTCUTS"), "the Inventory screen");
    input.write("u");
    const confirmation = await waitForFrame((frame) => frame.includes("CONFIRM UPDATE"),
      "the update confirmation");
    const confirmationText = confirmation.replace(/[│]/g, " ").replace(/\s+/g, " ");
    assert.ok(confirmationText.includes("gh skill install --force"));
    assert.ok(confirmationText.includes("replace the installed copy"));
    assert.ok(confirmationText.includes("checks local conflicts first"));
    assert.ok(confirmation.includes("Y/N SHORTCUTS"));
    assert.equal(executions.length, 0, "U must request confirmation, not execute immediately");

    input.write("y");
    const completed = await waitForFrame((frame) =>
      frame.includes("Update complete") && frame.includes("CURRENT"), "the successful update result");
    assert.equal(executions.length, 1);
    assert.equal(executions[0][0], "update");
    assert.deepEqual(executions[0][1], resource);
    assert.deepEqual(executions[0][2], { scope: undefined, tool: undefined });
    assert.ok(completed.includes("Update complete"));
    assert.ok(completed.includes("CURRENT"), "the returned refreshed resource replaces its old status");
    input.write("q");
    assert.equal(await done, true);
    finished = true;
  } finally {
    if (!finished) {
      input.write("\x1b");
      await new Promise((resolve) => setTimeout(resolve, 20));
      input.write("q");
    }
    await done;
    input.destroy();
    output.destroy();
  }
});

test("managed inventory U selects Update and Enter executes the confirmed action", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const resource = {
    catalog: "Test",
    kind: "skill",
    id: "enter-update",
    scope: "project",
    status: "attention",
    managed: true,
    issues: [{ code: "UPDATE_AVAILABLE", paths: [".agents/skills/enter-update/SKILL.md"] }],
  };
  const updatedResource = { ...resource, status: "current", issues: [] };
  const executions = [];
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 120;
  output.rows = 56;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const done = runDashboard([resource], input, output, [], {
    showOnboarding: false,
    execute: async (...args) => {
      executions.push(args);
      return {
        code: 0,
        messages: ["Update complete"],
        resources: [updatedResource],
        errors: [],
      };
    },
  });
  let finished = false;
  const latestFrame = () => {
    const start = rendered.lastIndexOf("\u001b[?2026h");
    const end = rendered.indexOf("\u001b[?2026l", start);
    return start >= 0 && end > start
      ? rendered.slice(start, end)
        .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
        .replace(/\u001b\]8;;[^\u001b]*(?:\u0007|\u001b\\)/g, "")
      : "";
  };
  const waitForFrame = async (predicate, description) => {
    const deadline = Date.now() + 5_000;
    while (!predicate(latestFrame())) {
      if (Date.now() >= deadline) throw new Error(`Dashboard did not render ${description}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return latestFrame();
  };

  try {
    await waitForFrame((frame) => frame.includes("SHORTCUTS"), "the Inventory screen");
    input.write("u");
    const confirmation = await waitForFrame((frame) => frame.includes("CONFIRM UPDATE"),
      "the update confirmation");
    assert.ok(confirmation.includes("‹ UPDATE ›"), "Update is selected by default");
    assert.equal(executions.length, 0, "U must not execute before confirmation");

    input.write("\r");
    const completed = await waitForFrame((frame) =>
      frame.includes("Update complete") && frame.includes("CURRENT"), "the successful update result");
    assert.equal(executions.length, 1);
    assert.equal(executions[0][0], "update");
    assert.deepEqual(executions[0][1], resource);
    assert.deepEqual(executions[0][2], { scope: undefined, tool: undefined });
    assert.ok(completed.includes("Update complete"));
    assert.ok(completed.includes("CURRENT"), "the refreshed resource replaces its old status");
    input.write("q");
    assert.equal(await done, true);
    finished = true;
  } finally {
    if (!finished) {
      input.write("\x1b");
      await new Promise((resolve) => setTimeout(resolve, 20));
      input.write("q");
    }
    await done;
    input.destroy();
    output.destroy();
  }
});

test("recoverable update conflicts ask for confirmation before retrying with force", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const resource = {
    catalog: "Test", kind: "skill", id: "conflicted-skill",
    scope: "project", status: "update", managed: true,
  };

  for (const category of ["tracked-modification", "untracked-skill-content"]) {
    for (const accept of [false, true]) {
    const input = new PassThrough();
    input.isTTY = true;
    input.setRawMode = () => {};
    input.ref = () => {};
    input.unref = () => {};
    const output = new PassThrough();
    output.isTTY = true;
    output.columns = 100;
    output.rows = 48;
    let rendered = "";
    output.on("data", (chunk) => { rendered += chunk.toString(); });
    const calls = [];
    const done = runDashboard([resource], input, output, [], {
      showOnboarding: false,
      execute: async (...args) => {
        calls.push(args);
        if (calls.length === 1) {
          const error = new Error("local conflict");
          error.code = "LOCAL_CONFLICT";
          error.category = category;
          error.paths = [category === "tracked-modification"
            ? ".agents/skills/conflicted-skill/SKILL.md"
            : ".agents/skills/conflicted-skill/local-note.txt"];
          error.recoverable = true;
          throw error;
        }
        return { code: 0, messages: ["Update complete"], resources: [resource], errors: [] };
      },
    });
    const latestFrame = () => {
      const start = rendered.lastIndexOf("\u001b[?2026h");
      const end = rendered.indexOf("\u001b[?2026l", start);
      return start >= 0 && end > start
        ? rendered.slice(start, end)
          .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
          .replace(/\u001b\]8;;[^\u001b]*(?:\u0007|\u001b\\)/g, "")
        : "";
    };
    const waitForFrame = async (predicate, label) => {
      const deadline = Date.now() + 5_000;
      while (!predicate(latestFrame())) {
        if (Date.now() >= deadline) throw new Error(`Dashboard did not render ${label}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return latestFrame();
    };

    try {
      await waitForFrame((frame) => frame.includes("SHORTCUTS"), "inventory");
      input.write("u");
      await waitForFrame((frame) => frame.includes("CONFIRM UPDATE"), "update confirmation");
      input.write("y");
      const conflict = await waitForFrame((frame) => frame.includes("LOCAL CONFLICT"), "conflict confirmation");
      assert.ok(conflict.includes("conflicted-skill"));
      assert.ok(conflict.includes("catalog Test"));
      assert.ok(conflict.includes("scope project"));
      assert.ok(conflict.includes(category === "tracked-modification"
        ? ".agents/skills/conflicted-skill/SKILL.md"
        : ".agents/skills/conflicted-skill/local-note.txt"));
      assert.ok(conflict.includes("FORCE AND RETRY"));
      assert.equal(calls.length, 1, "the initial attempt stops before retry");

      if (accept) {
        input.write("\x1b[C");
        await waitForFrame((frame) => frame.includes("‹ FORCE AND RETRY ›"), "force selection");
        input.write("\r");
        await waitForFrame((frame) => frame.includes("Update complete"), "forced update result");
        assert.equal(calls.length, 2);
        assert.deepEqual(calls[1][2], { scope: undefined, tool: undefined, force: true });
        input.write("q");
        assert.equal(await done, true);
      } else {
        input.write("\r");
        await waitForFrame((frame) => !frame.includes("LOCAL CONFLICT"), "cancelled conflict prompt");
        assert.equal(calls.length, 1, "cancelling must not execute a second update");
        input.write("q");
        assert.equal(await done, false, "cancelling force recovery leaves the unresolved update failed");
      }
    } finally {
      input.write("\x03");
      await done.catch(() => {});
      input.destroy();
      output.destroy();
    }
    }
  }
});

test("failed managed updates show an actionable error modal in compact and normal layouts", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const resource = {
    catalog: "AI-Kit",
    kind: "skill",
    id: "conventional-commits",
    scope: "project",
    status: "update",
    managed: true,
  };
  const actualError = "Could not update AI-Kit catalog skill conventional-commits for github-copilot: gh exited with status 1. GitHub reports an API rate limit; wait for the limit to reset, then retry. No agents were confirmed updated before this failure.";

  for (const rows of [36, 56]) {
    const input = new PassThrough();
    input.isTTY = true;
    input.setRawMode = () => {};
    input.ref = () => {};
    input.unref = () => {};
    const output = new PassThrough();
    output.isTTY = true;
    output.columns = 80;
    output.rows = rows;
    let rendered = "";
    output.on("data", (chunk) => { rendered += chunk.toString(); });
    let executions = 0;
    const done = runDashboard([resource], input, output, [], {
      execute: async () => {
        executions += 1;
        if (rows === 36) {
          const error = new Error(`${actualError} gh diagnostic: GitHub API rate limit exceeded; ghp_secret_token_value`);
          error.userMessage = actualError;
          error.technicalDetail = "GitHub API rate limit exceeded; ghp_secret_token_value";
          throw error;
        }
        return {
          code: 1,
          messages: ["GitHub API rate limit exceeded; ghp_secret_token_value"],
          failure: { code: "GH_UPDATE_FAILED", userMessage: actualError },
          resources: [resource],
          errors: [],
        };
      },
    });
    const latestFrame = () => {
      const start = rendered.lastIndexOf("\u001b[?2026h");
      const end = rendered.indexOf("\u001b[?2026l", start);
      return start >= 0 && end > start
        ? rendered.slice(start, end)
          .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
          .replace(/\u001b\]8;;[^\u001b]*(?:\u0007|\u001b\\)/g, "")
        : "";
    };
    const waitForFrame = async (predicate, description) => {
      const deadline = Date.now() + 5_000;
      while (!predicate(latestFrame())) {
        if (Date.now() >= deadline) throw new Error(`Dashboard did not render ${description}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return latestFrame();
    };
    const waitForDone = async () => {
      let timer;
      try {
        return await Promise.race([
          done,
          new Promise((resolve) => { timer = setTimeout(() => resolve(null), 1_000); }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };

    try {
      await waitForFrame((frame) => frame.includes("SHORTCUTS"), "the Inventory screen");
      input.write("u");
      await waitForFrame((frame) => frame.includes("CONFIRM UPDATE"), "the update confirmation");
      input.write("y");
      const failed = await waitForFrame((frame) => frame.includes("UPDATE FAILED"),
        "the failed update modal");
      const normalized = failed.replace(/[│]/g, "").replace(/\s+/g, " ");
      assert.ok(normalized.includes(actualError), `the modal must show the safe actionable error:\n${failed}`);
      assert.doesNotMatch(failed, /gh diagnostic|ghp_secret_token_value|GitHub API rate limit exceeded;/);
      assert.ok(failed.includes("SHORTCUTS"));
      assert.equal(executions, 1);

      input.write("\x1b");
      const dismissed = await waitForFrame((frame) =>
        !frame.includes("UPDATE FAILED") && frame.includes("Action failed"),
      "the dashboard after dismissing the error");
      assert.ok(dismissed.includes("Action failed"));
      input.write("q");
      assert.equal(await waitForDone(), false, "a failed CLI status must remain nonzero after dismissal");
    } finally {
      if (executions) {
        input.write("\x1b");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      input.write("\x03");
      await waitForDone();
      input.destroy();
      output.destroy();
    }
  }
});


test("side-by-side inventory keeps list viewport stable across detail lengths", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const resources = [
    { catalog: "sample", kind: "skill", id: "short-detail", scope: "project", status: "current", description: "Short." },
    {
      catalog: "sample",
      kind: "skill",
      id: "long-detail",
      scope: "project",
      status: "update",
      issues: [{ code: "UPDATE_AVAILABLE", paths: [".agents/skills/example/SKILL.md"] }],
      description: "Long description for the selected resource. ".repeat(5),
    },
    ...["third", "fourth", "fifth"].map((id) => ({
      catalog: "sample", kind: "skill", id, scope: "project", status: "current",
    })),
  ];
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 120;
  output.rows = 56;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const done = runDashboard(resources, input, output);
  const waitForFrame = async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    const start = rendered.lastIndexOf("\u001b[?2026h");
    const end = rendered.indexOf("\u001b[?2026l", start);
    return rendered.slice(start, end)
      .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(/\u001b\]8;;[^\u001b]*(?:\u0007|\u001b\\)/g, "");
  };
  const visibleInventory = (frame, selectedId) => {
    const lines = frame.split(/\r?\n/);
    const range = frame.match(/RESOURCES 5\/5 · (\d+-\d+)/)?.[1];
    const ids = ["short-detail", "long-detail", "third", "fourth", "fifth"];
    const detailsTitle = lines.findIndex((line) => line.includes(`SKILL - ${selectedId}`));
    const shortcutsTitle = lines.findIndex((line) => line.includes("SHORTCUTS"));
    const inventoryTitle = lines.findIndex((line) => /│ INVENTORY\s+│/.test(line));
    const rightLeft = lines[detailsTitle]?.indexOf(`SKILL - ${selectedId}`) - 2;
    const rightRight = lines[detailsTitle]?.lastIndexOf("│");
    const detailsBottom = lines.findIndex((line, index) =>
      index > detailsTitle && index < shortcutsTitle && line.indexOf("└", rightLeft) === rightLeft);
    const shortcutsBottom = lines.findIndex((line, index) =>
      index > shortcutsTitle && line.indexOf("└", rightLeft) === rightLeft);
    return {
      range,
      count: ids.filter((id) => frame.includes(id)).length,
      panelBottom: lines.findIndex((line) => /^ └─{50,}┘/.test(line)),
      height: lines.length,
      inventoryTop: inventoryTitle - 1,
      detailsTop: detailsTitle - 1,
      detailsBottom,
      shortcutsTop: shortcutsTitle - 1,
      shortcutsBottom,
      rightLeft,
      detailsRight: rightRight,
      shortcutsLeft: lines[shortcutsTitle]?.indexOf("SHORTCUTS") - 2,
      shortcutsRight: lines[shortcutsTitle]?.lastIndexOf("│"),
    };
  };
  const shortFrame = await waitForFrame();
  input.write("\x1b[B");
  const longFrame = await waitForFrame();
  input.write("q");
  assert.equal(await done, true);
  input.destroy();
  output.destroy();

  const shortViewport = visibleInventory(shortFrame, "short-detail");
  const longViewport = visibleInventory(longFrame, "long-detail");
  assert.deepEqual(longViewport, shortViewport,
    "changing the right-hand detail must not change left-hand page range or visible row count");
  assert.deepEqual(
    { range: shortViewport.range, count: shortViewport.count },
    { range: "1-5", count: 5 },
    "the stable list should show all five inventory rows",
  );
  assert.equal(shortViewport.height, 56);
  assert.equal(longViewport.height, 56);
  assert.equal(shortViewport.panelBottom, 55,
    "the inventory border should fill the final terminal row");
  assert.equal(longViewport.panelBottom, 55,
    "long selected details must not pull the inventory border upward");
  for (const viewport of [shortViewport, longViewport]) {
    assert.equal(viewport.detailsTop, viewport.inventoryTop,
      "DETAILS and INVENTORY top borders align");
    assert.equal(viewport.shortcutsLeft, viewport.rightLeft,
      "DETAILS and SHORTCUTS share a left border");
    assert.equal(viewport.shortcutsRight, viewport.detailsRight,
      "DETAILS and SHORTCUTS share a right border");
    assert.equal(viewport.detailsBottom + 2, viewport.shortcutsTop,
      "DETAILS fills the column gap up to the one-row panel separation");
    assert.equal(viewport.shortcutsBottom, viewport.panelBottom,
      "SHORTCUTS bottom aligns with the Inventory panel bottom");
  }

  const extremeDetails = resources.map((resource) => resource.id === "long-detail"
    ? { ...resource, description: "Long description for the selected resource. ".repeat(25) }
    : resource);
  const extremeFrame = await captureDashboardFrame(
    extremeDetails,
    {},
    ["\x1b[B"],
    { columns: 120, rows: 56 },
  );
  assert.equal(
    extremeFrame.match(/RESOURCES 5\/5 · (\d+-\d+)/)?.[1],
    shortViewport.range,
    "very long selected details must leave the viewport unchanged too",
  );
});

test("InventoryScreen renders supported shortcuts in the spacious details column", async () => {
  const { PassThrough } = require("node:stream");
  const { runDashboard } = await import("../dist/dashboard/dashboard.mjs");
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.ref = () => {};
  input.unref = () => {};
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 120;
  output.rows = 56;
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const resource = {
    catalog: "engineering",
    kind: "skill",
    id: "long-update",
    scope: "project",
    status: "attention",
    issues: [{
      code: "UPDATE_AVAILABLE",
      paths: [".agents/skills/engineering/a-resource-with-a-deliberately-long-name/SKILL.md"],
    }],
  };
  const done = runDashboard([resource], input, output, [], {
    catalogResources: [{ catalog: "engineering", kind: "skill", id: "available" }],
    execute: async () => ({ success: true }),
  });
  await new Promise((resolve) => setTimeout(resolve, 120));
  input.write("q");
  assert.equal(await done, true);
  input.destroy();
  output.destroy();

  const plain = rendered.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  for (const shortcut of ["SHORTCUTS", "A install", "U update", "Delete uninstall",
    "M catalogs", "F filter", "C catalog", "K kind", "D details", "↑↓ navigate",
    "? guide", "Q quit"]) {
    assert.ok(plain.includes(shortcut), `missing rendered shortcut: ${shortcut}`);
  }
  assert.ok(plain.includes("INVENTORY"));
  assert.ok(plain.includes("Update available:"));
});

test("InventoryScreen omits action shortcuts that are unavailable in this inventory", async () => {
  const { Text } = await import("ink");
  InkText = Text;
  const { InventoryScreen } = await import("../dist/dashboard/screens.mjs");
  const tree = InventoryScreen({
    resources: [],
    errors: [],
    query: "",
    filterMode: false,
    catalogFilter: "all",
    kindFilter: "all",
    selectedIndex: 0,
    versionLabel: "test",
    actionMessage: "",
    catalogAvailable: false,
    canExecute: false,
    showDetails: true,
    columns: 120,
    rows: 40,
  });
  const text = visibleInkText(tree).join("");
  assert.ok(!text.includes("A install"));
  assert.ok(!text.includes("U update"));
  assert.ok(!text.includes("Delete uninstall"));
});

test("all dashboard modes show a dedicated shortcut frame for active controls", async () => {
  const candidate = {
    catalog: "sample",
    kind: "skill",
    id: "candidate",
    description: "A catalog candidate.",
    license_status: "MIT",
    source_repository: "org/repo",
    source_path: "skills/candidate",
    source_ref: "0123456789abcdef0123456789abcdef01234567",
  };
  const actions = {
    catalogResources: [candidate],
    userCatalogs: [{ name: "sample", repository: "https://github.com/org/repo" }],
    addCatalog: async () => ({ success: true }),
    removeCatalog: async () => ({ success: true }),
    updateCatalog: async () => ({ success: true }),
    refreshCatalog: async () => ({ success: true }),
    transferCatalogs: async () => ({ success: true }),
    checkCatalogFreshness: async () => [],
  };
  const compactDimensions = { columns: 80, rows: 80 };

  const inventory = await captureDashboardFrame([], actions, [], compactDimensions);
  assert.ok(inventory.includes("SHORTCUTS"));
  assert.ok(inventory.includes("A install"));
  assert.ok(inventory.includes("M catalogs"));

  const catalog = await captureDashboardFrame([], actions, ["a"], compactDimensions);
  assert.ok(catalog.includes("SHORTCUTS"));
  assert.ok(catalog.includes("ENTER select"));
  assert.ok(catalog.includes("C catalog"));
  assert.ok(!catalog.includes("A install"));

  const installOptions = await captureDashboardFrame([], actions, ["a", "\r"], compactDimensions);
  assert.ok(installOptions.includes("SHORTCUTS"));
  assert.ok(installOptions.includes("TAB FOCUS"));
  assert.ok(installOptions.includes("ENTER REVIEW"));
  assert.ok(installOptions.includes("ESC BACK"));
  assert.ok(!installOptions.includes("ENTER select"));
  assert.ok(!installOptions.includes("C catalog"));

  const catalogManagement = await captureDashboardFrame([], actions, ["m"], compactDimensions);
  assert.ok(catalogManagement.includes("SHORTCUTS"));
  for (const shortcut of ["A add", "P presets", "Delete remove", "E edit",
    "R refresh", "I import", "X export", "D details", "ESC inventory"]) {
    assert.ok(catalogManagement.includes(shortcut), `missing management shortcut: ${shortcut}`);
  }
});

test("wide catalog management fills the terminal and wraps every active shortcut", async () => {
  const dimensions = { columns: 120, rows: 56 };
  const actions = {
    userCatalogs: [{ name: "sample", repository: "https://github.com/org/repo" }],
    addCatalog: async () => ({}),
    removeCatalog: async () => ({}),
    updateCatalog: async () => ({}),
    refreshCatalog: async () => ({}),
    transferCatalogs: async () => ({}),
  };
  const panelBottom = (frame) => {
    const lines = frame.split(/\r?\n/);
    return lines.findLastIndex((line) => /^ └─+┘/.test(line));
  };
  const management = await captureDashboardFrame([], actions, ["m"], dimensions);
  const managementLines = management.split(/\r?\n/);
  const catalogTitle = managementLines.findIndex((line) => line.includes("CONNECTED CATALOGS"));
  const detailsTitle = managementLines.findIndex((line) => line.includes("CATALOG - sample"));
  const shortcutsTitle = managementLines.findIndex((line) => line.includes("SHORTCUTS"));
  const detailsLeft = managementLines[detailsTitle].indexOf("CATALOG - sample") - 2;
  const detailsRight = managementLines[detailsTitle].lastIndexOf("│");
  const shortcutsLeft = managementLines[shortcutsTitle].indexOf("SHORTCUTS") - 2;
  const shortcutsRight = managementLines[shortcutsTitle].lastIndexOf("│");
  const detailsBottom = managementLines.findIndex((line, index) =>
    index > detailsTitle && index < shortcutsTitle && line[detailsLeft] === "└");
  const shortcutsBottom = managementLines.findIndex((line, index) =>
    index > shortcutsTitle && line[shortcutsLeft] === "└" && line[shortcutsRight] === "┘");
  const shortcutsFrame = managementLines.slice(shortcutsTitle, shortcutsBottom + 1).join("\n");

  assert.equal(managementLines.length, dimensions.rows);
  assert.equal(catalogTitle, detailsTitle, "catalog and detail frames start at the same row");
  assert.equal(detailsLeft, shortcutsLeft, "right panels share one left edge");
  assert.equal(detailsRight, shortcutsRight, "right panels share one right edge");
  assert.equal(panelBottom(management), dimensions.rows - 1,
    "catalog list frame should reach the bottom row like Inventory");
  assert.equal(detailsBottom + 2, shortcutsTitle - 1,
    "DETAILS fills the column above the one-row panel separation");
  assert.equal(shortcutsBottom - shortcutsTitle - 1, 5,
    `the long active action line wraps into a counted extra panel row:\n${shortcutsFrame}`);
  assert.equal(shortcutsBottom, dimensions.rows - 1,
    "management shortcuts should stay bottom-anchored to the full-height panel");
  for (const shortcut of ["A add", "P presets", "Delete remove", "E edit",
    "R refresh", "I import", "X export", "D details", "ESC inventory", "Q quit"]) {
    assert.ok(shortcutsFrame.includes(shortcut),
      `missing visible management shortcut: ${shortcut}\n${shortcutsFrame}`);
  }
  assert.ok(shortcutsFrame.split(/\r?\n/).some((line) => line.includes("I import / X export")),
    "Import and Export stay together on one visible shortcut row");
  assert.doesNotMatch(shortcutsFrame, /(?:\.\.\.|…)/,
    "the shortcut frame must wrap, not truncate, active controls");

  const inventory = await captureDashboardFrame([], actions, [], dimensions);
  assert.equal(panelBottom(inventory), dimensions.rows - 1,
    "Inventory continues to fill the same terminal height");
});
