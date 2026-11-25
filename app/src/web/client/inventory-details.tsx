import {
  canPreviewInstalledResource,
  dashboardStatus,
  installedDestinationLabels,
  issueLine,
} from '../../core/inventory/view.js';
import type { CatalogResource } from '../../core/resources/model.js';

export function installationStatus(resource: CatalogResource) {
  const status = dashboardStatus(resource);
  if (status === 'update') return 'Update available';
  if (status === 'attention') return 'Needs attention';
  if (status === 'unmanaged') return 'Unmanaged';
  return 'Current';
}

export function InventoryDetails({
  resource,
  catalog,
  onPreview,
}: {
  resource: CatalogResource;
  catalog: string;
  onPreview: (resource: CatalogResource) => void;
}) {
  const fields: [string, string | string[] | undefined | null][] = [
    ['Catalog', catalog],
    [
      'License',
      resource.license_spdx ||
        (resource.license_status === 'not-declared' ? 'Not declared' : resource.license_status) ||
        'Not declared',
    ],
    ['Status', installationStatus(resource)],
    ['Installed revision', resource.source_ref || resource.version],
    ['Installed for', installedDestinationLabels(resource)],
    ['Installed paths', resource.paths],
    ['Issues', resource.issues?.map(issueLine)],
    ['Source repository', resource.source_repository],
    ['Source path', resource.source_path],
    ['Category', resource.category],
    ['Tags', resource.tags],
    ['Use when', resource.use_when],
    ['Example', resource.example],
    ['Prerequisites', resource.prerequisites],
    ['Owner', resource.owner],
    ['Expected output', resource.expected_output],
    ['Limitations', resource.limitations],
    ['Deprecation', resource.deprecation_reason],
    ['Replacement', resource.replacement],
    ['Applies to', resource.apply_to || resource.applyTo],
  ];
  return (
    <aside className="panel details" aria-labelledby="selection-heading">
      <p className="eyebrow">
        {resource.kind} · {resource.scope}
      </p>
      <h2 id="selection-heading">{resource.id}</h2>
      <p>{resource.description || 'No description available.'}</p>
      {resource.managed === false ? <p>Not managed by Kitia.</p> : null}
      {canPreviewInstalledResource(resource) ? (
        <button type="button" onClick={() => onPreview(resource)}>
          Preview / audit
        </button>
      ) : null}
      <dl className="detail-fields">
        {fields
          .filter(([, value]) => value && value.length > 0)
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                {Array.isArray(value) ? (
                  <ul>
                    {value.map((item, index) => (
                      <li key={`${index}:${item}`}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  value
                )}
              </dd>
            </div>
          ))}
      </dl>
    </aside>
  );
}
