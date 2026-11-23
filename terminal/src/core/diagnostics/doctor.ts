import type { SpawnSyncOptionsWithStringEncoding } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

import { loadUserSourceConfiguration } from '../catalogs/config.js';
import type { SourceConfiguration } from '../catalogs/model.js';
import { inspectOperationLock, OPERATION_LOCK } from '../installations/lock.js';
import { readInstallState } from '../inventory/inventory.js';
type DiagnosticCheck = {
  id: string;
  status: 'ok' | 'error' | 'warning' | 'skipped';
  message: string;
};
type ProbeResult = { status: number | null; stdout: string; stderr: string };
/** @param {{ target?: string; network?: boolean }} [options] @param {(command: string, args: string[], options: SpawnSyncOptionsWithStringEncoding) => ProbeResult} [spawn] */
function diagnose({ target = '.', network = false } = {}, spawn = spawnSync) {
  /** @type {DiagnosticCheck[]} */
  const checks: DiagnosticCheck[] = [];
  const add = (id: string, status: DiagnosticCheck['status'], message: string) => checks.push({ id, status, message });
  let sources: SourceConfiguration[] = [];
  try {
    sources = loadUserSourceConfiguration();
    add('source-config', 'ok', `Loaded ${sources.length} configured skill source(s).`);
  } catch (error) {
    const { message } = error as { message: string };
    add('source-config', 'error', message);
  }
  add(
    'node',
    Number(process.versions.node.split('.')[0]) >= 26 ? 'ok' : 'error',
    `Node.js ${process.versions.node}; version 26 or later is required.`,
  );
  const probe = (command: string, args: string[]) =>
    spawn(command, args, {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GH_PROMPT_DISABLED: '1' },
    });
  const git = probe('git', ['--version']);
  add(
    'git',
    git.status === 0 ? 'ok' : 'error',
    git.status === 0 ? git.stdout.trim() : 'Git is unavailable. Install Git and ensure it is on PATH.',
  );
  const gh = probe('gh', ['--version']);
  add(
    'gh',
    gh.status === 0 ? 'ok' : 'warning',
    gh.status === 0
      ? gh.stdout.split('\n')[0]
      : 'GitHub CLI is unavailable; source catalog refresh, preview and installation require it.',
  );
  if (gh.status === 0) {
    const skill = probe('gh', ['skill', '--help']);
    add(
      'gh-skill',
      skill.status === 0 ? 'ok' : 'warning',
      skill.status === 0 ? 'GitHub CLI supports gh skill.' : 'Upgrade GitHub CLI to a version supporting gh skill.',
    );
  }
  try {
    if (!fs.statSync(target).isDirectory()) throw new Error('Not a directory');
    const root = fs.realpathSync(target);
    fs.accessSync(root, fs.constants.R_OK | fs.constants.W_OK);
    add('target', 'ok', 'Target directory is readable and writable.');
    readInstallState(root);
    add('inventory', 'ok', 'Installation inventory is readable and valid (or not yet created).');
    const lock = inspectOperationLock(root);
    add(
      'operation-lock',
      lock.status === 'absent' ? 'ok' : 'warning',
      lock.status === 'absent'
        ? 'No operation is holding this target.'
        : lock.status === 'stale'
          ? `The recorded operation has exited. Review its changes, then explicitly remove ${OPERATION_LOCK} before retrying.`
          : `An active or unknown operation lock exists (${OPERATION_LOCK}); do not remove it while an operation may be running.`,
    );
  } catch (error) {
    const { message } = error as { message: string };
    add('target-inventory', 'error', message);
  }
  if (network && gh.status === 0) {
    const auth = probe('gh', ['auth', 'status', '--active']);
    add(
      'github-auth',
      auth.status === 0 ? 'ok' : 'error',
      auth.status === 0
        ? 'GitHub CLI authentication is available.'
        : 'Authenticate GitHub CLI with access to the required repositories.',
    );
    if (auth.status === 0) {
      const repositories = [...new Set(sources.map((source: SourceConfiguration) => source.repositoryId))];
      for (const repository of repositories) {
        const access = probe('gh', ['api', '--hostname', 'github.com', `repos/${repository}`, '--silent']);
        add(
          `access:${repository}`,
          access.status === 0 ? 'ok' : 'error',
          access.status === 0
            ? `GitHub CLI can read ${repository}.`
            : `Cannot read ${repository}; check permissions and connectivity.`,
        );
      }
    }
  } else {
    add(
      'network',
      'skipped',
      network
        ? 'Network checks require GitHub CLI.'
        : 'No network checks requested. Use --network to check GitHub authentication and repository access.',
    );
  }
  return {
    checks,
    attention: checks.some(({ status }) => status === 'error' || status === 'warning'),
  };
}

export { diagnose };
