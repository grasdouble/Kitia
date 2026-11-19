function searchTerms(query = ''): string[] {
  return query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

function matchesSearchText(query = '', values: unknown[] = []): boolean {
  const words = searchTerms(query);
  const searchable = values.filter(Boolean).join(' ').toLocaleLowerCase();
  return words.every((word) => searchable.includes(word));
}

function searchRelevance(
  resource: {
    id: string;
    tags?: string[];
    category?: string;
    owner?: string;
    description?: string;
    use_when?: string;
    catalog?: string;
    kind?: string;
    status?: string;
    license_status?: string;
    source_repository?: string;
    source_path?: string;
  },
  query = '',
): number {
  const words = searchTerms(query);
  if (!words.length) return 0;
  let score = 0;
  for (const word of words) {
    let best = scoreValue(resource.id, word, 100);
    for (const tag of resource.tags || []) best = Math.max(best, scoreValue(tag, word, 60));
    best = Math.max(best, scoreValue(resource.category, word, 35), scoreValue(resource.owner, word, 35));
    best = Math.max(best, scoreValue(resource.description, word, 20), scoreValue(resource.use_when, word, 20));
    best = Math.max(
      best,
      scoreValue(resource.catalog, word, 10),
      scoreValue(resource.kind, word, 10),
      scoreValue(resource.status, word, 10),
      scoreValue(resource.license_status, word, 10),
      scoreValue(resource.source_repository, word, 10),
      scoreValue(resource.source_path, word, 10),
    );
    if (!best) return 0;
    score += best;
  }
  return score;
}

function scoreValue(value: unknown, word: string, weight: number): number {
  if (!value) return 0;
  const text = String(value).toLocaleLowerCase();
  if (text === word) return weight * 3;
  if (text.startsWith(word)) return weight * 2;
  return text.includes(word) ? weight : 0;
}

function matchesSearch(resource: Parameters<typeof searchRelevance>[0], query = ''): boolean {
  return !query.trim() || searchRelevance(resource, query) > 0;
}

export { matchesSearch, matchesSearchText, searchRelevance };
