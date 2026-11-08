"use strict";

function searchTerms(query = "") {
  return query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

function matchesSearchText(query = "", values = []) {
  const words = searchTerms(query);
  const searchable = values.filter(Boolean).join(" ").toLocaleLowerCase();
  return words.every((word) => searchable.includes(word));
}

function searchRelevance(resource, query = "") {
  const words = searchTerms(query);
  if (!words.length) return 0;
  let score = 0;
  for (const word of words) {
    let best = scoreValue(resource.id, word, 100);
    for (const tag of resource.tags || []) best = Math.max(best, scoreValue(tag, word, 60));
    best = Math.max(best, scoreValue(resource.category, word, 35),
      scoreValue(resource.owner, word, 35));
    best = Math.max(best, scoreValue(resource.description, word, 20),
      scoreValue(resource.use_when, word, 20));
    best = Math.max(best, scoreValue(resource.catalog, word, 10),
      scoreValue(resource.kind, word, 10), scoreValue(resource.status, word, 10),
      scoreValue(resource.license_status, word, 10),
      scoreValue(resource.source_repository, word, 10),
      scoreValue(resource.source_path, word, 10));
    if (!best) return 0;
    score += best;
  }
  return score;
}

function scoreValue(value, word, weight) {
  if (!value) return 0;
  const text = String(value).toLocaleLowerCase();
  if (text === word) return weight * 3;
  if (text.startsWith(word)) return weight * 2;
  return text.includes(word) ? weight : 0;
}

function matchesSearch(resource, query = "") {
  return !query.trim() || searchRelevance(resource, query) > 0;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { matchesSearch, matchesSearchText, searchRelevance };
} else {
  globalThis.CatalogSearch = { matchesSearch, matchesSearchText, searchRelevance };
}

