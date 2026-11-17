"use strict";

import type { ResourceInspection } from "./model.js";
import type { InstallState } from "../inventory/model.js";
const { targetPath } = require("../installations/files.js");
import type { CatalogResource } from "../resources/model.js";
const { auditTextResources } = require("./audit.js");

const fs = require("node:fs");
const path = require("node:path");
// Native filesystem inspection; browser fixtures provide their own in-memory inspection facts.
function localPreviewFiles(
  targetRoot: string,
  state: InstallState,
  resource: CatalogResource,
): ResourceInspection {
  const record = resource.managed === false
    ? undefined
    : state.sources?.[resource.catalog || "source"]?.[`${resource.kind}s`]?.[resource.id];
  if (resource.managed !== false && (
    !record || record.source_repository !== resource.source_repository ||
    record.source_path !== resource.source_path
  )) {
    throw new Error(`No matching installed source record exists for ${resource.kind}:${resource.id}.`);
  }
  const tracked = record ? Object.keys(record.files || {}) : [];
  const suppliedPaths = resource.managed === false ? resource.paths : tracked;
  if (!Array.isArray(suppliedPaths) || !suppliedPaths.length) {
    throw new Error(`No local installation paths are available for ${resource.kind}:${resource.id}.`);
  }
  const regularFilePath = (relativePath: string) => {
    const absolutePath = targetPath(targetRoot, relativePath);
    const segments = relativePath.split("/");
    let current = targetRoot;
    for (const [index, segment] of segments.entries()) {
      current = path.join(current, segment);
      let stat;
      try {
        stat = fs.lstatSync(current);
      } catch (error) {
        if (error.code === "ENOENT") throw new Error(`Local preview file is missing: ${relativePath}.`);
        throw error;
      }
      if (stat.isSymbolicLink()) throw new Error(`Refusing symbolic link in local preview path: ${relativePath}.`);
      if (index < segments.length - 1 && !stat.isDirectory()) {
        throw new Error(`Local preview path is blocked by a non-directory: ${relativePath}.`);
      }
      if (index === segments.length - 1 && !stat.isFile()) {
        throw new Error(`Local preview path is not a regular file: ${relativePath}.`);
      }
    }
    return absolutePath;
  };
  const readLocalFile = (relativePath: string) => {
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(regularFilePath(relativePath));
    } catch (error) {
      if (["EACCES", "EPERM", "EIO"].includes(error.code)) {
        return {
          path: relativePath,
          content: `[Unreadable file: ${error.code}.]`,
          auditSkipReason: `could not be read (${error.code})`,
        };
      }
      throw error;
    }
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return {
        path: relativePath,
        content: "[Non-text/unsupported file: binary or unsupported bytes are not displayed.]",
        auditBytes: bytes,
      };
    }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(content)) {
      return {
        path: relativePath,
        content: "[Unsupported text: terminal control characters are not displayed.]",
        auditSkipReason: "contains terminal control characters",
      };
    }
    return { path: relativePath, content, auditBytes: bytes };
  };
  const ensureDirectory = (relativePath: string) => {
    targetPath(targetRoot, relativePath);
    let current = targetRoot;
    for (const segment of relativePath.split("/")) {
      current = path.join(current, segment);
      let stat;
      try {
        stat = fs.lstatSync(current);
      } catch (error) {
        if (error.code === "ENOENT") throw new Error(`Local preview directory is missing: ${relativePath}.`);
        throw error;
      }
      if (stat.isSymbolicLink()) throw new Error(`Refusing symbolic link in local preview path: ${relativePath}.`);
      if (!stat.isDirectory()) throw new Error(`Local preview path is not a directory: ${relativePath}.`);
    }
    return current;
  };
  const walkSkill = (relativeDirectory: string, files: string[]) => {
    const absoluteDirectory = ensureDirectory(relativeDirectory);
    for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
      const childPath = path.posix.join(relativeDirectory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Refusing symbolic link in local skill preview: ${childPath}.`);
      if (entry.isDirectory()) walkSkill(childPath, files);
      else if (entry.isFile()) files.push(childPath);
      else throw new Error(`Local skill preview path is not a regular file: ${childPath}.`);
    }
  };
  let paths: string[];
  if (resource.kind === "skill") {
    const entrypoints = resource.managed === false
      ? suppliedPaths.filter((relativePath: string) => /\/SKILL\.md$/i.test(relativePath))
      : tracked.filter((relativePath: string) => /\/SKILL\.md$/i.test(relativePath));
    if (!entrypoints.length) {
      throw new Error(`No installed SKILL.md entrypoint is recorded for ${resource.kind}:${resource.id}.`);
    }
    for (const relativePath of tracked) regularFilePath(relativePath);
    const files: string[] = [];
    for (const entrypoint of entrypoints) walkSkill(path.posix.dirname(entrypoint), files);
    paths = [...new Set(files)].sort();
  } else {
    paths = [...new Set(suppliedPaths)].sort();
  }
  if (!paths.length) throw new Error(`No readable local files were found for ${resource.kind}:${resource.id}.`);
  const files = paths.map(readLocalFile);
  const auditFiles: Array<{ path: string; kind: CatalogResource["kind"]; content: Buffer }> = [];
  const additionalSkipped: Array<{ path: string; reason: string }> = [];
  for (const [index, file] of files.entries()) {
    if (index >= 500) {
      additionalSkipped.push({ path: file.path, reason: "exceeds the 500 file audit limit" });
    } else if (file.auditSkipReason) {
      additionalSkipped.push({ path: file.path, reason: file.auditSkipReason });
    } else if (file.auditBytes) {
      auditFiles.push({ path: file.path, kind: resource.kind, content: file.auditBytes });
    }
  }
  const auditResult = auditTextResources(auditFiles);
  const skipped = [...auditResult.coverage.skipped, ...additionalSkipped];

  return {
    files: files.map(({ path: relativePath, content }) => ({ path: relativePath, content })),
    treeEntries: files.map(({ path }) => ({ path, type: "file" as const })),
    audit: {
      findings: auditResult.findings,
      coverage: {
        discovered: files.length,
        analyzed: auditResult.coverage.analyzed,
        skipped,
        complete: skipped.length === 0 && auditResult.coverage.analyzed === files.length,
      },
    },
  };
}

module.exports = { localPreviewFiles };
