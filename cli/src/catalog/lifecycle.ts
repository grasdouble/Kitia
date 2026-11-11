"use strict";

const fs = require("node:fs");
const { latestSourceVersionAtRef } = require("./sources/history.js");
const { CatalogError } = require("./resources/index.js");
const { readInstallState, trackedPaths, findUnmanagedArtifacts } = require("./inventory/index.js");
const { readInstalledSourceSkills, readInstalledSourceResources } = require("./sources/installed.js");
import type { execFileSync as ExecFileSync } from "node:child_process";
import type { CatalogResource } from "./entries.js";
export interface ScanError {
  scope: string;
  code: string;
  message: string;
}
function checkInstalledResources(
  target: string,
  sourceResources: CatalogResource[],
  { catalog, scope, includeUnmanaged = false, run, revisionCache }: {
    catalog?: string; scope?: string; includeUnmanaged?: boolean; run?: typeof ExecFileSync;
    revisionCache?: Map<string, string | null>;
  } = {},
) {
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new CatalogError(`Target must be an existing directory: ${target}`);
  }
  const targetRoot = fs.realpathSync(target);
  const state = readInstallState(targetRoot);
  const installedSourceResources = [
    ...readInstalledSourceSkills(targetRoot, sourceResources, { catalog }),
    ...readInstalledSourceResources(targetRoot, sourceResources, { catalog }),
  ];
  const results = new Map<string, CatalogResource>();
  const messages: string[] = [];
  let updateAvailable = false;
  const resultFor = (resource: CatalogResource) => {
    const sourceName = resource.catalog || "source";
    const key = `${sourceName}:${resource.kind}:${resource.id}`;
    if (!results.has(key)) {
      results.set(key, {
        catalog: sourceName,
        kind: resource.kind,
        id: resource.id,
        status: "current",
        issues: [],
        source_repository: resource.source_repository,
        source_path: resource.source_path,
      });
    }
    return results.get(key)!;
  };
  const issue = (result: CatalogResource, code: string, paths: string[] = []) => {
    result.status = "attention";
    result.issues!.push({ code, paths });
    updateAvailable = true;
  };

  const currentSourceRevisions = revisionCache || new Map<string, string | null>();
  for (const { resource, installations, removed, tracked = true } of installedSourceResources) {
    if (!tracked) continue;
    const result = resultFor(resource);
    result.version = [...new Set(installations.map(({ ref }) => ref?.slice(0, 7)).filter(Boolean))]
      .join(", ") || resource.source_ref?.slice(0, 7) || "-";
    for (const [flag, label] of [["missing", "Missing installed files"], ["modified", "Locally modified"]]) {
      const affected = installations.filter((installation) => installation[flag]);
      if (affected.length) {
        issue(result, flag === "missing" ? "MISSING_FILES" : "LOCAL_MODIFICATIONS", affected.map((entry) => entry.path));
        messages.push(`${label}: ${resource.catalog || "source"} ${resource.kind} ${resource.id} (${affected.map((entry) => entry.path).join(", ")})`);
      }
    }
    if (removed) {
      issue(result, "REMOVED_FROM_CATALOG");
      messages.push(`Removed from catalog: ${resource.catalog || "source"} ${resource.kind} ${resource.id}. Use uninstall to remove it explicitly.`);
      continue;
    }
    const stale = installations.filter((installation) => {
      if (installation.missing || installation.ref?.toLowerCase() === resource.source_ref?.toLowerCase()) return false;
      if (!/^[a-f0-9]{40}$/i.test(installation.ref || "") ||
          !/^[a-f0-9]{40}$/i.test(resource.source_ref || "")) return true;
      const revisionKey = (ref: string) => `${resource.source_repository}:${resource.source_path}:${ref}`;
      const installedKey = revisionKey(installation.ref!);
      const catalogKey = revisionKey(resource.source_ref!);
      if (!currentSourceRevisions.has(installedKey)) {
        currentSourceRevisions.set(installedKey, latestSourceVersionAtRef(resource, installation.ref!, run));
      }
      if (!currentSourceRevisions.has(catalogKey)) {
        currentSourceRevisions.set(catalogKey, latestSourceVersionAtRef(resource, resource.source_ref!, run));
      }
      const installedRevision = currentSourceRevisions.get(installedKey);
      const catalogRevision = currentSourceRevisions.get(catalogKey);
      return !installedRevision || !catalogRevision ||
        installedRevision.toLowerCase() !== catalogRevision.toLowerCase();
    });
    if (stale.length) {
      issue(result, "UPDATE_AVAILABLE", stale.map((entry) => entry.path));
      const installedRefs = [...new Set(stale.map(({ ref }) => ref?.slice(0, 7) || "unknown"))];
      messages.push(
        `Update available: ${resource.catalog || "source"} ${resource.kind} ${resource.id} (installed at ${installedRefs.join(", ")}, catalog ${resource.source_ref?.slice(0, 7) || "unknown"})`,
      );
    }
  }
  if (!updateAvailable && installedSourceResources.some(({ tracked }) => tracked)) {
    messages.push("All installed source catalog resources match their pinned commits.");
  }
  if (includeUnmanaged) {
    for (const artifact of findUnmanagedArtifacts(targetRoot, trackedPaths(state))) {
      const key = `${artifact.kind}:${artifact.id}`;
      if (!results.has(key)) {
        results.set(key, {
          catalog: "-",
          ...artifact,
          status: "unmanaged",
          managed: false,
          issues: [],
        });
      }
    }
  }
  return { resources: [...results.values()], messages, updateAvailable };
}

function collectInstalledScopes(
  targets: Record<string, string>,
  sourceResources: CatalogResource[],
  { run }: { run?: typeof ExecFileSync } = {},
): { resources: Array<CatalogResource & { scope: string }>; errors: ScanError[] } {
  const result: { resources: Array<CatalogResource & { scope: string }>; errors: ScanError[] } = {
    resources: [],
    errors: [],
  };
  const revisionCache = new Map<string, string | null>();
  for (const [scope, target] of Object.entries(targets)) {
    try {
      const checked = checkInstalledResources(target, sourceResources, { scope, includeUnmanaged: true, run, revisionCache });
      result.resources.push(...checked.resources.map((resource) => ({ ...resource, scope })));
    } catch (error) {
      if (!(error instanceof CatalogError)) throw error;
      result.errors.push({ scope, code: error.code || "CATALOG_ERROR", message: error.message });
    }
  }
  return result;
}

module.exports = { checkInstalledResources, collectInstalledScopes };