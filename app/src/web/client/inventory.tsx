import { useMemo, useState } from 'react';

import type { InventorySnapshot, InventoryWorkspace } from '../../application/snapshot.js';
import type { InstallationScope } from '../../core/installations/model.js';
import { filterInventory, inventoryCatalogLabels, summarizeInventory } from '../../core/inventory/view.js';
import type { CatalogResource } from '../../core/resources/model.js';
import { InstalledInspection } from './inspection.js';
import { InventoryDetails, installationStatus } from './inventory-details.js';

function choices(values: Iterable<string | undefined>): string[] {
  return [...new Set([...values].filter((value): value is string => Boolean(value)))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function InventorySummary({ inventory }: { inventory: InventorySnapshot }) {
  const { project, user, current, updates, warnings } = summarizeInventory(inventory.resources);
  const unavailableScopes = new Set(inventory.errors.map(({ scope }) => scope));
  const incomplete = unavailableScopes.has('project') || unavailableScopes.has('user');
  return (
    <dl className="summary" aria-label="Inventory totals">
      {(
        [
          ['project', 'Project resources', project],
          ['user', 'User resources', user],
        ] as const
      ).map(([scope, label, counts]) => (
        <div className="panel" key={scope}>
          <dt>{label}</dt>
          <dd>
            {unavailableScopes.has(scope) ? (
              'Unavailable'
            ) : (
              <>
                <strong>{counts.total}</strong>
                <span>
                  {counts.managed} managed · {counts.total - counts.managed} unmanaged
                </span>
              </>
            )}
          </dd>
        </div>
      ))}
      <div className="panel">
        <dt>Available updates</dt>
        <dd>
          <strong>{updates}</strong>
          <span>
            {current} current · {warnings} warnings{incomplete ? ' · Partial inventory' : ''}
          </span>
        </dd>
      </div>
    </dl>
  );
}

export function Inventory({
  data,
  scope,
  target,
  token,
}: {
  data: InventoryWorkspace;
  scope: InstallationScope;
  target: string;
  token: string;
}) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [catalog, setCatalog] = useState('all');
  const [license, setLicense] = useState('all');
  const [selection, setSelection] = useState<CatalogResource>();
  const [preview, setPreview] = useState<CatalogResource>();
  const { inventory, catalogs } = data;
  const labels = useMemo(() => inventoryCatalogLabels(inventory.resources, catalogs), [inventory.resources, catalogs]);
  const resources = useMemo(
    () => inventory.resources.filter((resource) => resource.scope === scope),
    [inventory.resources, scope],
  );
  const filters = useMemo(
    () => ({
      kinds: choices(resources.map(({ kind }) => kind)),
      catalogs: choices(resources.map((resource) => labels.get(resource))),
      licenses: choices(resources.flatMap(({ license_status, license_spdx }) => [license_status, license_spdx])),
    }),
    [resources, labels],
  );
  const issues = inventory.errors.filter((issue) => issue.scope === scope || issue.scope === 'catalog');
  const visible = filterInventory(resources, query, catalog, kind, catalogs, labels, license);
  const selected = selection && visible.includes(selection) ? selection : visible[0];
  return (
    <section aria-label={`${scope === 'project' ? 'Project' : 'User'} inventory`}>
      <p className="target">
        <code>{target}</code>
      </p>
      {issues.length ? (
        <ul className="warnings panel" aria-label="Inventory warnings">
          {issues.map(({ scope, code, message }, index) => (
            <li key={`${scope}:${code}:${index}`}>
              <strong>
                {scope} · {code}
              </strong>
              : {message}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="filters" role="search" aria-label="Filter resources">
        <label>
          Search
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label>
          Kind
          <select value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="all">All kinds</option>
            {filters.kinds.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Catalog
          <select value={catalog} onChange={(event) => setCatalog(event.target.value)}>
            <option value="all">All catalogs</option>
            {filters.catalogs.map((value) => (
              <option key={value} value={value}>
                {value === '-' ? 'No catalog' : value}
              </option>
            ))}
          </select>
        </label>
        <label>
          License
          <select value={license} onChange={(event) => setLicense(event.target.value)}>
            <option value="all">All licenses</option>
            {filters.licenses.map((value) => (
              <option key={value} value={value}>
                {value === 'not-declared' ? 'Not declared' : value}
              </option>
            ))}
          </select>
        </label>
        {query || kind !== 'all' || catalog !== 'all' || license !== 'all' ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setKind('all');
              setCatalog('all');
              setLicense('all');
            }}
          >
            Clear filters
          </button>
        ) : null}
      </div>
      <div className="workspace">
        <section className="panel resource-list" aria-labelledby="installed-heading">
          <h2 id="installed-heading">Installed resources</h2>
          <p role="status" className="result-count">
            {visible.length} of {resources.length} resources
          </p>
          {visible.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Resource</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Catalog</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((resource) => (
                    <tr
                      key={JSON.stringify([
                        resource.catalog,
                        resource.kind,
                        resource.id,
                        resource.managed,
                        resource.paths,
                      ])}
                      data-selected={selected === resource}
                    >
                      <th scope="row">
                        <button
                          className="row-button"
                          type="button"
                          aria-pressed={selected === resource}
                          onClick={() => setSelection(resource)}
                        >
                          {resource.id}
                        </button>
                      </th>
                      <td>{resource.kind}</td>
                      <td>{labels.get(resource) || '—'}</td>
                      <td>{installationStatus(resource)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : issues.some((issue) => issue.scope === scope) ? (
            <p>Inventory unavailable in this scope.</p>
          ) : (
            <p>
              {resources.length ? 'No resources match the current filters.' : 'No installed resources in this scope.'}
            </p>
          )}
        </section>
        {selected ? (
          <InventoryDetails resource={selected} catalog={labels.get(selected) || '—'} onPreview={setPreview} />
        ) : null}
      </div>
      {preview ? (
        <InstalledInspection scope={scope} resource={preview} token={token} onClose={() => setPreview(undefined)} />
      ) : null}
    </section>
  );
}
