import {
  validateSourceConfiguration,
  catalogNameKey,
  type CatalogEntry,
  type SourceConfiguration,
} from '../catalogs/model.js';
import { validateSourceCatalog } from '../resources/manifest.js';
import { CatalogError } from '../resources/model.js';
import type { CatalogResource } from '../resources/model.js';
import { validateCollectionSignatureEnvelope } from './signatures.js';
type CollectionResourceReference = {
  kind: CatalogResource['kind'];
  id: string;
  source_path?: string;
  description?: string;
  license_status?: string;
  apply_to?: string[];
};
type CollectionSource = {
  name: string;
  repository: string;
  mode: 'basic' | 'custom';
  entries: CatalogEntry[];
  repositoryId: string;
};
type CollectionDataCatalog = {
  name: string;
  repository: string;
  mode: 'basic' | 'custom';
  entries?: CatalogEntry[];
  source_ref: string;
  resources: CollectionResourceReference[];
};
export interface ValidatedCollectionCatalog {
  source: {
    name: string;
    repository: string;
    mode?: 'basic' | 'custom';
    entries?: CatalogEntry[];
  };
  index: {
    catalog_version: 1;
    catalog_name: string;
    source_repository: string;
    source_ref: string;
    resources: unknown[];
  };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function collectionData(resources: CatalogResource[], sources: SourceConfiguration[], selectors: string[]) {
  const byKey = new Map<string, CatalogResource>(
    resources.map((resource): [string, CatalogResource] => [
      `${resource.catalog}:${resource.kind}:${resource.id}`,
      resource,
    ]),
  );
  const selected = selectors.map((selector) => {
    const resource = byKey.get(selector);
    if (!resource) throw new CatalogError(`Collection resource is not available: ${selector}`, 'RESOURCE_NOT_FOUND');
    return resource;
  });
  if (!selected.length) throw new CatalogError('A resource collection must select at least one resource');
  /** @type {Map<string, CollectionDataCatalog>} */
  const grouped = new Map();
  for (const resource of selected) {
    const source = sources.find(({ name }) => name === resource.catalog);
    if (!source) throw new CatalogError(`Resource catalog is not configured: ${resource.catalog}`);
    const sourceRef = resource.source_ref || '';
    if (!/^[a-f0-9]{40}$/i.test(sourceRef)) {
      throw new CatalogError(`Resource has no full commit pin: ${resource.catalog}:${resource.kind}:${resource.id}`);
    }
    const existing = grouped.get(source.name);
    if (existing && existing.source_ref.toLowerCase() !== sourceRef.toLowerCase()) {
      throw new CatalogError(`Catalog ${source.name} has resources pinned to different commits`);
    }
    const catalog = existing || {
      name: source.name,
      repository: source.repository,
      mode: source.mode,
      ...(source.mode === 'custom' ? { entries: source.entries } : {}),
      source_ref: sourceRef.toLowerCase(),
      resources: [],
    };
    catalog.resources.push({
      kind: resource.kind,
      id: resource.id,
      source_path: resource.source_path,
      description: resource.description,
      license_status: resource.license_status,
      ...(resource.kind === 'instruction' ? { apply_to: resource.apply_to || resource.applyTo } : {}),
    });
    grouped.set(source.name, catalog);
  }
  return { collection_version: 1, catalogs: [...grouped.values()] };
}
/** @param {unknown} input */
function validateCollectionManifest(input: unknown): ValidatedCollectionCatalog[] {
  const value = isRecord(input) ? input : undefined;
  const allowedRootKeys = new Set(['collection_version', 'catalogs', 'signature']);
  if (
    !value ||
    value.collection_version !== 1 ||
    Object.keys(value).some((key) => !allowedRootKeys.has(key)) ||
    !Array.isArray(value.catalogs) ||
    !value.catalogs.length
  ) {
    throw new CatalogError('Resource collection must have collection_version: 1 and a non-empty catalogs array');
  }
  if (Object.hasOwn(value, 'signature')) validateCollectionSignatureEnvelope(value.signature);
  const names = new Set();
  const repositories = new Set();
  const catalogs: unknown[] = value.catalogs;
  const validated = catalogs.map((entry, index) => {
    const label = `collection catalogs[${index}]`;
    if (
      !isRecord(entry) ||
      Object.keys(entry).some(
        (key) => !['name', 'repository', 'mode', 'entries', 'source_ref', 'resources'].includes(key),
      )
    ) {
      throw new CatalogError(`${label} contains unsupported or invalid fields`);
    }
    const rawSource: Record<string, unknown> = { name: entry.name, repository: entry.repository };
    if (Object.hasOwn(entry, 'mode')) rawSource.mode = entry.mode;
    if (Object.hasOwn(entry, 'entries')) rawSource.entries = entry.entries;
    const [source] = validateSourceConfiguration({ catalog_version: 1, sources: [rawSource] });
    const nameKey = catalogNameKey(source.name);
    if (names.has(nameKey) || repositories.has(source.repositoryId)) {
      throw new CatalogError(`${label} duplicates a catalog name or repository`);
    }
    names.add(nameKey);
    repositories.add(source.repositoryId);
    const sourceRef = entry.source_ref;
    if (typeof sourceRef !== 'string' || !/^[a-f0-9]{40}$/i.test(sourceRef)) {
      throw new CatalogError(`${label}.source_ref must be a full 40-character commit SHA`);
    }
    if (
      !Array.isArray(entry.resources) ||
      entry.resources.some(
        (resource: unknown) =>
          !isRecord(resource) ||
          Object.keys(resource).some(
            (key) => !['kind', 'id', 'source_path', 'description', 'license_status', 'apply_to'].includes(key),
          ),
      )
    ) {
      throw new CatalogError(`${label}.resources must contain only resource references and metadata`);
    }
    const indexData: ValidatedCollectionCatalog['index'] = {
      catalog_version: 1,
      catalog_name: source.name,
      source_repository: source.repositoryId,
      source_ref: sourceRef.toLowerCase(),
      resources: entry.resources,
    };
    const resources = validateSourceCatalog(indexData, {
      name: source.name,
      repositoryId: source.repositoryId,
      label,
    });
    if (!resources.length) throw new CatalogError(`${label}.resources must not be empty`);
    return {
      source: {
        name: source.name,
        repository: source.repository,
        ...(source.mode === 'custom' ? { mode: source.mode, entries: source.entries } : {}),
      },
      index: indexData,
    };
  });
  return validated;
}

export { collectionData, validateCollectionManifest };
