import type * as React from 'react';
import type { Dashboard } from '../../../../cli/src/dashboard/dashboard.mts';
import type { CatalogResource } from '../../../../cli/src/catalog/entries';
import type { DashboardActionResult as ActionResult } from '../../../../cli/src/cli/dashboard';
import {
  initialCatalogs, initialInstallations, resources as samples, revisions, sourcePath,
  type DemoResource,
} from './demoData';

type DashboardProps = React.ComponentProps<typeof Dashboard>;
type Actions = NonNullable<DashboardProps['actions']>;
type CatalogRequest = Parameters<NonNullable<Actions['addCatalog']>>[0];
type Catalog = NonNullable<Actions['userCatalogs']>[number];
type CatalogResult = {
  catalogs?: Catalog[];
  resources?: CatalogResource[];
  refreshed?: Array<{ name: string; count: number }>;
  failures?: Array<{ name: string; message: string }>;
  importSummary?: {
    added: string[];
    ignored: Array<{ name: string; reason: string }>;
    refreshed: Array<{ name: string; count: number }>;
    refreshFailures: Array<{ name: string; message: string }>;
  };
};
type Scope = 'project' | 'user';
type Tool = 'copilot' | 'claude' | 'both';
type IndexedResource = { resource: CatalogResource; sample: DemoResource };
type CatalogState = { config: Catalog; revision: number; entries: IndexedResource[] };
type Installation = IndexedResource & { scope: Scope; tool: Tool; ref: string; content: string };

const versions = revisions.map(({ sha, label }, index) => ({
  sha: sha.padEnd(40, '0'), prefix: sha,
  date: `2026-10-${String(24 - index * 7).padStart(2, '0')}`,
  subject: `Demo fixture: ${label}`,
}));
const demoNotice = 'Simulated bundled fixture only; no GitHub, filesystem, or security audit access.';
const key = (resource: CatalogResource) => `${resource.scope}:${resource.kind}:${resource.id}`;
const sameSource = (left: CatalogResource, right: CatalogResource) =>
  left.catalog === right.catalog && left.kind === right.kind && left.id === right.id &&
  left.source_repository === right.source_repository && left.source_path === right.source_path;
const copy = <T,>(value: T): T => structuredClone(value);
const nameKey = (name: string) => name.toLowerCase();

function repositoryId(repository: string): string {
  let url: URL;
  try { url = new URL(repository); } catch { throw new Error('Demo catalogs require an HTTPS GitHub repository URL.'); }
  const id = url.pathname.replace(/\/+$/, '').replace(/\.git$/i, '').slice(1);
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' ||
      url.username || url.password || url.port || url.search || url.hash ||
      !/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(id)) {
    throw new Error('Demo catalogs require an HTTPS GitHub repository URL without a branch, query, or credentials.');
  }
  return id;
}

function parseCatalog(value: unknown): CatalogRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid demo catalog configuration.');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((field) => !['name', 'repository', 'mode', 'entries'].includes(field)) ||
      typeof record.name !== 'string' || !record.name || record.name !== record.name.trim() ||
      /[\/\\:\u0000-\u001f\u007f-\u009f]/u.test(record.name) || typeof record.repository !== 'string') {
    throw new Error('Catalogs require a valid name and HTTPS GitHub repository; unsupported fields are not accepted.');
  }
  repositoryId(record.repository);
  const mode = record.mode ?? 'basic';
  if (mode !== 'basic' && mode !== 'custom') throw new Error('Catalog mode must be basic or custom.');
  if (record.entries !== undefined && !Array.isArray(record.entries)) throw new Error('Catalog entries must be an array.');
  if (mode === 'custom' && !Array.isArray(record.entries)) throw new Error('Custom catalogs require explicit entries.');
  const entries: CatalogRequest['entries'] = [];
  for (const raw of (record.entries ?? []) as unknown[]) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid custom catalog entry.');
    const entry = raw as Record<string, unknown>;
    if (Object.keys(entry).some((field) => !['kind', 'id', 'path'].includes(field)) ||
        !['skill', 'agent', 'instruction'].includes(String(entry.kind)) || typeof entry.path !== 'string') {
      throw new Error('Custom entries require a supported kind and safe repository-relative path.');
    }
    const path = entry.path.replace(/\/+$/, '');
    if (!path || path.startsWith('/') || path.includes('\\') || /[\u0000-\u001f\u007f]/u.test(path) ||
        path.split('/').some((part) => !part || part === '.' || part === '..') ||
        (entry.id !== undefined && (typeof entry.id !== 'string' || entry.id.length > 64 ||
          !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id)))) {
      throw new Error('Custom entries require safe paths and optional kebab-case identifiers.');
    }
    if (entries.some((existing) => existing.kind === entry.kind &&
        (existing.path === path || (entry.id !== undefined && existing.id === entry.id)))) {
      throw new Error('Duplicate custom catalog mapping.');
    }
    entries.push({ kind: entry.kind as DemoResource['kind'], path, ...(entry.id ? { id: entry.id as string } : {}) });
  }
  if (mode === 'basic' && entries.length) throw new Error('Basic catalogs cannot define custom entries.');
  return { name: record.name, repository: record.repository, mode, entries };
}

function indexCatalog(config: CatalogRequest, revision = 0): CatalogState {
  const repository = repositoryId(config.repository);
  // Unknown repositories intentionally expose the same clearly labeled sample library.
  const fixtures = samples.filter((sample) =>
    !initialCatalogs.some((catalog) => catalog.repository === repository) || `demo/${sample.catalog}` === repository);
  const selected: IndexedResource[] = [];
  const add = (sample: DemoResource, id = sample.id) => {
    if (selected.some(({ resource }) => resource.kind === sample.kind && resource.id === id)) {
      throw new Error(`Demo mapping produces duplicate ${sample.kind}:${id}.`);
    }
    selected.push({ sample, resource: {
      id, kind: sample.kind, catalog: config.name,
      description: `[Simulated bundled fixture; no GitHub fetch] ${sample.description}`,
      source_repository: repository,
      source_path: sample.kind === 'skill' ? sourcePath(sample).replace(/\/SKILL\.md$/, '') : sourcePath(sample),
      source_ref: versions[revision].sha,
      license_status: 'declared', license_spdx: sample.license,
      limitations: [demoNotice],
      ...(sample.kind === 'instruction' ? { apply_to: [sample.id === 'typescript' ? '**/*.ts,**/*.tsx' : '**/*.md'] } : {}),
    } });
  };
  if (config.mode === 'basic') fixtures.forEach((sample) => add(sample));
  else for (const mapping of config.entries) {
    const matches = fixtures.filter((sample) => {
      const path = sourcePath(sample);
      return sample.kind === mapping.kind && (path === mapping.path || path.startsWith(`${mapping.path}/`));
    });
    if (!matches.length || (mapping.id && matches.length !== 1)) {
      throw new Error(`Demo only: ${mapping.path} cannot be mapped. Use bundled paths such as skills/code-review, agents/reviewer.md, or instructions/typescript.md; no repository was fetched.`);
    }
    matches.forEach((sample) => add(sample, mapping.id));
  }
  return { config: copy(config), revision, entries: selected };
}

function installedPaths(resource: CatalogResource, tool: Tool, scope: Scope): string[] {
  return (tool === 'both' ? ['copilot', 'claude'] : [tool]).map((client) => {
    if (resource.kind === 'skill') return `${client === 'claude' ? '.claude' : '.agents'}/skills/${resource.id}/SKILL.md`;
    if (resource.kind === 'agent') return client === 'claude'
      ? `.claude/agents/${resource.id}.md`
      : `${scope === 'user' ? '.copilot' : '.github'}/agents/${resource.id}.agent.md`;
    return client === 'claude' ? `.claude/rules/${resource.id}.md` : `.github/instructions/${resource.id}.instructions.md`;
  });
}

function contentAt(sample: DemoResource, ref: string): string {
  return sample.content + (ref === versions[0].sha ? '' : `\n<!-- Simulated historical demo fixture: ${ref} -->\n`);
}

/** A reset creates a completely independent, browser-only installation and catalog store. */
export function createTuiDemoSession(): { resources: DashboardProps['resources']; actions: Actions } {
  let catalogs = initialCatalogs.map((catalog) => indexCatalog({
    name: catalog.name, repository: `https://github.com/${catalog.repository}`, mode: 'basic', entries: [],
  }, catalog.name === 'team' ? 1 : 0));
  const installations = new Map<string, Installation>();
  const candidates = () => catalogs.flatMap((catalog) => catalog.entries);
  const findSource = (resource: CatalogResource) => candidates().find((entry) => sameSource(entry.resource, resource));
  const catalogSnapshot = () => copy(catalogs.map(({ config }) => config));
  const sourceSnapshot = () => copy(candidates().map(({ resource }) => resource));
  const inventory = (): CatalogResource[] => [...installations.values()].map((installation) => {
    const resource = installation.resource;
    const source = findSource(resource);
    const removed = resource.managed !== false && !source;
    const outdated = resource.managed !== false && source && source.resource.source_ref !== installation.ref;
    return copy({ ...resource, scope: installation.scope, source_ref: resource.managed === false ? undefined : installation.ref,
      version: resource.managed === false ? '-' : installation.ref.slice(0, 7), removed,
      status: resource.managed === false ? 'unmanaged' : removed || outdated ? 'attention' : 'current',
      issues: removed ? [{ code: 'REMOVED_FROM_CATALOG' }] : outdated ? [{ code: 'UPDATE_AVAILABLE' }] : [],
    });
  }).sort((left, right) => key(left).localeCompare(key(right)));
  for (const initial of initialInstallations()) {
    const entry = candidates().find(({ resource }) => resource.catalog === initial.resource.catalog &&
      resource.kind === initial.resource.kind && resource.id === initial.resource.id)!;
    const ref = versions.find((version) => version.prefix === initial.revision)!.sha;
    const resource = { ...copy(entry.resource), scope: initial.scope, managed: true,
      paths: installedPaths(entry.resource, 'copilot', initial.scope) };
    installations.set(key(resource), { ...entry, resource, scope: initial.scope, tool: 'copilot', ref,
      content: contentAt(entry.sample, ref) });
  }
  const localSample = samples.find((sample) => sample.id === 'testing')!;
  const localResource: CatalogResource = { id: 'local-testing', kind: 'skill', scope: 'project', managed: false,
    description: '[Demo fixture] Unmanaged local copy of the bundled testing skill.',
    paths: ['.agents/skills/local-testing/SKILL.md'], limitations: [demoNotice] };
  installations.set(key(localResource), { resource: localResource, sample: localSample,
    scope: 'project', tool: 'copilot', ref: versions[0].sha, content: localSample.content });

  const result = (messages: string[] = []): ActionResult => ({ code: 0, messages, resources: inventory(), errors: [] });
  const fail = (message: string): ActionResult => ({ ...result([message]), code: 1,
    failure: { code: 'DEMO_ACTION_FAILED', recoverable: false, userMessage: message } });
  const catalogResult = (): CatalogResult => ({ catalogs: catalogSnapshot(), resources: sourceSnapshot() });
  const getCatalog = (name: string) => {
    const catalog = catalogs.find(({ config }) => nameKey(config.name) === nameKey(name));
    if (!catalog) throw new Error(`Demo catalog not found: ${name}.`);
    return catalog;
  };
  const mutateCatalog = (raw: CatalogRequest, originalName?: string) => {
    const config = parseCatalog(raw);
    const original = originalName === undefined ? undefined : getCatalog(originalName);
    const others = catalogs.filter((catalog) => catalog !== original);
    if (others.some(({ config: existing }) => nameKey(existing.name) === nameKey(config.name))) {
      throw new Error(`Demo catalog name already exists: ${config.name}.`);
    }
    if (others.some(({ config: existing }) => nameKey(repositoryId(existing.repository)) === nameKey(repositoryId(config.repository)))) {
      throw new Error('Demo repository is already registered as another catalog.');
    }
    const indexed = indexCatalog(config);
    catalogs = original ? catalogs.map((catalog) => catalog === original ? indexed : catalog) : [...catalogs, indexed];
    // Like the CLI, editing catalog configuration does not rewrite installation ownership or content.
    return { ...catalogResult(), catalog: config.name, count: indexed.entries.length };
  };
  const actions: Actions = {
    get catalogResources() { return sourceSnapshot(); },
    get userCatalogs() { return catalogSnapshot(); },
    showOnboarding: false,
    async execute(operation, resource, options) {
      const scope = operation === 'install' ? options.scope ?? 'project' : resource.scope;
      const current = installations.get(key({ ...resource, scope }));
      const source = findSource(resource);
      if (operation === 'preview') {
        if (resource.scope && (!current || !sameSource(current.resource, resource))) return fail('Demo installation no longer exists.');
        if (!resource.scope && !source) return fail('Demo source no longer exists in a configured catalog.');
        const ref = current && resource.scope ? current.ref : source!.resource.source_ref!;
        const content = current && resource.scope ? current.content : contentAt(source!.sample, ref);
        const paths = current && resource.scope ? current.resource.paths! : [sourcePath(source!.sample)];
        const files = paths.map((path) => ({ path, content }));
        return { ...result([`Demo preview at ${ref}. ${demoNotice}`]), previewFiles: files,
          previewTree: [resource.scope ? `demo ${scope} installation/` : 'bundled demo source/',
            ...paths.map((path, index) => `${index === paths.length - 1 ? '└──' : '├──'} ${path}`)],
          previewAuditLines: ['Demo only: no security audit was run.', 'Bundled sample text is shown, not a remote repository or local file.',
            'This preview provides no security or safety guarantee.'] };
      }
      if (scope !== 'project' && scope !== 'user') return fail('Demo scope must be project or user.');
      if (resource.kind === 'instruction' && scope === 'user') return fail('Instructions support project scope only.');
      if (operation === 'uninstall' || operation === 'remove-unmanaged') {
        if (!current || !sameSource(current.resource, resource)) return fail('Matching demo installation no longer exists; nothing was removed.');
        if ((operation === 'remove-unmanaged') !== (current.resource.managed === false)) {
          return fail('Use remove-unmanaged for unmanaged fixtures and uninstall for managed fixtures.');
        }
        installations.delete(key({ ...resource, scope }));
        return result([`Demo only: removed ${resource.kind}:${resource.id} from ${scope} memory. No local files were changed.`]);
      }
      if (operation !== 'install' && operation !== 'update') return fail(`Unsupported demo operation: ${operation}.`);
      if (!source) return fail('Demo source is no longer configured. Retained installations can still be previewed or uninstalled.');
      if (current && (!sameSource(current.resource, source.resource) || current.resource.managed === false)) {
        return fail(`Demo destination conflict: ${resource.kind}:${resource.id} already belongs to ${current.resource.catalog ?? 'an unmanaged fixture'} in ${scope}. Uninstall/remove it first; force cannot overwrite another owner.`);
      }
      if (operation === 'update' && !current) return fail('No matching demo installation exists to update.');
      if (operation === 'install' && current && !options.ref) return fail('Already installed in this demo scope; use update or select a revision.');
      const tool = operation === 'update' ? current!.tool : options.tool ?? 'copilot';
      if (tool !== 'copilot' && tool !== 'claude' && tool !== 'both') return fail('Demo client must be copilot, claude, or both.');
      const ref = options.ref ?? source.resource.source_ref!;
      if (!versions.some((version) => version.sha === ref)) return fail('Demo only: that revision is not bundled. Select one of the three fixture commits.');
      options.onProgress?.(`Applying bundled ${resource.kind}:${resource.id} in demo memory...`);
      const installed = { ...copy(source.resource), scope, managed: true,
        source_ref: ref, paths: installedPaths(source.resource, tool, scope) };
      installations.set(key(installed), { ...source, resource: installed, scope, tool, ref, content: contentAt(source.sample, ref) });
      return result([`Demo only: ${operation === 'update' ? 'updated' : 'installed'} ${resource.kind}:${resource.id} at ${ref.slice(0, 7)} (${scope}, ${tool}).`,
        'Only browser memory changed. No security audit was run.']);
    },
    async listSourceVersions(resource) {
      if (!findSource(resource)) throw new Error('Demo only: commit history is available only for configured bundled fixtures.');
      return copy(versions);
    },
    async addCatalog(request) { return mutateCatalog(request); },
    async updateCatalog(originalName, request) { return mutateCatalog(request, originalName); },
    async removeCatalog(name) {
      const catalog = getCatalog(name);
      catalogs = catalogs.filter((entry) => entry !== catalog);
      return catalogResult();
    },
    async refreshCatalog(name) {
      const selected = name === undefined ? [...catalogs] : [getCatalog(name)];
      const refreshed: NonNullable<CatalogResult['refreshed']> = [];
      for (const catalog of selected) {
        const updated = indexCatalog(parseCatalog(catalog.config));
        catalogs = catalogs.map((entry) => entry === catalog ? updated : entry);
        refreshed.push({ name: updated.config.name, count: updated.entries.length });
      }
      return { ...catalogResult(), refreshed, failures: [] };
    },
    async checkCatalogFreshness(names = catalogs.map(({ config }) => config.name)) {
      return names.map((name) => {
        const catalog = catalogs.find(({ config }) => nameKey(config.name) === nameKey(name));
        return { name, status: !catalog ? 'unknown' as const : catalog.revision === 0 ? 'current' as const : 'outdated' as const };
      });
    },
    async transferCatalogs(action, content) {
      if (action === 'export') {
        if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
          throw new Error('Demo export needs browser clipboard permission on HTTPS. No configuration was copied.');
        }
        try {
          await navigator.clipboard.writeText(JSON.stringify({ catalog_version: 1, sources: catalogSnapshot() }, null, 2));
        } catch {
          throw new Error('Browser clipboard access was denied. No demo configuration was copied.');
        }
        return catalogResult();
      }
      let manifest: { catalog_version?: unknown; sources?: unknown };
      try { manifest = JSON.parse(content) as typeof manifest; } catch { throw new Error('Demo import requires valid catalog JSON.'); }
      if (!manifest || manifest.catalog_version !== 1 || !Array.isArray(manifest.sources)) {
        throw new Error('Configuration must include catalog_version 1 and a sources array.');
      }
      // Validate all entries before changing state; a malformed import never partially applies.
      const incoming = manifest.sources.map(parseCatalog);
      const pending = [...catalogs];
      const summary: NonNullable<CatalogResult['importSummary']> = { added: [], ignored: [], refreshed: [], refreshFailures: [] };
      for (const config of incoming) {
        const existingName = pending.some(({ config: entry }) => nameKey(entry.name) === nameKey(config.name));
        const existingRepository = pending.some(({ config: entry }) => nameKey(repositoryId(entry.repository)) === nameKey(repositoryId(config.repository)));
        if (existingName || existingRepository) {
          summary.ignored.push({ name: config.name, reason: existingName ? 'Catalog name already exists.' : 'Repository is already registered.' });
          continue;
        }
        const indexed = indexCatalog(config);
        pending.push(indexed);
        summary.added.push(config.name);
        summary.refreshed.push({ name: config.name, count: indexed.entries.length });
      }
      catalogs = pending;
      return { ...catalogResult(), importSummary: summary };
    },
  };
  return { get resources() { return inventory(); }, actions };
}
