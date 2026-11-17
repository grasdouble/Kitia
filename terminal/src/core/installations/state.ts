"use strict";

import type { FileFingerprint } from "./plan.js";
import type { InstallState } from "./model.js";
const { targetPath } = require("./files.js");
const { LOCK_PATH, SOURCE_SKILL_DIRECTORIES } = require("./model.js");
const { CURRENT_INVENTORY_VERSION } = require("./version.js");
const { readUtf8 } = require("../resources/content.js");
const { CatalogError, rejectUnsupportedVersion, RESOURCE_ID } = require("../resources/model.js");
import { isJsonObject } from "../resources/json.js";
const fs = require("node:fs");
const CATALOG_NAME = "grasdouble/Kitia";

function isFileFingerprint(value: unknown): value is FileFingerprint {
  return isJsonObject(value) && typeof value.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(value.sha256) && typeof value.executable === "boolean";
}

function validSourceCatalogName(name: string): boolean {
  return name.length > 0 && name === name.trim() &&
    !/[\/\\:\u0000-\u001f\u007f-\u009f]/u.test(name);
}

const SOURCE_RECORD_FIELDS = new Set(["source_repository", "source_path", "source_ref", "apply_to", "license_status", "files"]);

function readInstallState(targetRoot: string): InstallState {
  const lockFile = targetPath(targetRoot, LOCK_PATH);
  if (!fs.existsSync(lockFile)) return { lock_version: CURRENT_INVENTORY_VERSION, catalog: CATALOG_NAME, sources: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readUtf8(lockFile, "Installation state"));
  } catch (error) {
    throw new CatalogError(`Cannot read ${LOCK_PATH}: ${error.message}`);
  }
  const fail = (): never => { throw new CatalogError(`Invalid installation state in ${LOCK_PATH}; restore it from version control before continuing.`); };
  const state = isJsonObject(parsed) ? parsed : fail();
  if (state.catalog !== CATALOG_NAME) fail();
  const version = state.lock_version;
  if (typeof version === "number" && Number.isSafeInteger(version) && version > 0 && version < CURRENT_INVENTORY_VERSION) {
    throw new CatalogError(
      `Installation inventory version ${version} must be migrated before using this CLI. Run npx --yes @grasdouble/kitia migrate --apply; inventories already at the current version are skipped.`,
      "INVENTORY_MIGRATION_REQUIRED",
    );
  }
  if (version !== CURRENT_INVENTORY_VERSION) {
    rejectUnsupportedVersion(version, CURRENT_INVENTORY_VERSION,
      "Installation inventory", "UNSUPPORTED_INVENTORY_VERSION");
  }
  if (Object.keys(state).some((key) => !["lock_version", "catalog", "sources"].includes(key)) ||
      !isJsonObject(state.sources)) fail();
  const sources = state.sources;
  for (const [catalog, collectionsValue] of Object.entries(sources)) {
    if (!validSourceCatalogName(catalog) || !isJsonObject(collectionsValue)) fail();
    for (const [collection, recordsValue] of Object.entries(collectionsValue)) {
      if (!["skills", "agents", "instructions"].includes(collection)) {
        throw new CatalogError(`Source inventory contains unsupported resource collection '${collection}'. Use a compatible CLI version; do not rewrite the inventory.`, "UNSUPPORTED_RESOURCE_KIND");
      }
      if (!isJsonObject(recordsValue)) fail();
      const kind = collection.slice(0, -1);
      for (const [id, recordValue] of Object.entries(recordsValue)) {
        const record = isJsonObject(recordValue) ? recordValue : fail();
        if (Object.keys(record).some((field) => !SOURCE_RECORD_FIELDS.has(field))) fail();
        const sourcePath = record.source_path;
        const sourceParts = typeof sourcePath === "string" ? sourcePath.split("/") : [];
        const validSourcePath = typeof sourcePath === "string" && sourceParts.length > 0 && !sourcePath.startsWith("/") &&
          !sourcePath.includes("\\") && sourceParts.every((part) => part && part !== "." && part !== "..");
        const files = isJsonObject(record.files) ? record.files : fail();
        if (!RESOURCE_ID.test(id) || id.length > 64 ||
            typeof record.source_repository !== "string" ||
            !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(record.source_repository) ||
            !validSourcePath ||
            (record.source_ref !== undefined && (typeof record.source_ref !== "string" || !/^[a-f0-9]{40}$/i.test(record.source_ref))) ||
            (record.apply_to !== undefined && (!Array.isArray(record.apply_to) || record.apply_to.some((value) => typeof value !== "string"))) ||
            (record.license_status !== undefined && typeof record.license_status !== "string") ||
            !Object.keys(files).length) fail();
        const allowedPaths = kind === "skill" ? null : kind === "agent"
          ? new Set([`.claude/agents/${id}.md`, `.github/agents/${id}.agent.md`, `.copilot/agents/${id}.agent.md`])
          : new Set([`.claude/rules/${id}.md`, `.github/instructions/${id}.instructions.md`]);
        let hasSkillEntryPoint = false;
        for (const [relativePath, file] of Object.entries(files)) {
          const validSkillFile = kind === "skill" && Object.values(SOURCE_SKILL_DIRECTORIES).some((directory) => {
            const skillPrefix = `${directory}/${id}/`;
            return relativePath.startsWith(skillPrefix) &&
              relativePath.split("/").every((part) => part && part !== "." && part !== "..");
          });
          if ((kind === "skill" ? !validSkillFile : !allowedPaths.has(relativePath)) || !isFileFingerprint(file)) fail();
          if (kind === "skill" && Object.values(SOURCE_SKILL_DIRECTORIES).some((directory) =>
            relativePath === `${directory}/${id}/SKILL.md`)) hasSkillEntryPoint = true;
          targetPath(targetRoot, relativePath);
        }
        if (kind === "skill" && !hasSkillEntryPoint) fail();
      }
    }
  }
  return state as unknown as InstallState;
}

module.exports = { readInstallState };
