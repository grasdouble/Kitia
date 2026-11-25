import fs from 'node:fs';
import path from 'node:path';

import type { InstallationDestination } from '../installations/destinations.js';
import { availableInstallationDestinations, installationPath } from '../installations/destinations.js';
import {
  installedFingerprint,
  sameFingerprint,
  addInventoryStateToPlan,
  writeInstallPlan,
  targetPath,
} from '../installations/files.js';
import type { InstallPlanEntry } from '../installations/plan.js';
import { readUtf8 } from '../resources/content.js';
import { parseFrontmatter } from '../resources/frontmatter.js';
import { isJsonObject } from '../resources/json.js';
import type { CatalogResource } from '../resources/model.js';
import { CatalogError, rejectUnsupportedVersion, RESOURCE_ID } from '../resources/model.js';
import type { InstallState, SourceResourceInventoryRecord, FileFingerprint } from './model.js';
import { LOCK_PATH } from './model.js';
import { CURRENT_INVENTORY_VERSION } from './version.js';
const CATALOG_NAME = 'grasdouble/Kitia';
const SKILL_LAYOUTS = availableInstallationDestinations('skill');
const FILE_LAYOUTS = {
  agent: availableInstallationDestinations('agent'),
  instruction: availableInstallationDestinations('instruction'),
};

function isFileFingerprint(value: unknown): value is FileFingerprint {
  return (
    isJsonObject(value) &&
    typeof value.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.sha256) &&
    typeof value.executable === 'boolean'
  );
}

function validSourceCatalogName(name: string): boolean {
  return name.length > 0 && name === name.trim() && !/[\/\\:\u0000-\u001f\u007f-\u009f]/u.test(name);
}

const SOURCE_RECORD_FIELDS = new Set([
  'source_repository',
  'source_path',
  'source_ref',
  'apply_to',
  'license_status',
  'files',
]);

function readInstallState(targetRoot: string): InstallState {
  const lockFile = targetPath(targetRoot, LOCK_PATH);
  if (!fs.existsSync(lockFile)) return { lock_version: CURRENT_INVENTORY_VERSION, catalog: CATALOG_NAME, sources: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readUtf8(lockFile, 'Installation state'));
  } catch (error) {
    throw new CatalogError(`Cannot read ${LOCK_PATH}: ${(error as Error).message}`);
  }
  const fail = (): never => {
    throw new CatalogError(
      `Invalid installation state in ${LOCK_PATH}; restore it from version control before continuing.`,
    );
  };
  const state = isJsonObject(parsed) ? parsed : fail();
  if (state.catalog !== CATALOG_NAME) fail();
  const version = state.lock_version;
  if (
    typeof version === 'number' &&
    Number.isSafeInteger(version) &&
    version > 0 &&
    version < CURRENT_INVENTORY_VERSION
  ) {
    throw new CatalogError(
      `Installation inventory version ${version} must be migrated before using this CLI. Run npx --yes @grasdouble/kitia migrate --apply; inventories already at the current version are skipped.`,
      'INVENTORY_MIGRATION_REQUIRED',
    );
  }
  if (version !== CURRENT_INVENTORY_VERSION) {
    rejectUnsupportedVersion(
      version,
      CURRENT_INVENTORY_VERSION,
      'Installation inventory',
      'UNSUPPORTED_INVENTORY_VERSION',
    );
  }
  const sourcesValue = state.sources;
  if (
    Object.keys(state).some((key) => !['lock_version', 'catalog', 'sources'].includes(key)) ||
    !isJsonObject(sourcesValue)
  )
    return fail();
  const sources = sourcesValue;
  for (const [catalog, collectionsValue] of Object.entries(sources)) {
    if (!validSourceCatalogName(catalog) || !isJsonObject(collectionsValue)) return fail();
    const collections = collectionsValue;
    for (const [collection, recordsValue] of Object.entries(collections)) {
      if (!['skills', 'agents', 'instructions'].includes(collection)) {
        throw new CatalogError(
          `Source inventory contains unsupported resource collection '${collection}'. Use a compatible CLI version; do not rewrite the inventory.`,
          'UNSUPPORTED_RESOURCE_KIND',
        );
      }
      if (!isJsonObject(recordsValue)) return fail();
      const records = recordsValue;
      const kind = collection.slice(0, -1) as CatalogResource['kind'];
      for (const [id, recordValue] of Object.entries(records)) {
        const record = isJsonObject(recordValue) ? recordValue : fail();
        if (Object.keys(record).some((field) => !SOURCE_RECORD_FIELDS.has(field))) fail();
        const sourcePath = record.source_path;
        const sourceParts = typeof sourcePath === 'string' ? sourcePath.split('/') : [];
        const validSourcePath =
          typeof sourcePath === 'string' &&
          sourceParts.length > 0 &&
          !sourcePath.startsWith('/') &&
          !sourcePath.includes('\\') &&
          sourceParts.every((part) => part && part !== '.' && part !== '..');
        const files = isJsonObject(record.files) ? record.files : fail();
        if (
          !RESOURCE_ID.test(id) ||
          id.length > 64 ||
          typeof record.source_repository !== 'string' ||
          !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(record.source_repository) ||
          !validSourcePath ||
          (record.source_ref !== undefined &&
            (typeof record.source_ref !== 'string' || !/^[a-f0-9]{40}$/i.test(record.source_ref))) ||
          (record.apply_to !== undefined &&
            (!Array.isArray(record.apply_to) || record.apply_to.some((value) => typeof value !== 'string'))) ||
          (record.license_status !== undefined && typeof record.license_status !== 'string') ||
          !Object.keys(files).length
        )
          fail();
        const allowedPaths =
          kind === 'skill' ? null : new Set(FILE_LAYOUTS[kind].map((layout) => installationPath(layout, id)));
        let hasSkillEntryPoint = false;
        for (const [relativePath, file] of Object.entries(files)) {
          const validSkillFile =
            kind === 'skill' &&
            SKILL_LAYOUTS.some(({ directory }) => {
              const skillPrefix = `${directory}/${id}/`;
              return (
                relativePath.startsWith(skillPrefix) &&
                relativePath.split('/').every((part) => part && part !== '.' && part !== '..')
              );
            });
          if ((kind === 'skill' ? !validSkillFile : !allowedPaths?.has(relativePath)) || !isFileFingerprint(file))
            fail();
          if (kind === 'skill' && SKILL_LAYOUTS.some((layout) => relativePath === installationPath(layout, id)))
            hasSkillEntryPoint = true;
          targetPath(targetRoot, relativePath);
        }
        if (kind === 'skill' && !hasSkillEntryPoint) fail();
      }
    }
  }
  return state as unknown as InstallState;
}

export interface SourceResourceInstallation {
  destination: InstallationDestination;
  path: string;
  ref: string | null;
  missing: boolean;
  modified: boolean;
  provenanceMatches: boolean;
}

export interface InstalledSourceResource {
  resource: CatalogResource;
  installations: SourceResourceInstallation[];
  removed: boolean;
}

function sourceCatalogName(resource: CatalogResource): string {
  return resource.catalog || 'source';
}

function sourceResourceKey(resource: CatalogResource): string {
  return `${resource.catalog || 'source'}:${resource.kind}:${resource.id}`;
}

function sourceSkillKey(resource: CatalogResource): string {
  return `${resource.catalog || 'source'}:${resource.id}`;
}

function sourceResourceRecords(state: InstallState): Map<string, SourceResourceInventoryRecord> {
  const records = new Map<string, SourceResourceInventoryRecord>();
  for (const [catalog, collections] of Object.entries(state.sources || {})) {
    for (const kind of ['skill', 'agent', 'instruction']) {
      const collection = collections[`${kind}s`] || {};
      for (const [id, record] of Object.entries(collection)) {
        records.set(`${catalog}:${kind}:${id}`, record);
      }
    }
  }
  return records;
}

function sourceSkillRecords(state: InstallState): Map<string, SourceResourceInventoryRecord> {
  return new Map(
    [...sourceResourceRecords(state)]
      .filter(([key]) => key.split(':')[1] === 'skill')
      .map(([key, record]) => {
        const [, , id] = key.split(':');
        return [`${key.split(':')[0]}:${id}`, record];
      }),
  );
}

function sourceResourceRecord(
  state: InstallState,
  catalog: string,
  kind: string,
  id: string,
): SourceResourceInventoryRecord | undefined {
  return sourceResourceRecords(state).get(`${catalog}:${kind}:${id}`);
}

function sourceSkillRecord(
  state: InstallState,
  catalog: string,
  id: string,
): SourceResourceInventoryRecord | undefined {
  return sourceResourceRecord(state, catalog, 'skill', id);
}

function inventorySourceNames(state: InstallState): string[] {
  return [...new Set([...sourceResourceRecords(state).keys()].map((key) => key.split(':')[0]))];
}

function sameSourceRecord(record: SourceResourceInventoryRecord, resource: CatalogResource): boolean {
  return record.source_repository === resource.source_repository && record.source_path === resource.source_path;
}

function removeSourceResourceRecord(state: InstallState, resource: CatalogResource): boolean {
  const catalog = sourceCatalogName(resource);
  const collectionName = `${resource.kind}s`;
  const collection = state.sources?.[catalog]?.[collectionName];
  if (!collection?.[resource.id] || !sameSourceRecord(collection[resource.id], resource)) return false;
  delete collection[resource.id];
  if (Object.keys(collection).length === 0) delete state.sources[catalog][collectionName];
  if (state.sources?.[catalog] && Object.keys(state.sources[catalog]).length === 0) delete state.sources[catalog];
  return true;
}

function removeSourceSkillRecord(state: InstallState, resource: CatalogResource): boolean {
  return removeSourceResourceRecord(state, resource);
}

function matchesSourceRepository(value: unknown, repository: string): boolean {
  if (typeof value !== 'string') return false;
  if (value === repository) {
    return true;
  }
  try {
    const url = new URL(value);
    const pathname = url.pathname.replace(/\/+$/, '').replace(/\.git$/i, '');
    return url.hostname.toLowerCase() === 'github.com' && pathname.toLowerCase() === `/${repository}`.toLowerCase();
  } catch {
    return false;
  }
}
function readInstalledSourceResources(
  target: string,
  sourceResources: CatalogResource[],
  { catalog, kind }: { catalog?: string; kind?: string } = {},
): InstalledSourceResource[] {
  const targetRoot = fs.realpathSync(target);
  const state = readInstallState(targetRoot);
  const records = sourceResourceRecords(state);
  const candidates = new Map<string, CatalogResource>(
    sourceResources
      .filter((resource) => (!catalog || sourceCatalogName(resource) === catalog) && (!kind || resource.kind === kind))
      .map((resource) => [sourceResourceKey(resource), resource] as [string, CatalogResource]),
  );
  for (const [key, record] of records) {
    if (catalog && key.split(':')[0] !== catalog) continue;
    const [, resourceKind, id] = key.split(':');
    if (kind && resourceKind !== kind) continue;
    const current = candidates.get(key);
    if (
      !current ||
      current.source_repository !== record.source_repository ||
      current.source_path !== record.source_path
    ) {
      const catalogName = key.split(':')[0];
      candidates.set(key, {
        id,
        kind: resourceKind as CatalogResource['kind'],
        catalog: catalogName,
        ...record,
        source_ref: null,
        removed: true,
      });
    }
  }
  const installed: InstalledSourceResource[] = [];
  for (const [key, resource] of candidates) {
    const record = records.get(key);
    if (!record || resource.kind === 'skill') continue;
    const installations: SourceResourceInstallation[] = [];
    for (const [relativePath, expected] of Object.entries(record.files || {})) {
      const layout = FILE_LAYOUTS[resource.kind].find(
        (entry) => installationPath(entry, resource.id) === relativePath,
      )!;
      let current;
      try {
        current = installedFingerprint(targetRoot, relativePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      installations.push({
        destination: layout.id,
        path: relativePath,
        ref: record.source_ref || null,
        missing: !current,
        modified: Boolean(current && !sameFingerprint(current, expected)),
        provenanceMatches: true,
      });
    }
    if (installations.length) installed.push({ resource, installations, removed: Boolean(resource.removed) });
  }
  return installed;
}

function setSourceResourceRecord(
  state: InstallState,
  resource: CatalogResource,
  files: Record<string, FileFingerprint>,
): void {
  const collectionName = `${resource.kind}s`;
  state.sources ||= {};
  state.sources[sourceCatalogName(resource)] ||= {};
  state.sources[sourceCatalogName(resource)][collectionName] ||= {};
  state.sources[sourceCatalogName(resource)][collectionName][resource.id] = {
    source_repository: resource.source_repository!,
    source_path: resource.source_path!,
    source_ref: resource.source_ref!,
    ...(resource.apply_to ? { apply_to: resource.apply_to } : {}),
    license_status: resource.license_status,
    files,
  };
}
function readInstalledSourceSkills(
  target: string,
  sourceResources: CatalogResource[],
  { catalog }: { catalog?: string } = {},
): InstalledSourceResource[] {
  const targetRoot = fs.realpathSync(target);
  const state: InstallState = readInstallState(targetRoot);
  const records = Object.fromEntries(
    [...sourceSkillRecords(state)].filter(([key]) => !catalog || key.startsWith(`${catalog}:`)),
  );
  const candidates = new Map<string, CatalogResource>(
    sourceResources
      .filter((resource) => resource.kind === 'skill' && (!catalog || sourceCatalogName(resource) === catalog))
      .map((resource) => [sourceSkillKey(resource), resource]),
  );
  for (const [key, record] of Object.entries(records)) {
    const current = candidates.get(key);
    if (
      !current ||
      current.source_repository !== record.source_repository ||
      current.source_path !== record.source_path
    ) {
      const [catalog, id] = key.split(':');
      candidates.set(key, {
        id,
        kind: 'skill',
        catalog,
        ...record,
        source_ref: null,
        removed: true,
      });
    }
  }
  const installed: InstalledSourceResource[] = [];
  for (const [key, resource] of candidates) {
    const record = records[key];
    if (!record) continue;
    const installations: SourceResourceInstallation[] = [];
    for (const layout of SKILL_LAYOUTS) {
      const directoryPrefix = `${layout.directory}/${resource.id}/`;
      const trackedFiles = Object.entries(record.files).filter(([filePath]) => filePath.startsWith(directoryPrefix));
      if (!trackedFiles.length) continue;
      const relativePath = installationPath(layout, resource.id);
      const skillFile = targetPath(targetRoot, relativePath);
      const expected = record.files[relativePath];
      let stat;
      try {
        stat = fs.lstatSync(skillFile);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          installations.push({
            destination: layout.id,
            path: relativePath,
            ref: null,
            missing: true,
            modified: false,
            provenanceMatches: false,
          });
          continue;
        }
        throw error;
      }
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new CatalogError(`Installed source skill is not a regular file: ${relativePath}`);
      }
      let metadata;
      try {
        metadata = parseFrontmatter(readUtf8(skillFile, 'Installed source skill'), skillFile).get('metadata');
      } catch (error) {
        if (!expected || !(error instanceof CatalogError)) throw error;
      }
      const { matches: provenanceMatches, ref } = skillProvenance(metadata, resource);
      let missing = false;
      let modified = Boolean(expected && !provenanceMatches);
      for (const [trackedPath, expectedFingerprint] of trackedFiles) {
        let current;
        try {
          current = installedFingerprint(targetRoot, trackedPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        if (!current) missing = true;
        else if (!sameFingerprint(current, expectedFingerprint)) modified = true;
      }
      installations.push({
        destination: layout.id,
        path: relativePath,
        ref,
        missing,
        modified,
        provenanceMatches,
      });
    }
    if (installations.length) {
      installed.push({
        resource,
        installations,
        removed: Boolean(resource.removed),
      });
    }
  }
  return installed;
}

function installedSkillFiles(targetRoot: string, relativeDirectory: string): string[] {
  const files: string[] = [];
  const visit = (directory: string) => {
    const absolute = targetPath(targetRoot, directory);
    const stat = fs.lstatSync(absolute);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new CatalogError(`Refusing to inventory non-directory source skill path: ${directory}`);
    }
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const relative = path.posix.join(directory, entry.name);
      const child = targetPath(targetRoot, relative);
      if (entry.isSymbolicLink())
        throw new CatalogError(`Refusing to inventory symbolic link in source skill: ${relative}`);
      if (entry.isDirectory()) visit(relative);
      else if (entry.isFile() && fs.lstatSync(child).isFile()) files.push(relative);
      else throw new CatalogError(`Refusing to inventory non-regular source skill file: ${relative}`);
    }
  };
  visit(relativeDirectory);
  return files.sort();
}
function skillProvenance(metadata: unknown, resource: CatalogResource): { matches: boolean; ref: string | null } {
  if (!(metadata instanceof Map)) return { matches: false, ref: null };
  const pinnedRef = metadata.get('github-pinned');
  const ref = typeof pinnedRef === 'string' && pinnedRef ? pinnedRef : metadata.get('github-ref');
  return {
    matches:
      matchesSourceRepository(metadata.get('github-repo'), resource.source_repository!) &&
      metadata.get('github-path') === resource.source_path,
    ref: typeof ref === 'string' && ref ? ref : null,
  };
}

function recordSourceInstallation(resource: CatalogResource, target: string, relativePath: string): void {
  const targetRoot = fs.realpathSync(target);
  const skillFile = targetPath(targetRoot, relativePath);
  let verified = false;
  try {
    if (fs.lstatSync(skillFile).isFile()) {
      const metadata = parseFrontmatter(readUtf8(skillFile, 'Installed source skill'), skillFile).get('metadata');
      const { matches, ref } = skillProvenance(metadata, resource);
      verified = matches && ref?.toLowerCase() === resource.source_ref!.toLowerCase();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (!verified) {
    throw new CatalogError(
      `GitHub CLI reported a successful installation for ${resource.id}, but no provenance-matched skill at the requested commit was found at ${relativePath}.`,
    );
  }

  const state: InstallState = readInstallState(targetRoot);
  const previous = sourceSkillRecord(state, sourceCatalogName(resource), resource.id);
  const files = previous && sameSourceRecord(previous, resource) ? { ...previous.files } : {};
  const skillDirectory = path.posix.dirname(relativePath);
  const destinationPrefix = `${skillDirectory}/`;
  for (const filePath of Object.keys(files)) if (filePath.startsWith(destinationPrefix)) delete files[filePath];
  for (const filePath of installedSkillFiles(targetRoot, skillDirectory)) {
    const fingerprint = installedFingerprint(targetRoot, filePath);
    if (!fingerprint) throw new CatalogError(`Installed source file disappeared: ${filePath}`);
    files[filePath] = fingerprint;
  }
  state.sources ||= {};
  state.sources[sourceCatalogName(resource)] ||= {};
  state.sources[sourceCatalogName(resource)].skills ||= {};
  state.sources[sourceCatalogName(resource)].skills[resource.id] = {
    source_repository: resource.source_repository!,
    source_path: resource.source_path!,
    source_ref: resource.source_ref!,
    files,
  };
  const plan = new Map<string, InstallPlanEntry>();
  addInventoryStateToPlan(plan, state);
  writeInstallPlan(plan, targetRoot, { force: true });
}

function sourceResourcesFromInventory(state: InstallState): CatalogResource[] {
  return [...sourceResourceRecords(state)].map(([key, record]) => {
    const [catalog, kind, id] = key.split(':');
    return {
      id,
      kind: kind as CatalogResource['kind'],
      catalog,
      source_repository: record.source_repository,
      source_path: record.source_path,
      source_ref: record.source_ref || null,
      description: `Tracked source ${kind} installation.`,
      license_status: record.license_status || 'not-declared',
      ...(record.apply_to ? { apply_to: record.apply_to, applyTo: record.apply_to } : {}),
    };
  });
}

export interface TrackedResourceRequest {
  catalog?: string;
  kind?: string;
  id?: string;
  registeredCatalogs: string[];
  includeRemovedCatalogs?: boolean;
}
function prepareTrackedResources(
  target: string,
  { catalog, kind, id, registeredCatalogs, includeRemovedCatalogs = false }: TrackedResourceRequest,
) {
  const state = readInstallState(fs.realpathSync(target));
  const records = sourceResourceRecords(state);
  const installedCatalogs = inventorySourceNames(state);
  const names = catalog
    ? [catalog]
    : installedCatalogs.filter(
        (name) =>
          (includeRemovedCatalogs || registeredCatalogs.includes(name)) &&
          [...records.keys()].some(
            (key) =>
              key.startsWith(`${name}:`) && (!id || key.split(':')[2] === id) && (!kind || key.split(':')[1] === kind),
          ),
      );
  return {
    names,
    installedCatalogs,
    resources: sourceResourcesFromInventory(state).filter(
      (resource) =>
        names.includes(resource.catalog!) && (!id || resource.id === id) && (!kind || resource.kind === kind),
    ),
  };
}

export {
  readInstallState,
  sourceResourcesFromInventory,
  prepareTrackedResources,
  sourceCatalogName,
  sourceSkillKey,
  sourceResourceKey,
  sourceResourceRecords,
  sourceResourceRecord,
  sourceSkillRecords,
  sourceSkillRecord,
  inventorySourceNames,
  removeSourceResourceRecord,
  removeSourceSkillRecord,
  readInstalledSourceSkills,
  readInstalledSourceResources,
  setSourceResourceRecord,
  recordSourceInstallation,
};
