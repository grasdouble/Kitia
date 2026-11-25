import type { spawn } from 'node:child_process';
import type { Dirent, Stats } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';

import type { InstalledSourceResource } from '../inventory/inventory.js';
import {
  readInstallState,
  sourceCatalogName,
  setSourceResourceRecord,
  sourceSkillKey,
  sourceSkillRecords,
  sourceSkillRecord,
  recordSourceInstallation,
  readInstalledSourceResources,
  removeSourceResourceRecord,
  readInstalledSourceSkills,
  removeSourceSkillRecord,
} from '../inventory/inventory.js';
import type { InstallState, FileFingerprint } from '../inventory/model.js';
import { LOCK_PATH } from '../inventory/model.js';
import { preparePinnedSourceFile, isPreparedPinnedSourceFile, withPinnedSourceFiles } from '../resources/content.js';
import type { PreparedPinnedSourceFile } from '../resources/content.js';
import { parseInstruction } from '../resources/frontmatter.js';
import type { CatalogResource } from '../resources/model.js';
import { CatalogError } from '../resources/model.js';
import type { InstallationDestination } from './destinations.js';
import {
  availableInstallationDestinations,
  installationPath,
  resolveInstallationDestinations,
} from './destinations.js';
import {
  addInventoryStateToPlan,
  fileFingerprint,
  installedFingerprint,
  sameFingerprint,
  targetPath,
  writeInstallPlan,
} from './files.js';
import type { GhSkillResult, SourceSkillResource } from './gh-skill.js';
import {
  runGhSkill,
  buildSourceSkillArgs,
  formatGhDiagnostics,
  describeGhFailure,
  isGhOverwriteRequired,
  runGhSkillAsync,
} from './gh-skill.js';
import type { InstallationScope, PlanAction } from './model.js';
import type { InstallPlanEntry } from './plan.js';

const INSTRUCTION_LAYOUTS = availableInstallationDestinations('instruction');

function catalogLabel(resource: CatalogResource): string {
  return `${resource.catalog || 'source'} catalog`;
}

interface SourceFileInstallPlan {
  target: string;
  state: InstallState;
  inventory: FileFingerprint | null;
  files: Map<string, InstallPlanEntry>;
}

interface SourceFileInstallOptions {
  scope?: InstallationScope;
  force?: boolean;
  dryRun?: boolean;
  onAction?: (action: PlanAction) => void;
  onProgress?: (message: string) => void;
}

function createSourceFileInstallPlan(target: string, dryRun: boolean): SourceFileInstallPlan {
  return {
    target,
    inventory: dryRun ? null : installedFingerprint(target, LOCK_PATH),
    state: readInstallState(target),
    files: new Map(),
  };
}

function publishSourceFileInstallPlan({ target, state, inventory, files }: SourceFileInstallPlan): void {
  if (!files.size) return;
  addInventoryStateToPlan(files, state);
  files.get(LOCK_PATH)!.expected = inventory;
  writeInstallPlan(files, target);
}

function installSourceFileResource(
  source: CatalogResource | PreparedPinnedSourceFile,
  target: string,
  requested: readonly InstallationDestination[] | undefined,
  options: SourceFileInstallOptions = {},
): string[] {
  const resource = isPreparedPinnedSourceFile(source) ? source.resource : source;
  if (!['agent', 'instruction'].includes(resource.kind))
    throw new CatalogError(`Unsupported source resource kind: ${resource.kind}`);
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory())
    throw new CatalogError(`Target must be an existing directory: ${target}`);
  const destinations = resolveInstallationDestinations(resource.kind, options.scope ?? 'project', requested).map(
    (layout) => installationPath(layout, resource.id),
  );
  const plan = createSourceFileInstallPlan(fs.realpathSync(target), Boolean(options.dryRun));
  stageSourceFileInstallation(source, destinations, plan, options);
  if (!options.dryRun) {
    options.onProgress?.('Updating installed files...');
    publishSourceFileInstallPlan(plan);
  }
  return destinations;
}

function stageSourceFileInstallation(
  source: CatalogResource | PreparedPinnedSourceFile,
  destinations: string[],
  { target, state, files }: SourceFileInstallPlan,
  { force = false, dryRun = false, onAction = () => {}, onProgress = () => {} }: SourceFileInstallOptions,
  prepare = preparePinnedSourceFile,
): void {
  const isPrepared = isPreparedPinnedSourceFile(source);
  const resource = isPrepared ? source.resource : source;
  assertSourceFileCanBeInstalled(resource, state);
  const previous = state.sources?.[sourceCatalogName(resource)]?.[`${resource.kind}s`]?.[resource.id];
  const sameSource =
    previous &&
    previous.source_repository === resource.source_repository &&
    previous.source_path === resource.source_path;
  if (previous && (!sameSource || previous.source_ref?.toLowerCase() !== resource.source_ref?.toLowerCase())) {
    const untouched = Object.keys(previous.files).filter((relativePath) => !destinations.includes(relativePath));
    if (untouched.length) {
      throw new CatalogError(
        `Cannot change the shared pin for ${resource.kind}:${resource.id} while leaving tracked destinations unchanged. Select all tracked destinations or use update.`,
        'SHARED_SOURCE_PIN',
        { category: 'provenance-conflict', paths: untouched },
      );
    }
  }
  let content: Buffer | undefined;
  if (!dryRun) {
    if (!isPrepared) onProgress(`Retrieving pinned ${resource.kind} ${resource.id} from GitHub...`);
    content = (isPrepared ? source : prepare(resource)).content;
  }
  const instruction =
    content && resource.kind === 'instruction'
      ? parseInstruction(content, `${resource.source_repository}:${resource.source_path}`)
      : undefined;
  const sourceFingerprint = content && !instruction ? fileFingerprint(content, false) : undefined;
  const trackedFiles = sameSource ? { ...previous.files } : {};
  for (const relativePath of destinations) {
    if (!content) {
      targetPath(target, relativePath);
    } else {
      let output = content;
      if (instruction) {
        const scopeKey = INSTRUCTION_LAYOUTS.find(
          (layout) => installationPath(layout, resource.id) === relativePath,
        )?.instructionScope;
        if (!scopeKey) throw new CatalogError(`Unsupported instruction destination: ${relativePath}`);
        const scopeValue = scopeKey === 'paths' ? instruction.applyTo : instruction.applyTo.join(', ');
        const runtimeScope = `${scopeKey}: ${JSON.stringify(scopeValue)}`;
        output = Buffer.from(`---\n${runtimeScope}\n---\n\n${instruction.body}`, 'utf8');
      }
      const fingerprint = sourceFingerprint ?? fileFingerprint(output, false);
      const actual = installedFingerprint(target, relativePath);
      const expected = trackedFiles[relativePath];
      if (expected && actual && !sameFingerprint(actual, expected) && !force) {
        throw new CatalogError(
          `Refusing to overwrite locally modified source file ${relativePath}; pass --force.`,
          'LOCAL_CONFLICT',
          { category: 'tracked-modification', paths: [relativePath], recoverable: true },
        );
      }
      const unchanged = actual && sameFingerprint(actual, fingerprint);
      if (!expected && actual && !unchanged && !force) {
        throw new CatalogError(`Refusing to overwrite existing file ${relativePath}; pass --force.`, 'LOCAL_CONFLICT', {
          category: 'untracked-destination',
          paths: [relativePath],
          recoverable: true,
        });
      }
      files.set(relativePath, { content: output, executable: false, fingerprint, expected: actual });
      trackedFiles[relativePath] = unchanged ? actual : fingerprint;
    }
    onAction({
      action: 'install',
      path: relativePath,
      resource: { catalog: sourceCatalogName(resource), kind: resource.kind, id: resource.id },
    });
  }
  if (content) {
    setSourceResourceRecord(
      state,
      instruction ? { ...resource, apply_to: instruction.applyTo } : resource,
      trackedFiles,
    );
  }
}

function assertSourceFileCanBeInstalled(resource: CatalogResource, state: InstallState): void {
  for (const [catalog, collections] of Object.entries(state.sources || {})) {
    if (catalog !== sourceCatalogName(resource) && collections[`${resource.kind}s`]?.[resource.id]) {
      throw new CatalogError(
        `${resource.kind}:${resource.id} is already tracked from another source catalog.`,
        'LOCAL_CONFLICT',
        {
          category: 'provenance-conflict',
          paths: [],
          recoverable: false,
        },
      );
    }
  }
}

function assertSourceSkillCanBeInstalled(resource: CatalogResource, target: string): void {
  const state = readInstallState(target);
  const key = sourceSkillKey(resource);
  const anotherSource = [...sourceSkillRecords(state).keys()].some(
    (installedKey) => installedKey !== key && installedKey.endsWith(`:${resource.id}`),
  );
  if (anotherSource) {
    throw new CatalogError(
      `Skill ID '${resource.id}' is already tracked from another catalog in this target; remove it before installing from ${catalogLabel(resource)}.`,
      'LOCAL_CONFLICT',
      { category: 'provenance-conflict', paths: [], recoverable: false },
    );
  }
}

function assertSourceResourceCanBeInstalled(resource: CatalogResource, target: string): void {
  if (resource.kind === 'skill') assertSourceSkillCanBeInstalled(resource, target);
  else assertSourceFileCanBeInstalled(resource, readInstallState(target));
}

function validateSourceUpdates(
  installed: InstalledSourceResource[],
  { force = false, target, scope = 'project' }: { force?: boolean; target?: string; scope?: InstallationScope } = {},
): void {
  const targetRoot = target ? fs.realpathSync(target) : undefined;
  const state = targetRoot ? readInstallState(targetRoot) : undefined;
  for (const { resource, installations, removed } of installed) {
    if (removed) {
      throw new CatalogError(
        `${catalogLabel(resource)} ${resource.kind} ${resource.id} was removed from the catalog. Use uninstall to remove it explicitly.`,
      );
    }
    const modified = installations.filter((installation) => installation.modified);
    if (modified.length && !force) {
      throw new CatalogError(
        `Refusing to overwrite locally modified ${catalogLabel(resource)} ${resource.kind} files: ${modified.map((entry) => entry.path).join(', ')}. Review them and pass --force.`,
        'LOCAL_CONFLICT',
        {
          category: 'tracked-modification',
          paths: modified.map((entry) => entry.path),
          recoverable: true,
        },
      );
    }
    if (force || !targetRoot || !state) continue;
    if (resource.kind !== 'skill') {
      const destinations = availableInstallationDestinations(resource.kind, scope).map((layout) =>
        installationPath(layout, resource.id),
      );
      const managedPaths = new Set(
        Object.keys(state.sources?.[sourceCatalogName(resource)]?.[`${resource.kind}s`]?.[resource.id]?.files || {}),
      );
      const conflicts = destinations.filter(
        (relativePath) => !managedPaths.has(relativePath) && installedFingerprint(targetRoot, relativePath),
      );
      if (conflicts.length) {
        throw new CatalogError(
          `Refusing to overwrite existing local ${resource.kind} files: ${conflicts.join(', ')}. Review them and pass --force.`,
          'LOCAL_CONFLICT',
          { category: 'untracked-destination', paths: conflicts, recoverable: true },
        );
      }
      continue;
    }
    const record = sourceSkillRecord(state, sourceCatalogName(resource), resource.id);
    const managedPaths = new Set(Object.keys(record?.files || {}));

    for (const installation of installations) {
      const directory = path.posix.dirname(installation.path);
      const absolute = targetPath(targetRoot, directory);
      const untrackedPaths = fs.existsSync(absolute) ? untrackedSkillPaths(targetRoot, directory, managedPaths) : [];
      if (untrackedPaths.length) {
        throw new CatalogError(
          `Refusing to overwrite ${catalogLabel(resource)} skill ${resource.id} with untracked local files in ${directory}; review them and pass --force.`,
          'LOCAL_CONFLICT',
          { category: 'untracked-skill-content', paths: untrackedPaths, recoverable: true },
        );
      }
    }
  }
}

function updateSourceFileResources(
  installed: InstalledSourceResource[],
  target: string,
  options: SourceFileInstallOptions & { preparedSourceFile?: PreparedPinnedSourceFile },
): string[] {
  const messages: string[] = [];
  let plan: SourceFileInstallPlan | undefined;
  withPinnedSourceFiles((prepare) => {
    for (const { resource, installations } of installed) {
      const stale = installations.filter(
        (item) => item.missing || item.modified || item.ref?.toLowerCase() !== resource.source_ref?.toLowerCase(),
      );
      if (!stale.length) continue;
      plan ??= createSourceFileInstallPlan(target, Boolean(options.dryRun));
      stageSourceFileInstallation(
        options.preparedSourceFile ?? resource,
        stale.map((item) => item.path),
        plan,
        options,
        prepare,
      );
      messages.push(
        `${options.dryRun ? 'Would update' : 'Updated'} ${catalogLabel(resource)} ${resource.kind}: ${resource.id}`,
      );
    }
  });
  if (plan && !options.dryRun) {
    options.onProgress?.('Updating installed files...');
    publishSourceFileInstallPlan(plan);
  }
  return messages;
}

interface SourceUpdateOptions extends SourceFileInstallOptions {
  preparedSourceFile?: PreparedPinnedSourceFile;
  ghForce?: boolean;
  ghForceAgent?: string;
  nonInteractive?: boolean;
  spawnProcess?: typeof spawn;
}

interface SkillUpdateTask {
  args: string[];
  target: string;
}

function* sourceUpdates(
  installed: InstalledSourceResource[],
  target: string,
  {
    dryRun = false,
    force = false,
    ghForce = false,
    ghForceAgent,
    onAction = () => {},
    onProgress = () => {},
    scope = 'project',
    preparedSourceFile,
  }: SourceUpdateOptions,
): Generator<SkillUpdateTask, string[], number | GhSkillResult> {
  onProgress('Validating installed resource and local file state...');
  const targetRoot = fs.realpathSync(target);
  if (ghForce && !ghForceAgent) {
    throw new CatalogError('A GitHub force retry must identify the failed agent.', 'INVALID_ARGUMENT');
  }
  validateSourceUpdates(installed, { force, target: targetRoot, scope });
  const messages = updateSourceFileResources(
    installed.filter(({ resource }) => resource.kind !== 'skill'),
    targetRoot,
    {
      dryRun,
      force,
      onAction,
      onProgress,
      preparedSourceFile,
    },
  );
  const skills = installed.filter(({ resource }) => resource.kind === 'skill');
  let hasUpdates = false;
  for (const { installations } of skills) {
    for (const installation of installations) targetPath(targetRoot, installation.path);
  }
  for (const { resource, installations } of skills) {
    const stale = installations.filter(
      (installation) =>
        installation.missing ||
        installation.modified ||
        installation.ref?.toLowerCase() !== resource.source_ref!.toLowerCase(),
    );
    if (!stale.length) continue;
    hasUpdates = true;
    const completed: InstallationDestination[] = [];
    for (const installation of stale) {
      const { destination, path: skillPath } = installation;
      const directory = path.join(targetRoot, path.posix.dirname(path.posix.dirname(skillPath)));
      const args = buildSourceSkillArgs('install', resource as SourceSkillResource, directory, {
        scope,
        force: force || (ghForce && destination === ghForceAgent),
      });
      if (dryRun) {
        onAction({
          action: 'delegate_install',
          path: installation.path,
          resource: { catalog: sourceCatalogName(resource), kind: 'skill', id: resource.id },
          command: { program: 'gh', args },
        });
        continue;
      }
      onProgress(`Invoking GitHub CLI to update ${resource.id} for ${destination}...`);
      let result: number | GhSkillResult;
      try {
        result = yield { args, target: targetRoot };
      } catch (error) {
        const code =
          typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
            ? error.code
            : undefined;
        if (code !== 'GH_SPAWN_FAILED' && code !== 'GH_TIMEOUT') throw error;
        const partial = [...messages, ...(completed.length ? [`Updated destinations: ${completed.join(', ')}`] : [])];
        const cause =
          code === 'GH_SPAWN_FAILED'
            ? 'Could not start GitHub CLI. Check that gh is installed and available on PATH.'
            : 'GitHub CLI timed out. Check network connectivity and retry.';
        const userMessage = `Could not update ${catalogLabel(resource)} skill ${resource.id} for ${destination}. ${cause}${partial.length ? ` Already updated: ${partial.join('; ')}. Those updates remain in place.` : ' No destinations were confirmed updated before this failure.'}`;
        throw new CatalogError(userMessage, code, { category: 'github-cli', userMessage });
      }
      const status = typeof result === 'number' ? result : result.status;
      if (status !== 0) {
        const diagnostic = typeof result === 'number' ? '' : formatGhDiagnostics(result);
        const ghForceRequired = isGhOverwriteRequired(diagnostic);
        const cause = ghForceRequired
          ? 'GitHub CLI says this skill is already installed and requires --force to overwrite it.'
          : describeGhFailure(diagnostic);
        const priorUpdates = [
          ...messages,
          ...(completed.length ? [`Updated destinations: ${completed.join(', ')}`] : []),
        ];
        const partial = priorUpdates.length
          ? ` Already updated: ${priorUpdates.join('; ')}. Those updates remain in place.`
          : ' No destinations were confirmed updated before this failure.';
        const userMessage = `Could not update ${catalogLabel(resource)} skill ${resource.id} for ${destination}: gh exited with status ${status}. ${cause}${partial}`;
        throw new CatalogError(
          `${userMessage}${diagnostic ? ` gh diagnostic: ${diagnostic}` : ''}`,
          ghForceRequired ? 'GH_FORCE_REQUIRED' : 'GH_UPDATE_FAILED',
          {
            category: ghForceRequired ? 'github-force-required' : 'github-cli',
            recoverable: ghForceRequired,
            ...(ghForceRequired ? { agent: destination } : {}),
            userMessage,
            technicalDetail: diagnostic || undefined,
          },
        );
      }
      recordSourceInstallation(resource, targetRoot, skillPath);
      completed.push(destination);
    }
    if (dryRun) {
      const refs = [...new Set(stale.map(({ ref }) => ref?.slice(0, 7) || 'unknown'))];
      messages.push(
        `Would update ${catalogLabel(resource)} skill: ${resource.id} (installed at ${refs.join(', ')}, catalog ${resource.source_ref!.slice(0, 7)})`,
      );
    } else {
      messages.push(`Updated ${catalogLabel(resource)} skill: ${resource.id}`);
    }
  }
  if (!hasUpdates && skills.length) messages.push('No source skill updates available.');
  onProgress('Resource update complete.');
  return messages;
}

function updateSourceResources(
  installed: InstalledSourceResource[],
  target: string,
  options: SourceUpdateOptions = {},
  invokeGhSkill: (args: string[], cwd: string) => number | GhSkillResult = (args, cwd) =>
    runGhSkill(args, cwd, undefined, {
      nonInteractive: options.nonInteractive,
      captureOutput: options.nonInteractive,
    }),
): string[] {
  const updates = sourceUpdates(installed, target, options);
  let step = updates.next();
  while (true) {
    if (step.done) return step.value;
    let result: number | GhSkillResult;
    try {
      result = invokeGhSkill(step.value.args, step.value.target);
    } catch (error) {
      step = updates.throw(error);
      continue;
    }
    step = updates.next(result);
  }
}

async function updateSourceResourcesAsync(
  installed: InstalledSourceResource[],
  target: string,
  options: SourceUpdateOptions = {},
): Promise<string[]> {
  const transportOptions = { ...options, nonInteractive: options.nonInteractive ?? true };
  const updates = sourceUpdates(installed, target, transportOptions);
  let step = updates.next();
  while (true) {
    if (step.done) return step.value;
    let result: number | GhSkillResult;
    try {
      result = transportOptions.nonInteractive
        ? await runGhSkillAsync(step.value.args, step.value.target, transportOptions)
        : runGhSkill(step.value.args, step.value.target);
    } catch (error) {
      step = updates.throw(error);
      continue;
    }
    step = updates.next(result);
  }
}

function uninstallSourceFileResource(
  resource: CatalogResource,
  target: string,
  {
    dryRun = false,
    force = false,
    onAction = () => {},
  }: {
    dryRun?: boolean;
    force?: boolean;
    onAction?: (action: PlanAction) => void;
  } = {},
): string[] {
  const targetRoot = fs.realpathSync(target);
  const installed = readInstalledSourceResources(targetRoot, [resource], {
    catalog: sourceCatalogName(resource),
    kind: resource.kind,
  }).find(({ resource: current }) => current.id === resource.id);
  if (!installed)
    throw new CatalogError(`No tracked ${catalogLabel(resource)} ${resource.kind} installation for ${resource.id}`);
  const paths = installed.installations.filter((item) => !item.missing).map((item) => item.path);
  const modified = installed.installations.filter((item) => item.modified);
  if (modified.length && !force) {
    throw new CatalogError(
      `Refusing to remove locally modified ${catalogLabel(resource)} ${resource.kind} files: ${modified.map((item) => item.path).join(', ')}. Pass --force.`,
      'LOCAL_CONFLICT',
      {
        category: 'tracked-modification',
        paths: modified.map((item) => item.path),
        recoverable: true,
      },
    );
  }
  const state = readInstallState(targetRoot);
  if (dryRun) {
    for (const relativePath of paths)
      onAction({
        action: 'remove',
        path: relativePath,
        resource: { catalog: sourceCatalogName(resource), kind: resource.kind, id: resource.id },
      });
    if (!paths.length)
      onAction({
        action: 'forget',
        path: null,
        resource: { catalog: sourceCatalogName(resource), kind: resource.kind, id: resource.id },
      });
    onAction({ action: 'overwrite', path: LOCK_PATH });
    return paths.map((relativePath) => `Would remove: ${relativePath}`);
  }
  removeSourceResourceRecord(state, resource);
  const plan = new Map<string, InstallPlanEntry>();
  addInventoryStateToPlan(plan, state);
  writeInstallPlan(plan, targetRoot, { force: true, remove: paths });
  return paths.length
    ? paths.map((relativePath) => `Removed ${catalogLabel(resource)} ${resource.kind}: ${relativePath}`)
    : [`Forgot missing ${catalogLabel(resource)} ${resource.kind}: ${resource.id}`];
}

function pruneEmptySkillDirectory(targetRoot: string, relativeDirectory: string): void {
  let absolute: string;
  try {
    absolute = targetPath(targetRoot, relativeDirectory);
  } catch (error) {
    const message =
      typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
        ? error.message
        : '';
    if (/symbolic link/i.test(message)) return;
    throw error;
  }
  let stat: Stats;
  try {
    stat = fs.lstatSync(absolute);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
        ? error.code
        : undefined;
    if (code === 'ENOENT') return;
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) return;
  const entries: Dirent[] = fs.readdirSync(absolute, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      pruneEmptySkillDirectory(targetRoot, path.posix.join(relativeDirectory, entry.name));
    }
  }
  if (fs.readdirSync(absolute).length === 0) fs.rmdirSync(absolute);
}

function untrackedSkillPaths(targetRoot: string, relativeDirectory: string, managedPaths: Set<string>): string[] {
  const paths: string[] = [];
  const absolute = targetPath(targetRoot, relativeDirectory);
  const entries: Dirent[] = fs.readdirSync(absolute, { withFileTypes: true });
  for (const entry of entries) {
    const relative = path.posix.join(relativeDirectory, entry.name);
    if (entry.isSymbolicLink()) paths.push(relative);
    else if (entry.isDirectory()) paths.push(...untrackedSkillPaths(targetRoot, relative, managedPaths));
    else if (!managedPaths.has(relative)) paths.push(relative);
  }
  return paths;
}

function hasUntrackedSkillContent(targetRoot: string, relativeDirectory: string, managedPaths: Set<string>): boolean {
  const absolute = targetPath(targetRoot, relativeDirectory);
  const entries: Dirent[] = fs.readdirSync(absolute, { withFileTypes: true });
  for (const entry of entries) {
    const relative = path.posix.join(relativeDirectory, entry.name);
    if (entry.isSymbolicLink()) return true;
    if (entry.isDirectory()) {
      if (hasUntrackedSkillContent(targetRoot, relative, managedPaths)) return true;
    } else if (!managedPaths.has(relative)) return true;
  }
  return false;
}

function uninstallSourceResource(
  resource: CatalogResource,
  target: string,
  {
    dryRun = false,
    force = false,
    onAction = () => {},
  }: { dryRun?: boolean; force?: boolean; onAction?: (action: PlanAction) => void } = {},
): string[] {
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new CatalogError(`Target must be an existing directory: ${target}`);
  }
  if (resource.kind !== 'skill') return uninstallSourceFileResource(resource, target, { dryRun, force, onAction });
  const targetRoot = fs.realpathSync(target);
  const key = sourceSkillKey(resource);
  const installed = readInstalledSourceSkills(targetRoot, [resource]).find(
    ({ resource: installedResource }) => sourceSkillKey(installedResource) === key,
  );
  if (!installed) {
    throw new CatalogError(`No tracked ${catalogLabel(resource)} skill installation for ${resource.id}`);
  }

  const mismatched = installed.installations.filter((entry) => !entry.missing && !entry.provenanceMatches);
  if (mismatched.length) {
    throw new CatalogError(
      `Refusing to remove ${catalogLabel(resource)} skill files with mismatched provenance: ${mismatched.map((entry) => entry.path).join(', ')}`,
    );
  }
  const state: InstallState = readInstallState(targetRoot);
  const record = sourceSkillRecord(state, sourceCatalogName(resource), resource.id);
  if (
    !record ||
    record.source_repository !== resource.source_repository ||
    record.source_path !== resource.source_path
  ) {
    throw new CatalogError(`No tracked ${catalogLabel(resource)} skill installation for ${resource.id}`);
  }
  const skillDirectories = installed.installations.map(({ path: relativePath }) => path.posix.dirname(relativePath));
  const expectedRemovals = new Map<string, FileFingerprint>();
  const modified: string[] = [];
  for (const [relativePath, expected] of Object.entries(record.files)) {
    const actual = installedFingerprint(targetRoot, relativePath);
    if (!actual) continue;
    expectedRemovals.set(relativePath, actual);
    if (!sameFingerprint(actual, expected)) modified.push(relativePath);
  }
  const paths = [...expectedRemovals.keys()];
  if (dryRun) {
    const messages: string[] = [];
    if (!paths.length) {
      messages.push(`Would forget missing ${catalogLabel(resource)} skill: ${resource.id}`);
      onAction({
        action: 'forget',
        path: null,
        resource: { catalog: sourceCatalogName(resource), kind: 'skill', id: resource.id },
      });
    }
    for (const relativePath of paths) {
      messages.push(`Would remove: ${relativePath}`);
      onAction({
        action: 'remove',
        path: relativePath,
        resource: { catalog: sourceCatalogName(resource), kind: 'skill', id: resource.id },
      });
    }
    for (const directory of skillDirectories) {
      const absolute = targetPath(targetRoot, directory);
      if (fs.existsSync(absolute) && hasUntrackedSkillContent(targetRoot, directory, new Set(paths))) {
        messages.push(`Would preserve additional contents in: ${directory}`);
      }
    }
    if (modified.length) {
      messages.push(
        `Locally modified ${catalogLabel(resource)} skill entry points require --force: ${modified.join(', ')}`,
      );
    } else {
      messages.push(`${catalogLabel(resource)} skill entry points match their recorded installation baseline.`);
    }
    onAction({ action: 'overwrite', path: LOCK_PATH });
    return messages;
  }
  if (modified.length && !force) {
    throw new CatalogError(
      `Refusing to remove locally modified ${catalogLabel(resource)} skill files: ${modified.join(', ')}. Back them up or pass --force.`,
    );
  }
  const plan = new Map<string, InstallPlanEntry>();
  removeSourceSkillRecord(state, resource);
  addInventoryStateToPlan(plan, state);
  writeInstallPlan(plan, targetRoot, {
    force: true,
    remove: paths,
    ...(force ? {} : { expectedRemovals }),
  });
  const messages: string[] = [];
  if (!paths.length) messages.push(`Forgot missing ${catalogLabel(resource)} skill: ${resource.id}`);
  for (const relativePath of paths) {
    messages.push(
      relativePath.endsWith('/SKILL.md')
        ? `Removed ${catalogLabel(resource)} skill entry point: ${relativePath}`
        : `Removed ${catalogLabel(resource)} skill file: ${relativePath}`,
    );
  }
  for (const directory of skillDirectories) {
    pruneEmptySkillDirectory(targetRoot, directory);
    const absolute = targetPath(targetRoot, directory);
    if (fs.existsSync(absolute) && fs.readdirSync(absolute).length) {
      messages.push(`Preserved additional contents in: ${directory}`);
    }
  }
  return messages;
}

export {
  assertSourceResourceCanBeInstalled,
  catalogLabel,
  installSourceFileResource,
  validateSourceUpdates,
  updateSourceResources,
  updateSourceResourcesAsync,
  uninstallSourceResource,
};
