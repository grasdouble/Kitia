"use strict";

const { createSourceIndex } = require("./discovery.js");
const { CatalogError } = require("../resources/model.js");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFile, execFileSync } = require("node:child_process");
const { promisify } = require("node:util");
const execFileAsync = promisify(execFile);

function fetchSourceIndex(source) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-catalog-"));
  try {
    const checkout = path.join(temporaryRoot, "checkout");
    execFileSync("git", ["clone", "--quiet", "--depth", "1", source.repository, checkout], {
      encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return createSourceIndex(source.repository, source.name, checkout, source);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

async function remoteHead(repository, run = execFileAsync) {
  const { stdout } = await run("git", ["ls-remote", "--symref", repository, "HEAD"], {
    encoding: "utf8",
    timeout: 15000,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  const match = String(stdout).match(/^([a-f0-9]{40})\tHEAD$/im);
  if (!match) throw new CatalogError(`Cannot resolve the default branch of ${repository}`);
  return match[1].toLowerCase();
}

module.exports = { fetchSourceIndex, remoteHead };

export {};
