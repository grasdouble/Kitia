import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CatalogError } from '../resources/model.js';
interface LockOwner {
  pid: number;
  host: string;
  token: string;
}

type OperationLockStatus =
  | { status: 'absent'; owner?: undefined }
  | { status: 'unknown'; message?: string; owner?: LockOwner }
  | { status: 'active' | 'stale'; owner: LockOwner };

const OPERATION_LOCK = '.kitia-operation.lock';

function inspectOperationLock(target: string): OperationLockStatus {
  const file = path.join(fs.realpathSync(target), OPERATION_LOCK);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;
    if (fileError.code === 'ENOENT') return { status: 'absent' };
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return { status: 'unknown', message: 'The operation lock is not a regular file.' };
  }
  let owner: unknown;
  try {
    owner = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { status: 'unknown', message: 'The operation lock is incomplete or invalid.' };
  }
  if (!owner || typeof owner !== 'object' || Array.isArray(owner)) {
    return { status: 'unknown', message: 'The operation lock has invalid ownership metadata.' };
  }
  const pid = 'pid' in owner ? owner.pid : undefined;
  const host = 'host' in owner ? owner.host : undefined;
  const token = 'token' in owner ? owner.token : undefined;
  if (
    typeof pid !== 'number' ||
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    typeof host !== 'string' ||
    typeof token !== 'string'
  ) {
    return { status: 'unknown', message: 'The operation lock has invalid ownership metadata.' };
  }
  const lockOwner = owner as LockOwner;
  if (lockOwner.host !== os.hostname()) return { status: 'unknown', owner: lockOwner };
  try {
    process.kill(lockOwner.pid, 0);
    return { status: 'active', owner: lockOwner };
  } catch (error) {
    const processError = error as NodeJS.ErrnoException;
    if (processError.code === 'ESRCH') return { status: 'stale', owner: lockOwner };
    if (processError.code === 'EPERM') return { status: 'active', owner: lockOwner };
    throw error;
  }
}
function acquireOperationLock(target: string): () => void {
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new CatalogError(`Target must be an existing directory: ${target}`, 'INVALID_TARGET');
  }
  const root = fs.realpathSync(target);
  const file = path.join(root, OPERATION_LOCK);
  const token = crypto.randomUUID();
  let descriptor: number;
  try {
    descriptor = fs.openSync(file, 'wx', 0o600);
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;
    if (fileError.code !== 'EEXIST') throw error;
    const lock = inspectOperationLock(root);
    const recovery =
      lock.status === 'stale'
        ? 'The recorded process no longer exists. Review the interrupted operation and remove this lock explicitly before retrying.'
        : 'Wait for the other operation to finish. Do not remove an active or unknown lock.';
    throw new CatalogError(
      `Target operation is locked: ${file}${lock.owner ? ` (PID ${lock.owner.pid}, host ${lock.owner.host})` : ''}. ${recovery}`,
      lock.status === 'stale' ? 'STALE_OPERATION_LOCK' : 'OPERATION_LOCKED',
    );
  }
  try {
    fs.writeFileSync(
      descriptor,
      `${JSON.stringify({
        pid: process.pid,
        host: os.hostname(),
        token,
        started_at: new Date().toISOString(),
      })}\n`,
    );
  } catch (error) {
    fs.closeSync(descriptor);
    fs.unlinkSync(file);
    throw error;
  }
  fs.closeSync(descriptor);
  return () => {
    const lock = inspectOperationLock(root);
    if (lock.owner?.token !== token) {
      throw new CatalogError(
        `Operation lock ownership changed: ${file}; refusing to remove it.`,
        'OPERATION_LOCK_CHANGED',
      );
    }
    fs.unlinkSync(file);
  };
}

export { OPERATION_LOCK, acquireOperationLock, inspectOperationLock };
