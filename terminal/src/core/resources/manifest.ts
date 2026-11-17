"use strict";

import type { CatalogResource } from "./model.js";
const { rejectUnsupportedVersion, CatalogError, RESOURCE_ID, INSTALLABLE_KINDS } = require("./model.js");
const { spdxExpression } = require("./license.js");
const path = require("node:path");
function validateSourceCatalog(
  manifest,
  { name, repositoryId, label = `catalogs/${name}.json` },
) {
  rejectUnsupportedVersion(manifest?.catalog_version, 1, `${name} catalog`, "UNSUPPORTED_CATALOG_VERSION");
  if (!manifest || Array.isArray(manifest) || manifest.catalog_version !== 1) {
    throw new CatalogError(`${label} must have catalog_version: 1`);
  }
  if (manifest.catalog_name !== name) {
    throw new CatalogError(`${label} must identify catalog '${name}'`);
  }
  if (typeof manifest.source_repository !== "string" ||
      manifest.source_repository !== repositoryId ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(manifest.source_repository)) {
    throw new CatalogError(`${label} must reference configured repository ${repositoryId}`);
  }
  if (typeof manifest.source_ref !== "string" || !/^[a-f0-9]{40}$/i.test(manifest.source_ref)) {
    throw new CatalogError(`${label} source_ref must be a full 40-character commit SHA`);
  }
  if (!Array.isArray(manifest.resources)) {
    throw new CatalogError(`${label} must contain a resources array`);
  }
  const seen = new Set();
  return manifest.resources.map((entry, index) => {
    const entryLabel = `${label} resources[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new CatalogError(`${entryLabel} must be an object`);
    }
    if (typeof entry.id !== "string" || entry.id.length > 64 ||
        !RESOURCE_ID.test(entry.id) || entry.id.includes("--")) {
      throw new CatalogError(`${entryLabel}.id must be a lowercase kebab-case identifier of at most 64 characters`);
    }
    const kind = entry.kind;
    if (typeof kind === "string" && ![...INSTALLABLE_KINDS].includes(kind)) {
      throw new CatalogError(`${entryLabel}: resource kind '${kind}' is not supported by this CLI.`, "UNSUPPORTED_RESOURCE_KIND");
    }
    const sourcePath = entry.source_path;
    if (!INSTALLABLE_KINDS.has(kind) || typeof sourcePath !== "string" || !sourcePath || sourcePath.startsWith("/") ||
        sourcePath.includes("\\") || sourcePath.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new CatalogError(`${entryLabel} must reference a safe repository-relative skill, agent or instruction path`);
    }
    if (kind === "skill" && sourcePath.split("/").at(-1) !== entry.id) {
      throw new CatalogError(`${entryLabel} skill path must end with its id`);
    }
    if ((kind === "agent" || kind === "instruction") &&
        path.posix.basename(sourcePath)
          .replace(kind === "agent" ? /(?:\.agent)?\.md$/i : /(?:\.instructions)?\.md$/i, "")
          .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") !== entry.id) {
      throw new CatalogError(`${entryLabel} file path must identify ${kind} ${entry.id}`);
    }
    if (typeof entry.description !== "string" || !entry.description.trim()) {
      throw new CatalogError(`${entryLabel}.description must be a non-empty string`);
    }
    if (typeof entry.license_status !== "string" || !entry.license_status.trim()) {
      throw new CatalogError(`${entryLabel}.license_status must be a non-empty string`);
    }
    if (kind === "instruction" && (!Array.isArray(entry.apply_to) || !entry.apply_to.length ||
        entry.apply_to.some((pattern) => typeof pattern !== "string" || !pattern.trim()))) {
      throw new CatalogError(`${entryLabel}.apply_to must be a non-empty array of glob strings`);
    }
    const identity = `${kind}:${entry.id}`;
    if (seen.has(identity)) throw new CatalogError(`Duplicate ${name} ${kind}: ${entry.id}`);
    seen.add(identity);
    return {
      ...entry,
      description: entry.description.trim(),
      source_repository: manifest.source_repository,
      source_ref: manifest.source_ref,
      license_spdx: spdxExpression(entry.license_status),
      ...(kind === "instruction" ? { applyTo: entry.apply_to } : {}),
    } as CatalogResource;
  });
}


module.exports = { validateSourceCatalog };
