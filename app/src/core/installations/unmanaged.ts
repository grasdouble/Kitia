import fs from 'node:fs';
import path from 'node:path';

import { findUnmanagedArtifacts } from '../inventory/discovery.js';
import type { InstallState } from '../inventory/model.js';
import type { CatalogResource } from '../resources/model.js';
import { availableInstallationDestinations } from './destinations.js';
import { trackedPaths } from './files.js';
// Native-only operations; the caller holds the target's operation lock.
function removeUnmanagedResource(targetRoot: string, state: InstallState, resource: CatalogResource): string[] {
  const scope = resource.scope;
  const messages: string[] = [];
  if (scope !== 'project' && scope !== 'user') {
    throw new Error(`Cannot remove an unmanaged artifact from scope '${scope}'.`);
  }
  const artifacts: CatalogResource[] = findUnmanagedArtifacts(targetRoot, trackedPaths(state));
  const current = artifacts.find((entry) => entry.kind === resource.kind && entry.id === resource.id);
  if (!current || !current.paths?.length) {
    throw new Error(`${resource.kind}:${resource.id} is no longer detected as unmanaged; nothing was removed.`);
  }
  const protectedPaths = trackedPaths(state);
  const assertSafePath = (absolutePath: string, directory: boolean): void => {
    let ancestor = absolutePath;
    while (ancestor !== targetRoot) {
      const stat = fs.lstatSync(ancestor);
      if (stat.isSymbolicLink()) throw new Error(`Refusing to remove a path through a symbolic link: ${ancestor}`);
      ancestor = path.dirname(ancestor);
    }
    const stat = fs.lstatSync(absolutePath);
    if (directory ? !stat.isDirectory() : !stat.isFile()) {
      throw new Error(`Refusing to remove an unexpected artifact path: ${absolutePath}`);
    }
  };
  const targets: Array<{ absolutePath: string; relativePath: string }> = current.paths.map((relativePath) => {
    if (
      relativePath.startsWith('/') ||
      relativePath.includes('\\') ||
      relativePath.split('/').some((segment) => !segment || segment === '.' || segment === '..')
    ) {
      throw new Error(`Refusing to remove an unsafe artifact path: ${relativePath}`);
    }
    const entryPath = path.resolve(targetRoot, ...relativePath.split('/'));
    const relative = path.relative(targetRoot, entryPath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Refusing to remove an unsafe artifact path: ${relativePath}`);
    }
    if (resource.kind !== 'skill') {
      assertSafePath(entryPath, false);
      return { absolutePath: entryPath, relativePath };
    }
    if (!/\/SKILL\.md$/i.test(relativePath)) {
      throw new Error(`Refusing to remove an unexpected skill entry file: ${relativePath}`);
    }
    const skillDirectory = path.posix.dirname(relativePath);
    if (
      !availableInstallationDestinations('skill').some(({ directory }) => skillDirectory.startsWith(`${directory}/`))
    ) {
      throw new Error(`Refusing to remove a skill outside a supported skills directory: ${relativePath}`);
    }
    if (
      [...protectedPaths].some(
        (trackedPath) => trackedPath === skillDirectory || trackedPath.startsWith(`${skillDirectory}/`),
      )
    ) {
      throw new Error(`Refusing to remove ${skillDirectory}; it contains files managed by Kitia.`);
    }
    const directoryPath = path.resolve(targetRoot, ...skillDirectory.split('/'));
    assertSafePath(entryPath, false);
    assertSafePath(directoryPath, true);
    return { absolutePath: directoryPath, relativePath: skillDirectory };
  });
  const uniqueTargets = [
    ...new Map<string, (typeof targets)[number]>(
      targets.map((target): [string, (typeof targets)[number]] => [target.absolutePath, target]),
    ).values(),
  ];
  for (const { absolutePath, relativePath } of uniqueTargets) {
    if (resource.kind === 'skill') fs.rmSync(absolutePath, { recursive: true });
    else fs.unlinkSync(absolutePath);
    messages.push(`Removed unmanaged ${resource.kind}:${resource.id} (${relativePath}).`);
  }
  return messages;
}

export { removeUnmanagedResource };
