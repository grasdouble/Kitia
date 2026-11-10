"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createForceRetryPrompt } = require("../dist/dashboard/action-retry.mjs");

const resource = { catalog: "main", kind: "agent", id: "reviewer" };

test("local update conflicts produce a confirmation prompt without losing ref or error context", () => {
  const prompt = createForceRetryPrompt({ action: "update", resource, ref: "a".repeat(40) }, {
    code: "LOCAL_CONFLICT", recoverable: true, category: "local-modification",
    paths: [".agents/agents/reviewer.md"], userMessage: "The file has local edits.",
  });
  assert.deepEqual(prompt, {
    confirmation: {
      action: "update", resource, ref: "a".repeat(40), forceRetry: true,
      conflict: {
        category: "local-modification", paths: [".agents/agents/reviewer.md"],
        message: "The file has local edits.",
      },
    },
    message: "Update blocked by a local conflict; choose whether to force and retry.",
  });
});

test("GitHub force retries are limited to one retry per reported agent", () => {
  const requested = { action: "update", resource, ghForceAgents: ["already-retried"] };
  const prompt = createForceRetryPrompt(requested, {
    code: "GH_FORCE_REQUIRED", recoverable: true, agent: "new-agent", paths: ["file"],
  });
  assert.deepEqual(prompt.confirmation, {
    action: "update", resource, forceRetry: true, ghForceRetry: true,
    ghForceAgent: "new-agent", ghForceAgents: ["already-retried", "new-agent"],
    conflict: { category: "github-force-required", paths: ["file"] },
  });
  assert.equal(prompt.message, "GitHub CLI requested overwrite; confirm whether to retry with --force.");
  assert.equal(createForceRetryPrompt(requested, {
    code: "GH_FORCE_REQUIRED", recoverable: true, agent: "already-retried",
  }), null);
});

test("retry prompts reject non-update and non-recoverable failures", () => {
  assert.equal(createForceRetryPrompt({ action: "install", resource }, {
    code: "LOCAL_CONFLICT", recoverable: true,
  }), null);
  assert.equal(createForceRetryPrompt({ action: "update", resource }, {
    code: "LOCAL_CONFLICT", recoverable: false,
  }), null);
  assert.equal(createForceRetryPrompt({ action: "update", resource, forceRetry: true }, {
    code: "LOCAL_CONFLICT", recoverable: true,
  }), null);
});
