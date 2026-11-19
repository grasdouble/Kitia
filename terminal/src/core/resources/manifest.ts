import path from 'node:path';

import { spdxExpression } from './license.js';
import type { CatalogResource, ResourceKind } from './model.js';
import { rejectUnsupportedVersion, CatalogError, RESOURCE_ID, INSTALLABLE_KINDS } from './model.js';

interface SourceCatalogOptions {
  name: string;
  repositoryId: string;
  label?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isResourceKind(value: unknown): value is ResourceKind {
  return value === 'skill' || value === 'agent' || value === 'instruction';
}

function validateSourceCatalog(
  manifest: unknown,
  { name, repositoryId, label = `catalogs/${name}.json` }: SourceCatalogOptions,
): CatalogResource[] {
  const value = isRecord(manifest) ? manifest : undefined;
  rejectUnsupportedVersion(value?.catalog_version, 1, `${name} catalog`, 'UNSUPPORTED_CATALOG_VERSION');
  if (!value || value.catalog_version !== 1) throw new CatalogError(`${label} must have catalog_version: 1`);
  if (value.catalog_name !== name) throw new CatalogError(`${label} must identify catalog '${name}'`);
  if (
    typeof value.source_repository !== 'string' ||
    value.source_repository !== repositoryId ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.source_repository)
  ) {
    throw new CatalogError(`${label} must reference configured repository ${repositoryId}`);
  }
  if (typeof value.source_ref !== 'string' || !/^[a-f0-9]{40}$/i.test(value.source_ref)) {
    throw new CatalogError(`${label} source_ref must be a full 40-character commit SHA`);
  }
  if (!Array.isArray(value.resources)) throw new CatalogError(`${label} must contain a resources array`);
  const sourceRepository = value.source_repository;
  const sourceRef = value.source_ref;
  return value.resources.map((rawEntry, index): CatalogResource => {
    const entryLabel = `${label} resources[${index}]`;
    if (!isRecord(rawEntry)) throw new CatalogError(`${entryLabel} must be an object`);
    const id = rawEntry.id;
    if (typeof id !== 'string' || id.length > 64 || !RESOURCE_ID.test(id) || id.includes('--')) {
      throw new CatalogError(`${entryLabel}.id must be a lowercase kebab-case identifier of at most 64 characters`);
    }
    const kind = rawEntry.kind;
    if (typeof kind === 'string' && ![...INSTALLABLE_KINDS].includes(kind)) {
      throw new CatalogError(
        `${entryLabel}: resource kind '${kind}' is not supported by this CLI.`,
        'UNSUPPORTED_RESOURCE_KIND',
      );
    }
    const sourcePath = rawEntry.source_path;
    if (
      !isResourceKind(kind) ||
      !INSTALLABLE_KINDS.has(kind) ||
      typeof sourcePath !== 'string' ||
      !sourcePath ||
      sourcePath.startsWith('/') ||
      sourcePath.includes('\\') ||
      sourcePath.split('/').some((part) => !part || part === '.' || part === '..')
    ) {
      throw new CatalogError(
        `${entryLabel} must reference a safe repository-relative skill, agent or instruction path`,
      );
    }
    if (kind === 'skill' && sourcePath.split('/').at(-1) !== id) {
      throw new CatalogError(`${entryLabel} skill path must end with its id`);
    }
    if (
      (kind === 'agent' || kind === 'instruction') &&
      path.posix
        .basename(sourcePath)
        .replace(kind === 'agent' ? /(?:\.agent)?\.md$/i : /(?:\.instructions)?\.md$/i, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') !== id
    ) {
      throw new CatalogError(`${entryLabel} file path must identify ${kind} ${id}`);
    }
    const description = rawEntry.description;
    if (typeof description !== 'string' || !description.trim()) {
      throw new CatalogError(`${entryLabel}.description must be a non-empty string`);
    }
    const licenseStatus = rawEntry.license_status;
    if (typeof licenseStatus !== 'string' || !licenseStatus.trim()) {
      throw new CatalogError(`${entryLabel}.license_status must be a non-empty string`);
    }
    const applyTo = rawEntry.applyTo ?? rawEntry.apply_to;
    const applyToValues = Array.isArray(applyTo)
      ? applyTo.filter((pattern): pattern is string => typeof pattern === 'string')
      : undefined;
    return {
      ...rawEntry,
      id,
      kind,
      description: description.trim(),
      source_repository: sourceRepository,
      source_ref: sourceRef,
      license_status: licenseStatus,
      license_spdx: spdxExpression(licenseStatus),
      ...(kind === 'instruction' ? { applyTo: applyToValues } : {}),
    };
  });
}

export { validateSourceCatalog };
