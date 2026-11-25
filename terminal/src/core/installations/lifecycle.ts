import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { AuditResult } from '../inspection/audit.js';
import { auditPreparedSourceFile } from '../inspection/pinned-preview.js';
import {
  readInstalledSourceSkills,
  readInstalledSourceResources,
  sourceCatalogName,
  recordSourceInstallation,
} from '../inventory/inventory.js';
import type { InstalledSourceResource } from '../inventory/inventory.js';
import { preparePinnedSourceFile } from '../resources/content.js';
import { resolveSourceVersionPrefix, listSourceVersions } from '../resources/history.js';
import type { CatalogResource, ResourceKind } from '../resources/model.js';
import { CatalogError } from '../resources/model.js';
import { catalogEntries } from '../resources/queries.js';
import { resolveCatalogResource } from '../resources/selection.js';
import type { InstallationDestination } from './destinations.js';
import { installationPath, resolveInstallationDestinations } from './destinations.js';
import { targetPath } from './files.js';
import type { GhSkillResult, SourceSkillResource } from './gh-skill.js';
import {
  runGhSkill,
  buildSourceSkillArgs,
  runGhSkillAsync,
  formatGhDiagnostics,
  describeGhFailure,
} from './gh-skill.js';
import type { InstallationScope, PlanAction } from './model.js';
import {
  uninstallSourceResource,
  validateSourceUpdates,
  updateSourceResourcesAsync,
  updateSourceResources,
  assertSourceResourceCanBeInstalled,
  installSourceFileResource,
  catalogLabel,
} from './mutations.js';
export interface InstallationMessage {
  level: 'log' | 'error';
  text: string;
}

export interface SourceOperationRequest {
  action: 'install' | 'preview';
  resource: CatalogResource;
  target: string;
  scope?: InstallationScope;
  destinations?: readonly InstallationDestination[];
  force?: boolean;
  dryRun?: boolean;
  audit?: boolean;
  planOnly?: boolean;
  nonInteractive?: boolean;
  captureOutput?: boolean;
  onAction?: (action: PlanAction) => void;
  onProgress?: (message: string) => void;
  onResource?: (resource: {
    catalog: string;
    kind: CatalogResource['kind'];
    id: string;
    status: 'planned';
    source: true;
  }) => void;
  onAudit?: (audit: AuditResult) => void;
  onMessage?: (message: InstallationMessage) => void;
  spawnProcess?: typeof import('node:child_process').spawn;
}

export interface InstallationRequest extends Omit<SourceOperationRequest, 'action' | 'resource'> {
  operation: 'install' | 'preview' | 'update' | 'uninstall';
  resource?: CatalogResource;
  id?: string;
  kind?: ResourceKind;
  catalog?: string;
  ref?: string;
  ghForce?: boolean;
  ghForceAgent?: string;
  projectTarget?: string;
  userTarget?: string;
}

export interface InstallationResult {
  status: number;
  messages: InstallationMessage[];
  preview?: string;
  resource?: CatalogResource;
}

function prepareSourceOperation(
  resource: CatalogResource,
  action: SourceOperationRequest['action'],
  { audit, onAudit }: Pick<SourceOperationRequest, 'audit' | 'onAudit'>,
  needsContent = false,
) {
  if (!audit && !needsContent) return undefined;
  const prepared = preparePinnedSourceFile(resource);
  if (audit) {
    const report = auditPreparedSourceFile(prepared);
    onAudit?.(report);
    if (action === 'install' && (!report.coverage.complete || report.findings.length)) {
      throw new CatalogError(
        report.findings.length
          ? `Audit found ${report.findings.length} finding(s); installation blocked. Inspect the reported files and lines before installing.`
          : 'Audit coverage is incomplete; installation blocked because not all resource text was analyzed.',
        'AUDIT_BLOCKED',
      );
    }
  }
  return prepared;
}

/**
 * Callers hold the target operation lock for mutations, including catalog/inventory
 * preparation before this call and all selection, validation, apply, and recording.
 * Preview is read-only. This operation never acquires a nested lock.
 */
async function executeInstallationOperation(
  options: InstallationRequest,
  sourceResources: CatalogResource[],
  chooseResource: (
    resources: CatalogResource[],
    request: InstallationRequest,
  ) => Promise<CatalogResource | null> = async (resources, request) =>
    request.resource || resolveCatalogResource(resources, request.id!, request.kind),
): Promise<InstallationResult> {
  const messages: InstallationResult['messages'] = [];
  const emit = (level: InstallationMessage['level'], text: string) => {
    const message = { level, text };
    messages.push(message);
    options.onMessage?.(message);
  };
  const output = {
    log: (text: string) => emit('log', text),
    error: (text: string) => emit('error', text),
  };
  const allResources = catalogEntries(sourceResources);
  if (options.operation === 'uninstall') {
    const target = fs.realpathSync(options.target);
    const installed = [
      ...readInstalledSourceSkills(target, sourceResources, { catalog: options.catalog }),
      ...readInstalledSourceResources(target, sourceResources, { catalog: options.catalog }),
    ].filter(({ resource }) => resource.id === options.id && (!options.kind || resource.kind === options.kind));
    if (!installed.length) {
      throw new CatalogError(
        `No tracked source installation for ${options.kind ? `${options.kind}:` : ''}${options.id}`,
        'RESOURCE_NOT_FOUND',
      );
    }
    const resource =
      installed.length === 1
        ? installed[0].resource
        : await chooseResource(
            installed.map(({ resource: entry }) => entry),
            options,
          );
    if (!resource) return { status: 0, messages };
    options.onResource?.({
      catalog: resource.catalog || 'source',
      kind: resource.kind,
      id: resource.id,
      status: 'planned',
      source: true,
    });
    for (const message of uninstallSourceResource(resource, target, options)) output.log(message);
    return { status: 0, messages };
  }
  if (options.operation === 'update') {
    const target = fs.realpathSync(options.target);
    const installed: InstalledSourceResource[] = [
      ...readInstalledSourceSkills(target, sourceResources, { catalog: options.catalog }),
      ...readInstalledSourceResources(target, sourceResources, { catalog: options.catalog }),
    ];
    let sourceToUpdate: InstalledSourceResource[] = options.id
      ? installed.filter(
          ({ resource }) => resource.id === options.id && (!options.kind || resource.kind === options.kind),
        )
      : installed;
    if (options.id && sourceToUpdate.length > 1) {
      const chosen = await chooseResource(
        sourceToUpdate.map(({ resource }) => resource),
        options,
      );
      if (!chosen) return { status: 0, messages };
      sourceToUpdate = sourceToUpdate.filter(
        ({ resource }) => resource.catalog === chosen.catalog && resource.kind === chosen.kind,
      );
    }
    if (!sourceToUpdate.length) {
      throw new CatalogError(
        options.id
          ? `No tracked source installation for ${options.kind ? `${options.kind}:` : ''}${options.id}`
          : 'No tracked source resources to update.',
        'RESOURCE_NOT_FOUND',
      );
    }
    if (options.ref) {
      const ref = options.ref;
      if (sourceToUpdate.some(({ resource }) => !resource.source_repository || !resource.source_path)) {
        throw new CatalogError('--ref supports only GitHub source resources.');
      }
      sourceToUpdate = sourceToUpdate.map((entry) => ({
        ...entry,
        resource: {
          ...entry.resource,
          source_ref: resolveListedSourceRef(entry.resource, ref),
        },
      }));
    }
    const sourceToUpdateResources = sourceToUpdate.map(({ resource }) => resource);
    validateSourceUpdates(sourceToUpdate, { ...options, target });

    for (const resource of sourceToUpdateResources) {
      options.onResource?.({
        catalog: resource.catalog || 'source',
        kind: resource.kind,
        id: resource.id,
        status: 'planned',
        source: true,
      });
    }
    const updates: string[] = options.nonInteractive
      ? await updateSourceResourcesAsync(sourceToUpdate, target, options)
      : updateSourceResources(sourceToUpdate, target, options);
    updates.forEach((message) => output.log(message));
    return { status: 0, messages };
  }
  if (['preview', 'install'].includes(options.operation)) {
    const resource = await chooseResource(allResources, options);
    if (!resource) return { status: 0, messages };
    if (options.operation === 'preview') {
      return await runSourceOperation({ ...options, action: 'preview', resource });
    }
    const destinations = resolveInstallationDestinations(
      resource.kind,
      options.scope ?? 'project',
      options.destinations,
    );
    if (options.ref) {
      const target = fs.realpathSync(options.target);
      if (!resource.source_repository || !resource.source_path) {
        throw new CatalogError('--ref supports only GitHub source resources.');
      }
      const selectedResource = {
        ...resource,
        source_ref: resolveListedSourceRef(resource, options.ref),
      };
      const projectTarget = options.scope === 'user' ? fs.realpathSync(options.projectTarget || process.cwd()) : target;
      const userTarget = fs.realpathSync(options.userTarget || os.homedir());
      const targetRootsOverlap = projectTarget === userTarget;
      const matchingInstalled = [
        ...readInstalledSourceSkills(target, sourceResources, { catalog: options.catalog }),
        ...readInstalledSourceResources(target, sourceResources, { catalog: options.catalog }),
      ].filter(
        ({ resource: current }) =>
          current.catalog === resource.catalog &&
          current.kind === resource.kind &&
          current.id === resource.id &&
          current.source_repository === resource.source_repository &&
          current.source_path === resource.source_path,
      );
      if (targetRootsOverlap && matchingInstalled.length) {
        throw new CatalogError(
          `Cannot safely replace ${resource.catalog}:${resource.kind}:${resource.id}: project and user scopes resolve to the same target (${target}), and the install record does not distinguish them.`,
          'AMBIGUOUS_RESOURCE',
        );
      }
      if (matchingInstalled.length > 1) {
        throw new CatalogError(
          `Multiple tracked installations found for ${resource.catalog}:${resource.kind}:${resource.id} in ${options.scope || 'project'} scope.`,
          'AMBIGUOUS_RESOURCE',
        );
      }
      if (matchingInstalled.length === 1) {
        if (options.destinations) {
          const trackedPaths = new Set(matchingInstalled[0].installations.map((entry) => entry.path));
          if (
            trackedPaths.size !== destinations.length ||
            destinations.some((layout) => !trackedPaths.has(installationPath(layout, resource.id)))
          ) {
            throw new CatalogError(
              'Replacing an installed revision requires all tracked destinations. Omit --destination to replace them, or install an additional destination without --ref.',
              'INVALID_ARGUMENT',
            );
          }
        }
        const replacement = {
          ...matchingInstalled[0],
          resource: { ...matchingInstalled[0].resource, ...selectedResource },
        };
        validateSourceUpdates([replacement], { ...options, target });
        const preparedSourceFile = prepareSourceOperation(replacement.resource, 'install', options);
        const updateOptions = { ...options, preparedSourceFile };
        const updates: string[] = options.nonInteractive
          ? await updateSourceResourcesAsync([replacement], target, updateOptions)
          : updateSourceResources([replacement], target, updateOptions);
        updates.forEach((message) => output.log(message));
        return { status: 0, messages };
      }
      return await runSourceOperation({
        ...options,
        action: 'install',
        resource: selectedResource,
      });
    }
    return await runSourceOperation({ ...options, action: 'install', resource });
  }
  throw new CatalogError(`Unsupported installation operation: ${options.operation}`);
}

// Installation callers hold the target operation lock; this operation never acquires a nested lock.
function runSourceOperation(
  options: SourceOperationRequest,
  invokeGhSkill?: (args: string[], cwd: string) => number | GhSkillResult,
): InstallationResult | Promise<InstallationResult> {
  const injectedInvokeGhSkill = invokeGhSkill;
  invokeGhSkill ||= (args, cwd) =>
    runGhSkill(args, cwd, undefined, {
      nonInteractive: options.nonInteractive,
      captureOutput: options.captureOutput,
    });
  const messages: InstallationResult['messages'] = [];
  const emit = (level: InstallationMessage['level'], text: string) => {
    const message = { level, text };
    messages.push(message);
    options.onMessage?.(message);
  };
  const output = {
    log: (text: string) => emit('log', text),
    error: (text: string) => emit('error', text),
  };
  const finish = (status: number, preview?: string): InstallationResult => ({
    status,
    messages,
    resource,
    ...(preview === undefined ? {} : { preview }),
  });
  const resource = options.resource;

  options.onResource?.({
    catalog: sourceCatalogName(resource),
    kind: resource.kind,
    id: resource.id,
    status: 'planned',
    source: true,
  });

  if (options.action === 'install') options.onProgress?.('Validating resource and installation target...');
  let target = process.cwd();
  if (options.action === 'install') {
    if (!fs.existsSync(options.target) || !fs.statSync(options.target).isDirectory()) {
      throw new CatalogError(`Target must be an existing directory: ${options.target}`);
    }
    target = fs.realpathSync(options.target);
    assertSourceResourceCanBeInstalled(resource, target);
  }
  if (options.action === 'install') {
    const licenseStatus = resource.license_status as string;
    if (licenseStatus.toLocaleLowerCase() === 'proprietary') {
      output.error(`Warning: ${resource.id} is marked Proprietary; confirm you are authorized before installing.`);
    } else if (licenseStatus === 'not-declared') {
      output.error(`Warning: ${resource.id} has no declared license; verify usage rights before installing.`);
    }
  }
  const prepared = prepareSourceOperation(
    resource,
    options.action,
    options,
    resource.kind !== 'skill' && options.action === 'preview',
  );
  if (resource.kind !== 'skill') {
    if (options.action === 'preview') {
      const content = prepared!.content;
      let markdown;
      try {
        markdown = new TextDecoder('utf-8', { fatal: true }).decode(content);
      } catch {
        throw new CatalogError(`Source ${resource.kind} is not valid UTF-8: ${resource.source_path}`);
      }
      return finish(0, markdown);
    }
    if (options.action !== 'install') throw new CatalogError(`Unsupported source resource action: ${options.action}`);
    const paths = installSourceFileResource(prepared || resource, target, options.destinations, {
      scope: options.scope,
      dryRun: Boolean(options.dryRun),
      onAction: options.onAction,
      onProgress: options.onProgress,
    });
    output.log(
      `${options.dryRun ? 'Would install' : 'Installed'} ${catalogLabel(resource)} ${resource.kind}: ${resource.id}${options.dryRun ? ` at ${resource.source_ref}` : ''} (${paths.join(', ')})`,
    );
    return finish(0);
  }
  const skillResource = resource as SourceSkillResource;
  const layouts =
    options.action === 'install'
      ? resolveInstallationDestinations(resource.kind, options.scope ?? 'project', options.destinations)
      : [];
  const skillPaths = layouts.map((layout) => {
    const relativePath = installationPath(layout, resource.id);
    targetPath(target, relativePath);
    return { id: layout.id, relativePath, directory: path.join(target, layout.directory) };
  });

  if (options.planOnly && options.dryRun) {
    for (const { relativePath, directory } of skillPaths) {
      options.onAction?.({
        action: 'delegate_install',
        path: relativePath,
        resource: { catalog: sourceCatalogName(resource), kind: 'skill', id: resource.id },
        command: { program: 'gh', args: buildSourceSkillArgs('install', skillResource, directory, options) },
      });
    }
    output.error(
      'Source skill installation is delegated to gh; auxiliary files and conflicts are resolved by gh at execution time.',
    );
    return finish(0);
  }
  if (options.action === 'preview' || options.dryRun) {
    if (options.dryRun)
      output.error(`Dry run: previewing the ${catalogLabel(resource)} skill; no files will be installed.`);
    const result = invokeGhSkill(buildSourceSkillArgs('preview', skillResource), target);
    if (typeof result !== 'number' && options.captureOutput) {
      if (result.stdout) output.log(String(result.stdout));
      if (result.stderr) output.error(String(result.stderr));
    }
    return finish(typeof result === 'number' ? result : result.status);
  }

  function* installSkill(): Generator<string[], InstallationResult, number | GhSkillResult> {
    const completed: InstallationDestination[] = [];
    for (const { id, relativePath, directory } of skillPaths) {
      let result: number | GhSkillResult;
      const partial = completed.length
        ? ` Already installed for ${completed.join(', ')}. Those installations remain in place.`
        : ' No destinations were confirmed installed before this failure.';
      try {
        result = yield buildSourceSkillArgs('install', skillResource, directory, options);
      } catch (error) {
        const code = (error as Error & { code?: string }).code;
        if (code !== 'GH_SPAWN_FAILED' && code !== 'GH_TIMEOUT') throw error;
        const cause =
          code === 'GH_SPAWN_FAILED'
            ? 'Could not start GitHub CLI. Check that gh is installed and available on PATH.'
            : 'GitHub CLI timed out. Check network connectivity and retry.';
        const userMessage = `Could not install ${catalogLabel(resource)} skill ${resource.id} for ${id}. ${cause}${partial}`;
        throw new CatalogError(userMessage, code, { category: 'github-cli', userMessage });
      }
      const status = typeof result === 'number' ? result : result.status;
      if (status !== 0) {
        const diagnostic = typeof result === 'number' ? '' : formatGhDiagnostics(result);
        const userMessage = `Could not install ${catalogLabel(resource)} skill ${resource.id} for ${id}: gh exited with status ${status}. ${describeGhFailure(diagnostic)}${partial}`;
        throw new CatalogError(
          `${userMessage}${diagnostic ? ` gh diagnostic: ${diagnostic}` : ''}`,
          'GH_INSTALL_FAILED',
          { category: 'github-cli', userMessage, technicalDetail: diagnostic || undefined },
        );
      }
      recordSourceInstallation(resource, target, relativePath);
      completed.push(id);
    }
    options.onProgress?.(`Installed ${catalogLabel(resource)} skill ${resource.id} for ${completed.join(', ')}.`);
    return finish(0);
  }
  const installation = installSkill();
  if (options.nonInteractive) {
    return (async () => {
      let step = installation.next();
      while (step.done === false) {
        let result: number | GhSkillResult;
        try {
          result = injectedInvokeGhSkill
            ? await injectedInvokeGhSkill(step.value, target)
            : await runGhSkillAsync(step.value, target, options);
        } catch (error) {
          step = installation.throw(error);
          continue;
        }
        step = installation.next(result);
      }
      const completedStep = step as IteratorReturnResult<InstallationResult>;
      return completedStep.value;
    })();
  }
  let step = installation.next();
  while (step.done === false) {
    let result: number | GhSkillResult;
    try {
      result = invokeGhSkill(step.value, target);
    } catch (error) {
      step = installation.throw(error);
      continue;
    }
    step = installation.next(result);
  }
  const completedStep = step as IteratorReturnResult<InstallationResult>;
  return completedStep.value;
}

function resolveListedSourceRef(resource: CatalogResource, ref: string): string {
  if (!resource.source_repository || !resource.source_path) {
    throw new CatalogError('--ref supports only GitHub source resources.');
  }
  if (ref.length === 40) return ref;
  try {
    return resolveSourceVersionPrefix(listSourceVersions(resource), ref);
  } catch (error) {
    const historyError = error as Error & { code: string };
    if (historyError.code === 'RESOURCE_NOT_FOUND' || historyError.code === 'AMBIGUOUS_RESOURCE') {
      throw new CatalogError(
        `${historyError.message.replace(/ in source history\.$/, ` for ${resource.catalog}:${resource.kind}:${resource.id}.`)}`,
        historyError.code,
      );
    }
    throw error;
  }
}

export { executeInstallationOperation, runSourceOperation };
