import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { parseFrontmatter, parseInstruction } from '../resources/frontmatter.js';
import { spdxExpression } from '../resources/license.js';
import { validateSourceCatalog } from '../resources/manifest.js';
import type { CatalogResource, ResourceKind } from '../resources/model.js';
import { CatalogError } from '../resources/model.js';
import type { SourceConfiguration } from './model.js';
import { repositoryId } from './model.js';

interface DiscoveredResource {
  id: string | undefined;
  kind: ResourceKind;
  sourcePath: string;
  file: string;
  directory: string;
}

export interface SourceCatalogIndex {
  catalog_version: 1;
  catalog_name: string;
  source_repository: string;
  source_ref: string;
  resources: CatalogResource[];
}

function sourceMetadata(file: string): Map<string, unknown> {
  try {
    return parseFrontmatter(fs.readFileSync(file, 'utf8'), file);
  } catch (error) {
    const text = fs.readFileSync(file, 'utf8');
    const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!frontmatter) throw error;
    const metadata = new Map<string, unknown>();
    for (const key of ['name', 'description', 'license']) {
      const match = frontmatter[1].match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
      if (match) metadata.set(key, match[1].trim().replace(/^(['"])(.*)\1$/, '$2'));
    }
    if (!metadata.has('name') || !metadata.has('description')) throw error;
    return metadata;
  }
}

function normalizeResourceId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function safeRepositoryPath(checkout: string, sourcePath: string): string {
  if (
    typeof sourcePath !== 'string' ||
    !sourcePath ||
    sourcePath.startsWith('/') ||
    sourcePath.includes('\\') ||
    sourcePath.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new CatalogError(`Unsafe source resource path: ${sourcePath}`);
  }
  const root = fs.realpathSync(checkout);
  const file = path.resolve(root, ...sourcePath.split('/'));
  if (!file.startsWith(`${root}${path.sep}`))
    throw new CatalogError(`Source resource escapes repository: ${sourcePath}`);
  let current = root;
  for (const part of sourcePath.split('/')) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) throw new CatalogError(`Source resource does not exist: ${sourcePath}`);
    if (fs.lstatSync(current).isSymbolicLink())
      throw new CatalogError(`Symbolic links are not allowed in source resources: ${sourcePath}`);
  }
  return file;
}

function discoverBasicMarkdownResources(
  checkout: string,
  kind: ResourceKind,
  roots: string[],
  suffix: RegExp,
): DiscoveredResource[] {
  const resources: DiscoveredResource[] = [];
  for (const sourceRoot of roots) {
    const rootPath = path.join(checkout, ...sourceRoot.split('/'));
    if (!fs.existsSync(rootPath)) continue;
    const root = safeRepositoryPath(checkout, sourceRoot);
    if (!fs.statSync(root).isDirectory()) throw new CatalogError(`${sourceRoot} must be a directory`);
    function visit(directory: string, segments: string[]): void {
      for (const entry of fs
        .readdirSync(directory, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isSymbolicLink()) {
          throw new CatalogError(`Symbolic links are not allowed in source resources: ${entry.name}`);
        }
        if (entry.isDirectory()) {
          visit(path.join(directory, entry.name), [...segments, entry.name]);
        } else if (entry.isFile() && /\.md$/i.test(entry.name) && !/^readme\.md$/i.test(entry.name)) {
          const id = entry.name.replace(suffix, '').replace(/\.md$/i, '');
          const sourcePath = path.posix.join(sourceRoot, ...segments, entry.name);
          resources.push({
            id,
            kind,
            sourcePath,
            file: path.join(directory, entry.name),
            directory,
          });
        }
      }
    }
    visit(root, []);
  }
  return resources;
}

function discoverCustomSkills(checkout: string, sourceRoot: string): DiscoveredResource[] {
  const root = safeRepositoryPath(checkout, sourceRoot);
  const resources: DiscoveredResource[] = [];
  function visit(directory: string, segments: string[]): void {
    const skillFile = path.join(directory, 'SKILL.md');
    if (fs.existsSync(skillFile)) {
      const sourcePath = path.posix.join(sourceRoot, ...segments);
      safeRepositoryPath(checkout, path.posix.join(sourcePath, 'SKILL.md'));
      resources.push({
        id: segments.at(-1) || path.posix.basename(sourceRoot),
        kind: 'skill',
        sourcePath,
        file: skillFile,
        directory,
      });
      return;
    }
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) {
        throw new CatalogError(`Symbolic links are not allowed in source resources: ${entry.name}`);
      }
      if (entry.isDirectory()) visit(path.join(directory, entry.name), [...segments, entry.name]);
    }
  }
  visit(root, []);
  return resources;
}

const BASIC_AGENT_DIRECTORIES = ['agents', '.agents/agents', '.claude/agents', '.github/agents', '.copilot/agents'];

const BASIC_INSTRUCTION_DIRECTORIES = ['instructions', '.agents/instructions', '.claude/rules', '.github/instructions'];

function createSourceIndex(
  repository: string,
  name: string,
  checkout: string,
  configuration: Pick<SourceConfiguration, 'mode' | 'entries'> = { mode: 'basic', entries: [] },
): SourceCatalogIndex {
  const sourceRepository = repositoryId(repository);
  const sourceRef = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    timeout: 30000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const mappings = configuration.mode === 'custom' ? configuration.entries : null;
  const resourceDirectories: DiscoveredResource[] = [];
  if (mappings) {
    for (const mapping of mappings) {
      let sourcePath = mapping.path;
      if (mapping.kind === 'skill' && sourcePath.endsWith('/SKILL.md')) sourcePath = sourcePath.slice(0, -9);
      const target = safeRepositoryPath(checkout, sourcePath);
      const stat = fs.lstatSync(target);
      if (stat.isDirectory()) {
        let discovered: DiscoveredResource[];
        if (mapping.kind === 'skill') {
          const skillFile = path.join(target, 'SKILL.md');
          if (fs.existsSync(skillFile)) {
            safeRepositoryPath(checkout, path.posix.join(sourcePath, 'SKILL.md'));
            discovered = [
              {
                id: mapping.id || path.posix.basename(sourcePath),
                kind: 'skill',
                sourcePath,
                file: skillFile,
                directory: target,
              },
            ];
          } else {
            discovered = discoverCustomSkills(checkout, sourcePath);
          }
        } else {
          discovered = discoverBasicMarkdownResources(
            checkout,
            mapping.kind,
            [sourcePath],
            mapping.kind === 'agent' ? /\.agent\.md$/i : /\.instructions\.md$/i,
          );
        }
        if (!discovered.length) {
          throw new CatalogError(`No ${mapping.kind} resources found in source directory: ${sourcePath}`);
        }
        resourceDirectories.push(...discovered);
      } else if (stat.isFile() && mapping.kind !== 'skill' && /\.md$/i.test(sourcePath)) {
        const filename = path.posix.basename(sourcePath);
        const suffix = mapping.kind === 'agent' ? /\.agent\.md$/i : /\.instructions\.md$/i;
        resourceDirectories.push({
          id: mapping.id || filename.replace(suffix, '').replace(/\.md$/i, ''),
          kind: mapping.kind,
          sourcePath,
          file: target,
          directory: path.dirname(target),
        });
      } else {
        throw new CatalogError(`Source resource must be a directory or supported Markdown file: ${sourcePath}`);
      }
    }
  } else {
    const skillsRootPath = path.join(checkout, 'skills');
    if (fs.existsSync(skillsRootPath)) {
      const skillsRoot = safeRepositoryPath(checkout, 'skills');
      if (!fs.statSync(skillsRoot).isDirectory()) throw new CatalogError('skills must be a directory');
      function visit(directory: string, segments: string[]): void {
        const skill = path.join(directory, 'SKILL.md');
        if (fs.existsSync(skill)) {
          safeRepositoryPath(checkout, path.posix.join('skills', ...segments, 'SKILL.md'));
          resourceDirectories.push({
            id: segments.at(-1),
            kind: 'skill',
            sourcePath: path.posix.join('skills', ...segments),
            file: skill,
            directory,
          });
          return;
        }
        for (const entry of fs
          .readdirSync(directory, { withFileTypes: true })
          .sort((a, b) => a.name.localeCompare(b.name))) {
          if (entry.isSymbolicLink())
            throw new CatalogError(`Symbolic links are not allowed in source resources: ${entry.name}`);
          if (entry.isDirectory()) visit(path.join(directory, entry.name), [...segments, entry.name]);
        }
      }
      visit(skillsRoot, []);
    }
    resourceDirectories.push(
      ...discoverBasicMarkdownResources(checkout, 'agent', BASIC_AGENT_DIRECTORIES, /\.agent\.md$/i),
      ...discoverBasicMarkdownResources(checkout, 'instruction', BASIC_INSTRUCTION_DIRECTORIES, /\.instructions\.md$/i),
    );
    if (!resourceDirectories.length) {
      throw new CatalogError(`${sourceRepository} contains no supported skills, agents, or instructions`);
    }
  }
  const resources: CatalogResource[] = [];
  for (const resource of resourceDirectories) {
    const { kind, sourcePath, file } = resource;
    if (typeof resource.id !== 'string') {
      throw new CatalogError(`Invalid resource id in ${name}: ${resource.id}`);
    }
    const id = kind === 'skill' ? resource.id : normalizeResourceId(resource.id);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 64 || id.includes('--')) {
      throw new CatalogError(`Invalid resource id in ${name}: ${id}`);
    }
    const instruction =
      kind === 'instruction' ? parseInstruction(fs.readFileSync(file), `${sourceRepository}:${sourcePath}`) : undefined;
    const metadata = instruction?.values ?? sourceMetadata(file);
    const resourceName = metadata.get('name');
    const descriptionValue = metadata.get('description');
    if (
      kind !== 'instruction' &&
      (typeof resourceName !== 'string' ||
        !resourceName.trim() ||
        (kind === 'skill' &&
          (normalizeResourceId(resourceName) !== id ||
            typeof descriptionValue !== 'string' ||
            !descriptionValue.trim())))
    ) {
      throw new CatalogError(
        `${file} must define a non-empty name${kind === 'skill' ? ' matching its id and a non-empty description' : ''}`,
      );
    }
    const description =
      typeof descriptionValue === 'string' && descriptionValue.trim()
        ? descriptionValue.trim().replace(/\s+/g, ' ')
        : (instruction?.body ?? fs.readFileSync(file, 'utf8').replace(/^---[\s\S]*?---\s*/, ''))
            .trim()
            .split('\n')[0]
            .replace(/^#\s*/, '')
            .trim() || id;
    const rawLicense = metadata.get('license');
    const licenseStatus = typeof rawLicense === 'string' && rawLicense.trim() ? rawLicense : 'not-declared';
    resources.push({
      id,
      kind,
      description,
      source_path: sourcePath,
      ...(instruction ? { apply_to: instruction.applyTo } : {}),
      license_status: licenseStatus,
      license_spdx: spdxExpression(licenseStatus),
    });
  }
  const catalog: SourceCatalogIndex = {
    catalog_version: 1,
    catalog_name: name,
    source_repository: sourceRepository,
    source_ref: sourceRef,
    resources,
  };
  validateSourceCatalog(catalog, { name, repositoryId: sourceRepository });
  return catalog;
}

export { sourceMetadata, createSourceIndex };
