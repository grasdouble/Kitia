"use strict";

const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const { readInstallState } = require("./inventory/index.js");
const { inspectOperationLock, OPERATION_LOCK } = require("./operation.js");
const { loadUserSourceConfiguration } = require("./sources/config.js");

function diagnose({ target = ".", network = false } = {}, spawn = spawnSync) {
  const checks = [];
  const add = (id, status, message) => checks.push({ id, status, message });
  let sources = [];
  try {
    sources = loadUserSourceConfiguration();
    add("source-config", "ok", `Loaded ${sources.length} configured skill source(s).`);
  } catch (error) {
    add("source-config", "error", error.message);
  }
  add("node", Number(process.versions.node.split(".")[0]) >= 22 ? "ok" : "error",
    `Node.js ${process.versions.node}; version 22 or later is required.`);
  const probe = (command, args) => spawn(command, args, {
    encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GH_PROMPT_DISABLED: "1" },
  });
  const git = probe("git", ["--version"]);
  add("git", git.status === 0 ? "ok" : "error",
    git.status === 0 ? git.stdout.trim() : "Git is unavailable. Install Git and ensure it is on PATH.");
  const gh = probe("gh", ["--version"]);
  add("gh", gh.status === 0 ? "ok" : "warning",
    gh.status === 0 ? gh.stdout.split("\n")[0] : "GitHub CLI is unavailable; source catalog refresh, preview and installation require it.");
  if (gh.status === 0) {
    const skill = probe("gh", ["skill", "--help"]);
    add("gh-skill", skill.status === 0 ? "ok" : "warning",
      skill.status === 0 ? "GitHub CLI supports gh skill." : "Upgrade GitHub CLI to a version supporting gh skill.");
  }
  try {
    if (!fs.statSync(target).isDirectory()) throw new Error("Not a directory");
    const root = fs.realpathSync(target);
    fs.accessSync(root, fs.constants.R_OK | fs.constants.W_OK);
    add("target", "ok", "Target directory is readable and writable.");
    readInstallState(root);
    add("inventory", "ok", "Installation inventory is readable and valid (or not yet created).");
    const lock = inspectOperationLock(root);
    add("operation-lock", lock.status === "absent" ? "ok" : "warning",
      lock.status === "absent" ? "No operation is holding this target."
        : lock.status === "stale"
          ? `The recorded operation has exited. Review its changes, then explicitly remove ${OPERATION_LOCK} before retrying.`
          : `An active or unknown operation lock exists (${OPERATION_LOCK}); do not remove it while an operation may be running.`);
  } catch (error) {
    add("target-inventory", "error", error.message);
  }
  if (network && gh.status === 0) {
    const auth = probe("gh", ["auth", "status", "--active"]);
    add("github-auth", auth.status === 0 ? "ok" : "error",
      auth.status === 0 ? "GitHub CLI authentication is available." : "Authenticate GitHub CLI with access to the required repositories.");
    if (auth.status === 0) {
      const repositories = [...new Set(sources.map((source) => source.repositoryId))];
      for (const repository of repositories) {
        const access = probe("gh", ["api", "--hostname", "github.com", `repos/${repository}`, "--silent"]);
        add(`access:${repository}`, access.status === 0 ? "ok" : "error",
          access.status === 0 ? `GitHub CLI can read ${repository}.` : `Cannot read ${repository}; check permissions and connectivity.`);
      }
    }
  } else {
    add("network", "skipped", network ? "Network checks require GitHub CLI." : "No network checks requested. Use --network to check GitHub authentication and repository access.");
  }
  return { checks, attention: checks.some(({ status }) => status === "error" || status === "warning") };
}

module.exports = { diagnose };
