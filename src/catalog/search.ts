"use strict";

function matchesSearchText(query = "", values = []) {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const searchable = values.filter(Boolean).join(" ").toLocaleLowerCase();
  return words.every((word) => searchable.includes(word));
}

function matchesSearch(resource, query = "") {
  return matchesSearchText(query, [
    resource.id, resource.description, resource.category, resource.owner,
    resource.use_when, resource.group, resource.catalogId || resource.catalog,
    resource.license_status, resource.source_repository, ...(resource.tags || []),
  ]);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { matchesSearch, matchesSearchText };
} else {
  globalThis.CatalogSearch = { matchesSearch, matchesSearchText };
}
