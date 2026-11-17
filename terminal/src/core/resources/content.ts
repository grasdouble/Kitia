"use strict";

import type { CatalogResource } from "./model.js";
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
class PreparedPinnedSourceFile {
  private constructor(
    readonly resource: Readonly<CatalogResource>,
    readonly path: string,
    readonly content: Buffer,
  ) {
    Object.freeze(this);
  }

  static acquire(resource: CatalogResource): PreparedPinnedSourceFile {
    if (!resource.source_repository || !resource.source_ref) {
      throw new CatalogError("Retrieval only supports pinned source-catalog resources", "INVALID_ARGUMENT");
    }
    if (!resource.source_path) throw new CatalogError("Source resource has no pinned path", "INVALID_ARGUMENT");
    const pinned = Object.freeze({ ...resource });
    const filePath = resource.kind === "skill"
      ? `${resource.source_path.replace(/\/$/, "")}/SKILL.md`
      : resource.source_path;
    return new PreparedPinnedSourceFile(pinned, filePath, readPinnedContent({ ...pinned, source_path: filePath }));
  }
}

function preparePinnedSourceFile(resource: CatalogResource): PreparedPinnedSourceFile {
  return PreparedPinnedSourceFile.acquire(resource);
}

export function isPreparedPinnedSourceFile(source: CatalogResource | PreparedPinnedSourceFile): source is PreparedPinnedSourceFile {
  return source instanceof PreparedPinnedSourceFile;
}

function readPinnedContent(resource) {
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


module.exports = { isWithin, readUtf8, preparePinnedSourceFile, isPreparedPinnedSourceFile };

export type { PreparedPinnedSourceFile };
