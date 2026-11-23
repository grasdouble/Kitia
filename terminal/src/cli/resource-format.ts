import { sourceCatalogName } from '../core/inventory/inventory.js';
import type { CatalogResource } from '../core/resources/model.js';

function formatSourceResource(resource: CatalogResource): string {
  return [
    `id: ${resource.id}`,
    `description: ${resource.description}`,
    `catalog: ${sourceCatalogName(resource)}`,
    `source: ${resource.source_repository}/${resource.source_path}@${resource.source_ref}`,
    `license: ${resource.license_status}`,
    `upstream: https://github.com/${resource.source_repository}/tree/${resource.source_ref}/${resource.source_path}`,
  ].join('\n');
}

export { formatSourceResource };
