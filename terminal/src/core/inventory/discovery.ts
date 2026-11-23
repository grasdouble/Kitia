import fs from 'node:fs';
import path from 'node:path';

import { targetPath } from '../installations/files.js';
import { readUtf8 } from '../resources/content.js';
import { parseFrontmatter } from '../resources/frontmatter.js';
import type { ResourceKind } from '../resources/model.js';
import { CatalogError } from '../resources/model.js';
const INSTALL_SCAN_DIRECTORIES = {
  claude: ['.claude/skills', '.claude/agents', '.claude/rules'],
  copilot: ['.agents/skills', '.agents/agents', '.agents/instructions', '.github/agents', '.github/instructions'],
};

const USER_INSTALL_SCAN_DIRECTORIES = {
  claude: ['.claude/skills', '.claude/agents'],
  copilot: ['.agents/skills', '.copilot/agents'],
};

function collectMarkdownFiles(
  targetRoot: string,
  relativeDirectory: string,
  output: string[],
  mode: 'markdown' | 'skills' | 'skill' = 'markdown',
): void {
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
    if (mode === 'skills' && entry.isSymbolicLink()) continue;
    if (mode === 'skills' && !entry.isDirectory()) continue;
    if (mode === 'skill' && entry.name !== 'SKILL.md') continue;
    if (entry.isSymbolicLink()) {
      const childPath = path.join(targetRoot, ...path.posix.join(relativeDirectory, entry.name).split('/'));
      throw new CatalogError(`Refusing to inspect symbolic link: ${childPath}`);
    }
    const childRelative = path.posix.join(relativeDirectory, entry.name);
    targetPath(targetRoot, childRelative);
    if (entry.isDirectory() && mode !== 'skill') {
      collectMarkdownFiles(targetRoot, childRelative, output, mode === 'skills' ? 'skill' : 'markdown');
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
  const roots: Array<[ResourceKind, string[], RegExp]> = [
    ['skill', ['.agents/skills/', '.claude/skills/'], /\/SKILL\.md$/i],
    ['agent', ['.agents/agents/', '.claude/agents/', '.github/agents/', '.copilot/agents/'], /(?:\.agent)?\.md$/i],
    ['instruction', ['.agents/instructions/', '.claude/rules/', '.github/instructions/'], /(?:\.instructions)?\.md$/i],
  ];
  for (const [kind, prefixes, suffix] of roots) {
    const prefix = prefixes.find((candidate) => relativePath.startsWith(candidate));
    if (!prefix) continue;
    const id = relativePath.slice(prefix.length).replace(suffix, '');
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
  const scanDirectories = [...Object.values(INSTALL_SCAN_DIRECTORIES), ...Object.values(USER_INSTALL_SCAN_DIRECTORIES)];
  const directories = [
    ...new Set(
      scanDirectories.flatMap((entries) =>
        Array.isArray(entries) ? entries.filter((entry): entry is string => typeof entry === 'string') : [],
      ),
    ),
  ];
  const files: string[] = [];
  for (const directory of directories) {
    if (directory.endsWith('/skills')) {
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
