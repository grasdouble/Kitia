"use strict";

const { CatalogError } = require("./model.js");
const fs = require("node:fs");
const path = require("node:path");
function isWithin(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function readUtf8(filePath, label = "file") {
  const content = fs.readFileSync(filePath);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    throw new CatalogError(`${label} is not valid UTF-8: ${filePath}`);
  }
}


const os = require("node:os");
const { execFileSync } = require("node:child_process");
function readPinnedSourceFile(resource) {
  if (!/^[a-f0-9]{40}$/i.test(resource.source_ref)) throw new CatalogError("Source resource has no pinned commit SHA");
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kitia-source-file-"));
  try {
    const checkout = path.join(temporaryRoot, "repository");
    execFileSync("git", ["clone", "--quiet", "--no-checkout", `https://github.com/${resource.source_repository}.git`, checkout], {
      encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    execFileSync("git", ["-C", checkout, "checkout", "--quiet", "--detach", resource.source_ref], {
      encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    const actualRef = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    if (actualRef.toLowerCase() !== resource.source_ref.toLowerCase()) {
      throw new CatalogError("Retrieved source commit does not match the catalog pin");
    }
    const relative = resource.source_path;
    if (typeof relative !== "string" || !relative || relative.startsWith("/") ||
        relative.includes("\\") || relative.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new CatalogError(`Unsafe source resource path: ${relative}`);
    }
    let current = checkout;
    for (const part of relative.split("/")) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) throw new CatalogError(`Refusing symbolic link in pinned source path: ${relative}`);
    }
    if (!fs.statSync(current).isFile()) throw new CatalogError(`Pinned source resource is not a regular file: ${relative}`);
    return fs.readFileSync(current);
  } catch (error) {
    if (error instanceof CatalogError) throw error;
    throw new CatalogError(`Cannot retrieve pinned source file ${resource.source_repository}/${resource.source_path}@${resource.source_ref}: ${error.message}`);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}


module.exports = { isWithin, readUtf8, readPinnedSourceFile };

export {};
