import { useMemo, useState } from 'react';

import type { InventoryMutation } from '../../application/inventory-mutation.js';
import type { InstalledResourceSelector } from '../../application/inventory-preview.js';
import type { InventorySnapshot, InventoryWorkspace } from '../../application/snapshot.js';
import type { InstallationScope } from '../../core/installations/model.js';
import { filterInventory, inventoryCatalogLabels, summarizeInventory } from '../../core/inventory/view.js';
import type { CatalogResource } from '../../core/resources/model.js';
import { InspectionDialog } from './inspection.js';
import { InventoryActionDialog } from './inventory-action.js';
import { InventoryDetails, installationStatus } from './inventory-details.js';
import { ResourceFilters, resourceFilterOptions, useResourceFilters } from './resource-filters.js';

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

const resourceKey = ({ catalog, kind, id, managed }: CatalogResource) =>
  JSON.stringify([catalog, kind, id, managed !== false]);

function selectorFor(resource: CatalogResource, scope: InstallationScope): InstalledResourceSelector {
  return {
    scope,
    kind: resource.kind,
    id: resource.id,
    catalog: resource.catalog || '',
    managed: resource.managed !== false,
  };
}

export function Inventory({
  data,
  scope,
  target,
  token,
  showUnmanaged,
  onShowUnmanagedChange,
  onChanged,
}: {
  data: InventoryWorkspace;
  scope: InstallationScope;
  target: string;
  token: string;
  showUnmanaged: boolean;
  onShowUnmanagedChange: (show: boolean) => void;
  onChanged: (inventory: InventorySnapshot) => void;
}) {
  const { filters, set } = useResourceFilters();
  const [selection, setSelection] = useState<string>();
  const [preview, setPreview] = useState<CatalogResource>();
  const [mutation, setMutation] = useState<{ action: InventoryMutation; selector: InstalledResourceSelector }>();
  const { inventory, catalogs } = data;
  const labels = useMemo(() => inventoryCatalogLabels(inventory.resources, catalogs), [inventory.resources, catalogs]);
  const resources = useMemo(
    () => inventory.resources.filter((resource) => resource.scope === scope),
    [inventory.resources, scope],
  );
  const options = useMemo(() => resourceFilterOptions(resources, labels), [resources, labels]);
  const issues = inventory.errors.filter((issue) => issue.scope === scope || issue.scope === 'catalog');
  const visible = filterInventory(
    resources,
    filters.query,
    filters.catalog,
    filters.kind,
    catalogs,
    labels,
    filters.license,
    showUnmanaged,
  );
  const selected = visible.find((resource) => resourceKey(resource) === selection) ?? visible[0];
  const onlyHiddenResources =
    !showUnmanaged && resources.length > 0 && resources.every(({ managed }) => managed === false);
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
      <ResourceFilters filters={filters} set={set} options={options} />
      <label className="inventory-visibility">
        <input
          type="checkbox"
          checked={showUnmanaged}
          onChange={(event) => onShowUnmanagedChange(event.target.checked)}
        />
        Show unmanaged resources
      </label>
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
                    <tr key={resourceKey(resource)} data-selected={selected === resource}>
                      <th scope="row">
                        <button
                          className="row-button"
                          type="button"
                          aria-pressed={selected === resource}
                          onClick={() => setSelection(resourceKey(resource))}
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
              {onlyHiddenResources
                ? 'Only unmanaged resources are installed in this scope. Select “Show unmanaged resources” to see them.'
                : resources.length
                  ? 'No resources match the current filters.'
                  : 'No installed resources in this scope.'}
            </p>
          )}
        </section>
        {selected ? (
          <InventoryDetails
            resource={selected}
            catalog={labels.get(selected) || '—'}
            onPreview={setPreview}
            onAction={(action) => setMutation({ action, selector: selectorFor(selected, scope) })}
          />
        ) : null}
      </div>
      {preview ? (
        <InspectionDialog
          title={preview.id}
          subtitle={`Installed source · ${scope}`}
          endpoint={`/api/inventory/preview?${new URLSearchParams({
            ...selectorFor(preview, scope),
            managed: String(preview.managed !== false),
          })}`}
          token={token}
          onClose={() => setPreview(undefined)}
        />
      ) : null}
      {mutation ? (
        <InventoryActionDialog
          {...mutation}
          target={target}
          token={token}
          onChanged={onChanged}
          onClose={() => setMutation(undefined)}
        />
      ) : null}
    </section>
  );
}
