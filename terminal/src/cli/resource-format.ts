"use strict";

import type { CatalogResource } from "../core/resources/model.js";
const { sourceCatalogName } = require("../core/inventory/inventory.js");

function formatSourceResource(resource: CatalogResource): string {
  return [
    `id: ${resource.id}`,
    `description: ${resource.description}`,
    `catalog: ${sourceCatalogName(resource)}`,
    `source: ${resource.source_repository}/${resource.source_path}@${resource.source_ref}`,
    `license: ${resource.license_status}`,
    `upstream: https://github.com/${resource.source_repository}/tree/${resource.source_ref}/${resource.source_path}`,
  ].join("\n");
}

module.exports = { formatSourceResource };
