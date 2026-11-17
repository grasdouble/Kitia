"use strict";

const { CatalogError } = require("../resources/model.js");
const { resolveSourceVersionPrefix, listSourceVersions } = require("../resources/history.js");
function resolveListedSourceRef(resource, ref) {
  if (!resource.source_repository || !resource.source_path) {
    throw new CatalogError("--ref supports only GitHub source resources.");
  }
  if (ref.length === 40) return ref;
  try {
    return resolveSourceVersionPrefix(
      listSourceVersions(resource),
      ref,
    );
  } catch (error) {
    if (error.code === "RESOURCE_NOT_FOUND" || error.code === "AMBIGUOUS_RESOURCE") {
      throw new CatalogError(
        `${error.message.replace(/ in source history\.$/, ` for ${resource.catalog}:${resource.kind}:${resource.id}.`)}`,
        error.code,
      );
    }
    throw error;
  }
}

module.exports = { resolveListedSourceRef };

export {};
