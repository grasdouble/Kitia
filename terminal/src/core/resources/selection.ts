"use strict";

import type { CatalogResource } from "./model.js";
const { CatalogError } = require("./model.js");
async function resolveCatalogResource(
  resources: CatalogResource[],
  id: string,
  kind: string | null = null,
  selector: (resources: CatalogResource[]) => Promise<CatalogResource | null> = async (candidates) => { throw new CatalogError(`Resource is ambiguous: ${candidates.map((entry) => `${entry.catalog}:${entry.kind}:${entry.id}`).join(", ")}`, "AMBIGUOUS_RESOURCE"); },
): Promise<CatalogResource | null> {
  const candidates = resources.filter((resource) =>
    resource.id === id && (!kind || resource.kind === kind),
  );
  if (!candidates.length) {
    throw new CatalogError(`Resource not found: ${kind ? `${kind} ` : ""}${id}`, "RESOURCE_NOT_FOUND");
  }
  if (candidates.length === 1) {
    return candidates[0];
  }
  const selected = await selector(candidates);
  if (!selected) {
    return null;
  }
  return selected;
}

module.exports = { resolveCatalogResource };
