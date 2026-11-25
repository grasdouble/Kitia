import { useEffect, useMemo, useState } from 'react';

import type {
  CatalogSnapshot,
  InstallationTargets,
  InventorySnapshot,
  ResourceRevision,
} from '../../application/snapshot.js';
import { inventoryCatalogLabels } from '../../core/inventory/view.js';
import { catalogCandidateLabel, filterCatalogResources } from '../../core/resources/catalog-view.js';
import type { CatalogResource } from '../../core/resources/model.js';
import { InspectionDialog } from './inspection.js';
import { InstallDialog } from './install.js';
import { ResourceFilters, resourceFilterOptions, useResourceFilters } from './resource-filters.js';
import { readSessionJson } from './session-api.js';
import { SessionDialog } from './session-dialog.js';

function RevisionsDialog({
  resource,
  endpoint,
  token,
  onClose,
}: {
  resource: CatalogResource;
  endpoint: string;
  token: string;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<ResourceRevision[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    void readSessionJson<ResourceRevision[]>(endpoint, token, controller.signal).then(
      setHistory,
      (failure: unknown) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : 'Could not load revisions.');
      },
    );
    return () => controller.abort();
  }, [endpoint, token]);
  return (
    <SessionDialog title={resource.id} subtitle="Source revisions" closeLabel="Close revisions" onClose={onClose}>
      <p>
        Catalog pin: <code>{resource.source_ref}</code>
      </p>
      <p>
        GitHub history for{' '}
        <code>{resource.kind === 'skill' ? `${resource.source_path}/SKILL.md` : resource.source_path}</code>.
      </p>
      {error ? (
        <p role="alert">{error}</p>
      ) : !history ? (
        <p role="status">Loading commit history…</p>
      ) : history.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Commit</th>
                <th scope="col">Date</th>
                <th scope="col">Subject</th>
              </tr>
            </thead>
            <tbody>
              {history.map(({ sha, prefix, date, subject }) => (
                <tr key={sha}>
                  <th scope="row">
                    <details>
                      <summary>
                        <code>{prefix}</code>
                        {sha === resource.source_ref ? ' · Catalog pin' : ''}
                      </summary>
                      <code>{sha}</code>
                    </details>
                  </th>
                  <td>
                    <time dateTime={date}>{date.slice(0, 10)}</time>
                  </td>
                  <td>{subject}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No commits found for this resource path.</p>
      )}
    </SessionDialog>
  );
}

type CatalogSession = {
  inventory: InventorySnapshot;
  targets: InstallationTargets;
  token: string;
  onInstalled: (inventory: InventorySnapshot) => void;
};

export function BrowseCatalog(session: CatalogSession) {
  const { token } = session;
  const [snapshot, setSnapshot] = useState<CatalogSnapshot>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    void readSessionJson<CatalogSnapshot>('/api/catalog', token, controller.signal).then(
      setSnapshot,
      (failure: unknown) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : 'Could not load the catalogs.');
      },
    );
    return () => controller.abort();
  }, [token]);
  if (!snapshot) return error ? <p role="alert">{error}</p> : <p role="status">Loading catalog resources…</p>;
  return <CatalogResources snapshot={snapshot} {...session} />;
}

const resourceKey = ({ catalog, kind, id }: CatalogResource) => `${catalog}:${kind}:${id}`;

function CatalogResources({
  snapshot,
  inventory,
  targets,
  token,
  onInstalled,
}: CatalogSession & { snapshot: CatalogSnapshot }) {
  const [selection, setSelection] = useState<CatalogResource>();
  const [dialog, setDialog] = useState<'preview' | 'revisions' | 'install'>();
  const { filters, set } = useResourceFilters();
  const { resources, catalogs, warnings } = snapshot;
  const labels = useMemo(() => {
    const result = inventoryCatalogLabels(resources, catalogs);
    for (const resource of resources) result.set(resource, catalogCandidateLabel(resource, result));
    return result;
  }, [resources, catalogs]);
  const options = useMemo(() => resourceFilterOptions(resources, labels), [resources, labels]);
  const installed = useMemo(() => {
    const scopes = new Map<string, Set<string>>();
    for (const resource of inventory.resources) {
      if (!resource.scope || resource.managed === false) continue;
      const key = resourceKey(resource);
      const entries = scopes.get(key);
      if (entries) entries.add(resource.scope);
      else scopes.set(key, new Set([resource.scope]));
    }
    return scopes;
  }, [inventory.resources]);
  const partial = inventory.errors.some(({ scope }) => scope === 'project' || scope === 'user');
  const installation = (resource: CatalogResource) => {
    const scopes = installed.get(resourceKey(resource));
    if (scopes?.has('project')) return scopes.has('user') ? 'Project and user' : 'Project';
    if (scopes?.has('user')) return 'User';
    return partial ? 'Unknown' : 'Not installed';
  };
  const visible = filterCatalogResources(resources, filters.query, filters.catalog, filters.kind, catalogs, {
    license: filters.license === 'all' ? undefined : filters.license,
    labels,
  });
  const selected = selection && visible.includes(selection) ? selection : visible[0];
  const query =
    selected?.catalog && selected.source_repository && selected.source_path && selected.source_ref
      ? new URLSearchParams({
          catalog: selected.catalog,
          kind: selected.kind,
          id: selected.id,
          ref: selected.source_ref,
        })
      : undefined;
  return (
    <section aria-label="Browse resources">
      {warnings.length ? (
        <ul className="warnings panel" aria-label="Catalog warnings">
          {warnings.map(({ catalog, message }) => (
            <li key={catalog}>{message}</li>
          ))}
        </ul>
      ) : null}
      {partial ? <p>Some installed scopes are unavailable. Check Inventory for details.</p> : null}
      <ResourceFilters filters={filters} set={set} options={options} />
      <div className="workspace">
        <section className="panel resource-list" aria-labelledby="catalog-heading">
          <h2 id="catalog-heading">Catalog resources</h2>
          <p role="status" className="result-count">
            {visible.length} of {resources.length} resources
          </p>
          {!catalogs.length ? (
            <p>No catalogs are configured. Add a catalog in the dashboard or with the CLI.</p>
          ) : visible.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Resource</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Catalog</th>
                    <th scope="col">Installed in</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((resource) => (
                    <tr key={resourceKey(resource)} data-selected={selected === resource}>
                      <th scope="row">
                        <button
                          type="button"
                          className="row-button"
                          aria-pressed={selected === resource}
                          onClick={() => setSelection(resource)}
                        >
                          {resource.id}
                        </button>
                      </th>
                      <td>{resource.kind}</td>
                      <td>{labels.get(resource)}</td>
                      <td>{installation(resource)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>
              {resources.length
                ? 'No catalog resources match the current filters.'
                : warnings.length
                  ? 'No catalog resources are currently available.'
                  : 'The configured catalogs contain no resources.'}
            </p>
          )}
        </section>
        {selected ? (
          <aside className="panel details" aria-labelledby="catalog-selection-heading">
            <p className="eyebrow">{selected.kind}</p>
            <h2 id="catalog-selection-heading">{selected.id}</h2>
            <p>{selected.description || 'No description available.'}</p>
            {query ? (
              <div className="resource-actions">
                <button type="button" onClick={() => setDialog('install')}>
                  Install…
                </button>
                <button type="button" onClick={() => setDialog('preview')}>
                  Preview / audit
                </button>
                <button type="button" onClick={() => setDialog('revisions')}>
                  Revisions
                </button>
              </div>
            ) : null}
            <dl className="detail-fields">
              <div>
                <dt>Catalog</dt>
                <dd>{labels.get(selected)}</dd>
              </div>
              <div>
                <dt>License</dt>
                <dd>
                  {selected.license_spdx ||
                    (selected.license_status === 'not-declared' ? 'Not declared' : selected.license_status) ||
                    'Not declared'}
                </dd>
              </div>
              <div>
                <dt>Installed in</dt>
                <dd>{installation(selected)}</dd>
              </div>
              <div>
                <dt>Pinned source</dt>
                <dd>
                  <code>
                    {selected.source_repository && selected.source_path && selected.source_ref
                      ? `${selected.source_repository}/${selected.source_path}@${selected.source_ref}`
                      : 'Unavailable'}
                  </code>
                </dd>
              </div>
              {selected.tags?.length ? (
                <div>
                  <dt>Tags</dt>
                  <dd>{selected.tags.join(' · ')}</dd>
                </div>
              ) : null}
              {selected.status ? (
                <div>
                  <dt>Status</dt>
                  <dd>{selected.status}</dd>
                </div>
              ) : null}
            </dl>
          </aside>
        ) : null}
      </div>
      {query && selected && dialog === 'preview' ? (
        <InspectionDialog
          title={selected.id}
          subtitle={`Pinned catalog source · ${selected.source_ref}`}
          endpoint={`/api/catalog/preview?${query}`}
          token={token}
          onClose={() => setDialog(undefined)}
        />
      ) : null}
      {query && selected && dialog === 'revisions' ? (
        <RevisionsDialog
          resource={selected}
          endpoint={`/api/catalog/revisions?${query}`}
          token={token}
          onClose={() => setDialog(undefined)}
        />
      ) : null}
      {query && selected && dialog === 'install' ? (
        <InstallDialog
          resource={selected}
          selector={query}
          inventory={inventory}
          targets={targets}
          token={token}
          onInstalled={onInstalled}
          onClose={() => setDialog(undefined)}
        />
      ) : null}
    </section>
  );
}
