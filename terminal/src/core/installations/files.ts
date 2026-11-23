import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { InstallState, FileFingerprint } from '../inventory/model.js';
import { LOCK_PATH } from '../inventory/model.js';
import { isWithin } from '../resources/content.js';
import { CatalogError } from '../resources/model.js';
import type { InstallPlanOptions } from './model.js';
import type { InstallPlanEntry } from './plan.js';
import { addPlanEntry } from './plan.js';

function targetPath(
  targetRoot: string,
  relativePath: string,
  { allowFinalDirectorySymlink = false }: { allowFinalDirectorySymlink?: boolean } = {},
): string {
  const parts = relativePath.split('/');
  if (
    path.posix.isAbsolute(relativePath) ||
    /[\\:\0]/.test(relativePath) ||
    parts.some((part) => !part || part === '..' || part === '.')
  ) {
    throw new CatalogError(`Unsafe installation path: ${relativePath}`);
  }
  let current = targetRoot;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      const filesystemError = error as NodeJS.ErrnoException;
      if (filesystemError.code === 'ENOENT') {
        current = path.join(current, ...parts.slice(index + 1));
        break;
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      if (parts[1] === 'skills' && index === 2) {
        throw new CatalogError(`Refusing to use symbolic link as a managed skill directory: ${current}`);
      }
      const finalPart = index === parts.length - 1;
      if (finalPart && !allowFinalDirectorySymlink) {
        throw new CatalogError(`Refusing to replace symbolic link: ${current}`);
      }
      try {
        current = fs.realpathSync(current);
        stat = fs.statSync(current);
      } catch (error) {
        const filesystemError = error as Error;
        throw new CatalogError(`Cannot resolve installation symlink ${current}: ${filesystemError.message}`);
      }
      if (!isWithin(current, targetRoot)) {
        throw new CatalogError(`Installation symlink escapes target directory: ${relativePath}`);
      }
      if (!stat.isDirectory()) {
        throw new CatalogError(`Installation symlink must point to a directory: ${current}`);
      }
    }
    if (index < parts.length - 1 && !stat.isDirectory()) {
      throw new CatalogError(`Installation path is blocked by a non-directory: ${current}`);
    }
  }
  if (!isWithin(current, targetRoot)) {
    throw new CatalogError(`Installation path escapes target directory: ${relativePath}`);
  }
  return current;
}

function fileFingerprint(content: Buffer, executable: boolean): FileFingerprint {
  return { sha256: crypto.createHash('sha256').update(content).digest('hex'), executable };
}

function installedFingerprint(targetRoot: string, relativePath: string): FileFingerprint | null {
  const absolutePath = targetPath(targetRoot, relativePath);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(absolutePath);
  } catch (error) {
    const filesystemError = error as NodeJS.ErrnoException;
    if (filesystemError.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  if (!stat.isFile()) {
    throw new CatalogError(`Managed path is not a regular file: ${relativePath}`);
  }
  return fileFingerprint(fs.readFileSync(absolutePath), Boolean(stat.mode & 0o111));
}

function sameFingerprint(left: FileFingerprint | null, right: FileFingerprint | null): boolean | null {
  return (
    left &&
    right &&
    left.sha256 === right.sha256 &&
    (process.platform === 'win32' || left.executable === right.executable)
  );
}

function inspectInstalledFiles(
  targetRoot: string,
  record: { files: Record<string, FileFingerprint> },
): { missing: string[]; modified: string[] } {
  const missing: string[] = [];
  const modified: string[] = [];
  for (const [relativePath, expected] of Object.entries(record.files)) {
    const actual = installedFingerprint(targetRoot, relativePath);
    if (!actual) {
      missing.push(relativePath);
    } else if (!sameFingerprint(actual, expected)) {
      modified.push(relativePath);
    }
  }
  return { missing, modified };
}

function trackedPaths(state: InstallState) {
  return new Set(
    Object.values(state.sources).flatMap((collections) =>
      Object.values(collections).flatMap((records) =>
        Object.values(records).flatMap((record) => Object.keys(record.files)),
      ),
    ),
  );
}

type StagedOperation =
  | {
      action: 'remove';
      destination: string;
      previous: { content: Buffer; mode: number } | null;
      temporaryPath?: undefined;
    }
  | {
      action: 'install' | 'overwrite';
      destination: string;
      previous: { content: Buffer; mode: number } | null;
      temporaryPath: string;
    };
function writeInstallPlan(
  plan: Map<string, InstallPlanEntry>,
  target: string,
  { force = false, dryRun = false, remove = [], expectedRemovals, onAction = () => {} }: InstallPlanOptions = {},
): string[] {
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new CatalogError(`Target must be an existing directory: ${target}`);
  }
  const targetRoot = fs.realpathSync(target);
  const actions: Array<['install' | 'overwrite' | 'unchanged', string, InstallPlanEntry] | ['remove', string, null]> =
    [];
  const conflicts: string[] = [];

  for (const relativePath of remove) {
    if (plan.has(relativePath)) {
      throw new CatalogError(`Cannot both install and remove ${relativePath}`);
    }
    const actual = installedFingerprint(targetRoot, relativePath);
    if (
      expectedRemovals?.has(relativePath) &&
      !equalOptionalFingerprint(actual, expectedRemovals.get(relativePath) ?? null)
    ) {
      throw new CatalogError(
        `File changed while preparing removal: ${relativePath}. Retry after reviewing it.`,
        'LOCAL_CONFLICT',
        {
          category: 'filesystem-race',
          paths: [relativePath],
          recoverable: false,
        },
      );
    }
    if (actual) {
      actions.push(['remove', relativePath, null]);
    }
  }
  for (const [relativePath, file] of [...plan.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const { content, executable } = file;
    const destination = targetPath(targetRoot, relativePath);
    const current = installedFingerprint(targetRoot, relativePath);
    const hasExpected = Object.hasOwn(file, 'expected');
    if (hasExpected && !equalOptionalFingerprint(current, file.expected ?? null)) {
      throw new CatalogError(
        `File changed while preparing the operation: ${relativePath}. Retry after reviewing it.`,
        'LOCAL_CONFLICT',
        {
          category: 'filesystem-race',
          paths: [relativePath],
          recoverable: false,
        },
      );
    }
    let stat: fs.Stats | undefined;
    try {
      stat = fs.lstatSync(destination);
    } catch (error) {
      const filesystemError = error as NodeJS.ErrnoException;
      if (filesystemError.code !== 'ENOENT') {
        throw error;
      }
    }
    if (!stat) {
      actions.push(['install', relativePath, file]);
    } else if (stat.isSymbolicLink()) {
      throw new CatalogError(`Refusing to replace symbolic link: ${destination}`);
    } else if (!stat.isFile()) {
      throw new CatalogError(`Installation destination is not a file: ${destination}`);
    } else if (sameFingerprint(current, file.fingerprint ?? fileFingerprint(content, executable))) {
      actions.push(['unchanged', relativePath, file]);
    } else if (force || (hasExpected && file.expected !== null)) {
      actions.push(['overwrite', relativePath, file]);
    } else {
      conflicts.push(relativePath);
    }
  }

  if (conflicts.length) {
    throw new CatalogError(
      `Refusing to overwrite existing files:\n${conflicts.map((item) => `  ${item}`).join('\n')}\nPass --force to replace them.`,
      'LOCAL_CONFLICT',
      { category: 'untracked-destination', paths: conflicts, recoverable: true },
    );
  }

  const messages = actions.map(([action, relativePath]) => {
    const verb =
      action === 'remove'
        ? dryRun
          ? 'Would remove'
          : 'Removed'
        : action === 'install'
          ? dryRun
            ? 'Would install'
            : 'Installed'
          : action === 'overwrite'
            ? dryRun
              ? 'Would overwrite'
              : 'Overwrote'
            : 'Unchanged';
    return `${verb}: ${relativePath}`;
  });
  if (dryRun) {
    for (const [action, relativePath] of actions) {
      onAction({ action, path: relativePath });
    }
    return messages;
  }
  // Publish the new inventory only after resource writes and removals succeed.
  actions.sort(
    ([leftAction, left], [rightAction, right]) =>
      (left === LOCK_PATH ? 2 : leftAction === 'remove' ? 1 : 0) -
      (right === LOCK_PATH ? 2 : rightAction === 'remove' ? 1 : 0),
  );
  const staged: StagedOperation[] = [];
  const changed: StagedOperation[] = [];
  try {
    for (const [action, relativePath, file] of actions) {
      if (action === 'unchanged') continue;
      const destination = targetPath(targetRoot, relativePath);
      const previous =
        action === 'install'
          ? null
          : {
              content: fs.readFileSync(destination),
              mode: fs.statSync(destination).mode & 0o7777,
            };
      if (action === 'remove') {
        staged.push({ action, destination, previous });
        continue;
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      targetPath(targetRoot, relativePath);
      const temporaryPath = path.join(
        path.dirname(destination),
        `.${path.basename(destination)}.catalog-${process.pid}-${crypto.randomUUID()}`,
      );
      const mode = file.mode ?? (file.executable ? 0o755 : 0o644);
      staged.push({ action, destination, temporaryPath, previous });
      fs.writeFileSync(temporaryPath, file.content, { flag: 'wx', mode });
      if (process.platform !== 'win32') fs.chmodSync(temporaryPath, mode);
    }
    for (const item of staged) {
      if (item.action === 'remove') fs.unlinkSync(item.destination);
      else fs.renameSync(item.temporaryPath, item.destination);
      changed.push(item);
    }
  } catch (error) {
    for (const item of changed.reverse()) {
      if (!item.previous) {
        fs.unlinkSync(item.destination);
      } else if (item.action === 'remove') {
        fs.writeFileSync(item.destination, item.previous.content, { mode: item.previous.mode });
        if (process.platform !== 'win32') fs.chmodSync(item.destination, item.previous.mode);
      } else {
        const restorePath = path.join(
          path.dirname(item.destination),
          `.${path.basename(item.destination)}.catalog-restore-${process.pid}-${crypto.randomUUID()}`,
        );
        fs.writeFileSync(restorePath, item.previous.content, {
          flag: 'wx',
          mode: item.previous.mode,
        });
        if (process.platform !== 'win32') fs.chmodSync(restorePath, item.previous.mode);
        fs.renameSync(restorePath, item.destination);
      }
    }
    throw error;
  } finally {
    for (const item of staged) {
      if (!item.temporaryPath) continue;
      try {
        fs.unlinkSync(item.temporaryPath);
      } catch (error) {
        const filesystemError = error as NodeJS.ErrnoException;
        if (filesystemError.code !== 'ENOENT') throw error;
      }
    }
  }
  return messages;
}

function equalOptionalFingerprint(left: FileFingerprint | null, right: FileFingerprint | null): boolean {
  return (
    (!left && !right) || Boolean(left && right && left.sha256 === right.sha256 && left.executable === right.executable)
  );
}

function addInventoryStateToPlan(plan: Map<string, InstallPlanEntry>, state: InstallState) {
  addPlanEntry(plan, LOCK_PATH, Buffer.from(`${JSON.stringify(state, null, 2)}\n`));
}

export {
  targetPath,
  fileFingerprint,
  installedFingerprint,
  sameFingerprint,
  inspectInstalledFiles,
  trackedPaths,
  writeInstallPlan,
  addInventoryStateToPlan,
};
