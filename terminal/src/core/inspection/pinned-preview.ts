import type { AuditResult } from "./audit.js";
"use strict";

import type { CatalogResource } from "../resources/model.js";
const { CatalogError } = require("../resources/model.js");
const { readPinnedSourceFile } = require("../resources/content.js");
const { auditTextResources } = require("./audit.js");
function auditPinnedResource(
  resource: CatalogResource,
): AuditResult {
  if (!resource.source_repository || !resource.source_ref) {
    throw new CatalogError("--audit only supports pinned source-catalog resources", "INVALID_ARGUMENT");
  }
  if (!resource.source_path) throw new CatalogError("Source resource has no pinned path to audit", "INVALID_ARGUMENT");
  const filePath = resource.kind === "skill"
    ? `${resource.source_path.replace(/\/$/, "")}/SKILL.md`
    : resource.source_path;
  const files = [{
    path: filePath,
    kind: resource.kind,
    content: readPinnedSourceFile({ ...resource, source_path: filePath }),
  }];
  const result = auditTextResources(files);
  return result;
}

module.exports = { auditPinnedResource };
