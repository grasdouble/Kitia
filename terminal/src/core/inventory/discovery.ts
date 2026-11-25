import fs from 'node:fs';
import path from 'node:path';

import { availableInstallationDestinations } from '../installations/destinations.js';
import { targetPath } from '../installations/files.js';
import { readUtf8 } from '../resources/content.js';
import { parseFrontmatter } from '../resources/frontmatter.js';
import type { ResourceKind } from '../resources/model.js';
import { CatalogError } from '../resources/model.js';
const scanLocations: ReadonlyMap<string, ResourceKind> = new Map([
  ...(['skill', 'agent', 'instruction'] as const).flatMap((kind) =>
    availableInstallationDestinations(kind).map(({ directory }) => [directory, kind] as const),
  ),
  ['.agents/agents', 'agent'],
  ['.agents/instructions', 'instruction'],
]);
const suffixes = { skill: /\/SKILL\.md$/i, agent: /(?:\.agent)?\.md$/i, instruction: /(?:\.instructions)?\.md$/i };

function collectMarkdownFiles(targetRoot: string, relativeDirectory: string, output: string[]): void {
  const directory = targetPath(targetRoot, relativeDirectory, {
    allowFinalDirectorySymlink: true,
  });
  let stat;
  try {
    stat = fs.lstatSync(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
  if (stat.isSymbolicLink()) {
    throw new CatalogError(`Refusing to inspect symbolic link: ${directory}`);
  }
  if (!stat.isDirectory()) {
    return;
  }
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      const childPath = path.join(targetRoot, ...path.posix.join(relativeDirectory, entry.name).split('/'));
      throw new CatalogError(`Refusing to inspect symbolic link: ${childPath}`);
    }
    const childRelative = path.posix.join(relativeDirectory, entry.name);
    targetPath(targetRoot, childRelative);
    if (entry.isDirectory()) {
      collectMarkdownFiles(targetRoot, childRelative, output);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      output.push(childRelative);
    }
  }
}
function collectUnmanagedSkillFiles(targetRoot: string, relativeDirectory: string, output: string[]): void {
  const directory = targetPath(targetRoot, relativeDirectory);
  let stat;
  try {
    stat = fs.lstatSync(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (stat.isSymbolicLink()) {
    throw new CatalogError(`Refusing to inspect symbolic link: ${directory}`);
  }
  if (!stat.isDirectory()) return;

  const skillFile = path.posix.join(relativeDirectory, 'SKILL.md');
  try {
    const skillStat = fs.lstatSync(targetPath(targetRoot, skillFile));
    if (skillStat.isSymbolicLink()) throw new CatalogError(`Refusing to inspect symbolic link: ${skillFile}`);
    if (skillStat.isFile()) {
      output.push(skillFile);
      return;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    collectUnmanagedSkillFiles(targetRoot, path.posix.join(relativeDirectory, entry.name), output);
  }
}

function unmanagedArtifact(relativePath: string): { kind: ResourceKind; id: string } | null {
  for (const [directory, kind] of scanLocations) {
    const prefix = `${directory}/`;
    if (!relativePath.startsWith(prefix)) continue;
    const id = relativePath.slice(prefix.length).replace(suffixes[kind], '');
    return id ? { kind, id } : null;
  }
  return null;
}

function unmanagedArtifactDescription(targetRoot: string, paths: string[]): string {
  for (const relativePath of [...paths].sort()) {
    try {
      const filePath = targetPath(targetRoot, relativePath);
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink() || !stat.isFile()) continue;
      const metadata = parseFrontmatter(readUtf8(filePath, 'Unmanaged artifact'), relativePath);
      const description = metadata.get('description');
      if (typeof description === 'string' && description.trim()) {
        return description.trim().replace(/\s+/g, ' ');
      }
    } catch {
      // Unmanaged files may not have valid frontmatter; keep scanning other locations.
    }
  }
  return paths.sort().join(', ');
}

function findUnmanagedArtifacts(targetRoot: string, excludedPaths: Set<string> = new Set()) {
  const files: string[] = [];
  for (const [directory, kind] of scanLocations) {
    if (kind === 'skill') {
      collectUnmanagedSkillFiles(targetRoot, directory, files);
    } else {
      collectMarkdownFiles(targetRoot, directory, files);
    }
  }
  const artifacts = new Map<string, { kind: ResourceKind; id: string; paths: string[] }>();
  for (const relativePath of files) {
    if (excludedPaths.has(relativePath)) continue;
    const artifact = unmanagedArtifact(relativePath);
    if (!artifact) continue;
    const key = `${artifact.kind}:${artifact.id}`;
    const paths = artifacts.get(key) || { ...artifact, paths: [] };
    paths.paths.push(relativePath);
    artifacts.set(key, paths);
  }
  return [...artifacts.values()].map((artifact) => ({
    ...artifact,
    paths: [...artifact.paths].sort(),
    description: unmanagedArtifactDescription(targetRoot, artifact.paths),
  }));
}

export { findUnmanagedArtifacts };
