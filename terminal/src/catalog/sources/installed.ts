"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  CatalogError, SOURCE_SKILL_DIRECTORIES, parseFrontmatter, readUtf8,
} = require("../resources/index.js");
const {
  targetPath, readInstallState, installedFingerprint, sameFingerprint, writeInstallPlan,
  addInventoryStateToPlan,
} = require("../inventory/index.js");
import type { CatalogResource } from "../entries.js";
import type { InstallState, SourceResourceInventoryRecord } from "../inventory/files.js";
import type { InstallPlanEntry } from "../plan.js";

export interface SourceResourceInstallation {
  agent: string;
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
  tracked?: boolean;
}

function sourceCatalogName(resource: CatalogResource): string {
  return resource.catalog || "source";
}

function sourceResourceKey(resource: CatalogResource): string {
  return `${resource.catalog || "source"}:${resource.kind}:${resource.id}`;
}

function sourceSkillKey(resource: CatalogResource): string {
  return `${resource.catalog || "source"}:${resource.id}`;
}

function sourceResourceRecords(state: InstallState): Map<string, SourceResourceInventoryRecord> {
  const records = new Map<string, SourceResourceInventoryRecord>();
  for (const [catalog, collections] of Object.entries(state.sources || {})) {
    for (const kind of ["skill", "agent", "instruction"]) {
      const collection = collections[`${kind}s`] || {};
      for (const [id, record] of Object.entries(collection)) {
        records.set(`${catalog}:${kind}:${id}`, record);
      }
    }
  }
  return records;
}

function sourceSkillRecords(state: InstallState): Map<string, SourceResourceInventoryRecord> {
  return new Map([...sourceResourceRecords(state)].filter(([key]) => key.split(":")[1] === "skill")
    .map(([key, record]) => {
      const [, , id] = key.split(":");
      return [`${key.split(":")[0]}:${id}`, record];
    }));
}

function sourceResourceRecord(state: InstallState, catalog: string, kind: string, id: string): SourceResourceInventoryRecord | undefined {
  return sourceResourceRecords(state).get(`${catalog}:${kind}:${id}`);
}

function sourceSkillRecord(state: InstallState, catalog: string, id: string): SourceResourceInventoryRecord | undefined {
  return sourceResourceRecord(state, catalog, "skill", id);
}

function inventorySourceNames(state: InstallState): string[] {
  return [...new Set([...sourceResourceRecords(state).keys()].map((key) => key.split(":")[0]))];
}

function sameSourceRecord(record: SourceResourceInventoryRecord, resource: CatalogResource): boolean {
  return record.source_repository === resource.source_repository &&
    record.source_path === resource.source_path;
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
  if (typeof value !== "string") return false;
  if (value === repository) {
    return true;
  }
  try {
    const url = new URL(value);
    const pathname = url.pathname.replace(/\/+$/, "").replace(/\.git$/i, "");
    return url.hostname.toLowerCase() === "github.com" &&
      pathname.toLowerCase() === `/${repository}`.toLowerCase();
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
  const candidates = new Map<string, CatalogResource>(sourceResources
    .filter((resource) => (!catalog || sourceCatalogName(resource) === catalog) && (!kind || resource.kind === kind))
    .map((resource) => [sourceResourceKey(resource), resource] as [string, CatalogResource]));
  for (const [key, record] of records) {
    if (catalog && key.split(":")[0] !== catalog) continue;
    const [, resourceKind, id] = key.split(":");
    if (kind && resourceKind !== kind) continue;
    const current = candidates.get(key);
    if (!current || current.source_repository !== record.source_repository || current.source_path !== record.source_path) {
      const catalogName = key.split(":")[0];
      candidates.set(key, { id, kind: resourceKind as CatalogResource["kind"], catalog: catalogName, ...record, source_ref: null, removed: true });
    }
  }
  const installed: InstalledSourceResource[] = [];
  for (const [key, resource] of candidates) {
    const record = records.get(key);
    if (!record || resource.kind === "skill") continue;
    const installations: SourceResourceInstallation[] = [];
    for (const [relativePath, expected] of Object.entries(record.files || {})) {
      let current;
      try {
        current = installedFingerprint(targetRoot, relativePath);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      installations.push({
        agent: relativePath.includes(".claude/") ? "claude" : "copilot",
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

function recordSourceResourceInstallation(resource, target, files) {
  const targetRoot = fs.realpathSync(target);
  const state = readInstallState(targetRoot);
  const collectionName = `${resource.kind}s`;
  const previous = sourceResourceRecord(state, sourceCatalogName(resource), resource.kind, resource.id);
  const same = previous && sameSourceRecord(previous, resource);
  const trackedFiles = same ? { ...previous.files } : {};
  for (const relativePath of files) trackedFiles[relativePath] = installedFingerprint(targetRoot, relativePath);
  state.sources ||= {};
  state.sources[sourceCatalogName(resource)] ||= {};
  state.sources[sourceCatalogName(resource)][collectionName] ||= {};
  state.sources[sourceCatalogName(resource)][collectionName][resource.id] = {
    source_repository: resource.source_repository,
    source_path: resource.source_path,
    source_ref: resource.source_ref,
    ...(resource.apply_to ? { apply_to: resource.apply_to } : {}),
    license_status: resource.license_status,
    files: trackedFiles,
  };
  const plan = new Map<string, InstallPlanEntry>();
  addInventoryStateToPlan(plan, state);
  writeInstallPlan(plan, targetRoot, { force: true });
}
function readInstalledSourceSkills(
  target: string,
  sourceResources: CatalogResource[],
  { catalog }: { catalog?: string } = {},
): InstalledSourceResource[] {
  const targetRoot = fs.realpathSync(target);
  const state: InstallState = readInstallState(targetRoot);
  const records = Object.fromEntries([...sourceSkillRecords(state)]
    .filter(([key]) => !catalog || key.startsWith(`${catalog}:`)));
  const candidates = new Map<string, CatalogResource>(sourceResources
    .filter((resource) => !catalog || sourceCatalogName(resource) === catalog)
    .map((resource) => [
    sourceSkillKey(resource), resource,
    ]));
  for (const [key, record] of Object.entries(records)) {
    const current = candidates.get(key);
    if (!current || current.source_repository !== record.source_repository ||
        current.source_path !== record.source_path) {
      const [catalog, id] = key.split(":");
      candidates.set(key, {
        id, kind: "skill", catalog, ...record, source_ref: null, removed: true,
      });
    }
  }
  const installed: InstalledSourceResource[] = [];
  for (const [key, resource] of candidates) {
    const record = records[key];
    const installations: SourceResourceInstallation[] = [];
    for (const [agent, directory] of Object.entries(SOURCE_SKILL_DIRECTORIES)) {
      const relativePath = `${directory}/${resource.id}/SKILL.md`;
      const skillFile = targetPath(targetRoot, relativePath);
      const expected = record?.files[relativePath];
      const directoryPrefix = `${directory}/${resource.id}/`;
      const trackedFiles = Object.entries(record?.files || {}).filter(([filePath]) =>
        filePath.startsWith(directoryPrefix));
      let stat;
      try {
        stat = fs.lstatSync(skillFile);
      } catch (error) {
        if (error.code === "ENOENT") {
          if (trackedFiles.length) {
            installations.push({
              agent, path: relativePath, ref: null,
              missing: true, modified: false, provenanceMatches: false,
            });
          }
          continue;
        }
        throw error;
      }
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new CatalogError(`Installed source skill is not a regular file: ${relativePath}`);
      }
      let metadata;
      try {
        metadata = parseFrontmatter(readUtf8(skillFile, "Installed source skill"), skillFile).get("metadata");
      } catch (error) {
        if (!expected || !(error instanceof CatalogError)) throw error;
      }
      const provenanceMatches = metadata instanceof Map &&
        matchesSourceRepository(metadata.get("github-repo"), resource.source_repository) &&
        metadata.get("github-path") === resource.source_path;
      if (!(metadata instanceof Map)) metadata = undefined;
      if (!provenanceMatches && !trackedFiles.length) continue;
      const pinnedRef = metadata?.get("github-pinned");
      const ref = typeof pinnedRef === "string" && pinnedRef
        ? pinnedRef
        : metadata?.get("github-ref");
      let missing = false;
      let modified = Boolean(expected && !provenanceMatches);
      for (const [trackedPath, expectedFingerprint] of trackedFiles) {
        let current;
        try { current = installedFingerprint(targetRoot, trackedPath); }
        catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        if (!current) missing = true;
        else if (!sameFingerprint(current, expectedFingerprint)) modified = true;
      }
      installations.push({
        agent,
        path: relativePath,
        ref: typeof ref === "string" && ref ? ref : null,
        missing,
        modified,
        provenanceMatches,
      });
    }
    if (installations.length) {
      installed.push({ resource, installations, removed: Boolean(resource.removed), tracked: Boolean(record) });
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
      if (entry.isSymbolicLink()) throw new CatalogError(`Refusing to inventory symbolic link in source skill: ${relative}`);
      if (entry.isDirectory()) visit(relative);
      else if (entry.isFile() && fs.lstatSync(child).isFile()) files.push(relative);
      else throw new CatalogError(`Refusing to inventory non-regular source skill file: ${relative}`);
    }
  };
  visit(relativeDirectory);
  return files.sort();
}
function recordSourceInstallation(resource: CatalogResource, target: string, agent: string): void {
  const targetRoot = fs.realpathSync(target);
  const installed = readInstalledSourceSkills(targetRoot, [resource])
    .find(({ resource: installedResource }) => sourceSkillKey(installedResource) === sourceSkillKey(resource));
  const installation = installed?.installations.find((entry) => entry.agent === agent);
  if (!installation || installation.missing || !installation.provenanceMatches ||
      installation.ref?.toLowerCase() !== resource.source_ref.toLowerCase()) {
    throw new CatalogError(
      `GitHub CLI reported a successful ${agent} installation for ${resource.id}, but no provenance-matched SKILL.md at the requested commit was found.`,
    );
  }

  const state: InstallState = readInstallState(targetRoot);
  const previous = sourceSkillRecord(state, sourceCatalogName(resource), resource.id);
  const files = previous && sameSourceRecord(previous, resource)
    ? { ...previous.files }
    : {};
  const skillDirectory = path.posix.dirname(installation.path);
  const runtimePrefix = `${skillDirectory}/`;
  for (const filePath of Object.keys(files)) if (filePath.startsWith(runtimePrefix)) delete files[filePath];
  for (const filePath of installedSkillFiles(targetRoot, skillDirectory)) {
    files[filePath] = installedFingerprint(targetRoot, filePath);
  }
  state.sources ||= {};
  state.sources[sourceCatalogName(resource)] ||= {};
  state.sources[sourceCatalogName(resource)].skills ||= {};
  state.sources[sourceCatalogName(resource)].skills[resource.id] = {
    source_repository: resource.source_repository,
    source_path: resource.source_path,
    source_ref: resource.source_ref,
    files,
  };
  const plan = new Map<string, InstallPlanEntry>();
  addInventoryStateToPlan(plan, state);
  writeInstallPlan(plan, targetRoot, { force: true });
}

module.exports = {
  sourceCatalogName, sourceSkillKey, sourceResourceKey, sourceResourceRecords, sourceResourceRecord,
  sourceSkillRecords, sourceSkillRecord, inventorySourceNames,
  removeSourceResourceRecord, removeSourceSkillRecord, readInstalledSourceSkills,
  readInstalledSourceResources, recordSourceResourceInstallation, recordSourceInstallation,
};
