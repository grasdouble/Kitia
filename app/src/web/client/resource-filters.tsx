import { useState } from 'react';

import type { CatalogResource } from '../../core/resources/model.js';

const initialFilters = { query: '', kind: 'all', catalog: 'all', license: 'all' };

export function useResourceFilters() {
  const [filters, set] = useState(initialFilters);
  return { filters, set };
}

function choices(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b));
}

export function resourceFilterOptions(resources: CatalogResource[], labels: Map<CatalogResource, string>) {
  return {
    kind: choices(resources.map(({ kind }) => kind)),
    catalog: choices(resources.map((resource) => labels.get(resource))),
    license: choices(resources.flatMap(({ license_status, license_spdx }) => [license_status, license_spdx])),
  };
}

export function ResourceFilters({
  filters,
  set,
  options,
}: {
  filters: typeof initialFilters;
  set: (filters: typeof initialFilters) => void;
  options: Record<'kind' | 'catalog' | 'license', string[]>;
}) {
  return (
    <div className="filters" role="search" aria-label="Filter resources">
      <label>
        Search
        <input
          type="search"
          value={filters.query}
          onChange={(event) => set({ ...filters, query: event.target.value })}
        />
      </label>
      {(
        [
          ['kind', 'Kind', 'All kinds'],
          ['catalog', 'Catalog', 'All catalogs'],
          ['license', 'License', 'All licenses'],
        ] as const
      ).map(([field, label, all]) => (
        <label key={field}>
          {label}
          <select value={filters[field]} onChange={(event) => set({ ...filters, [field]: event.target.value })}>
            <option value="all">{all}</option>
            {options[field].map((value) => (
              <option key={value} value={value}>
                {value === '-' && field === 'catalog'
                  ? 'No catalog'
                  : value === 'not-declared' && field === 'license'
                    ? 'Not declared'
                    : value}
              </option>
            ))}
          </select>
        </label>
      ))}
      {filters.query || filters.kind !== 'all' || filters.catalog !== 'all' || filters.license !== 'all' ? (
        <button type="button" onClick={() => set(initialFilters)}>
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
