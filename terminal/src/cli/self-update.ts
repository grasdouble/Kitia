import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { promisify } from 'node:util';

import { CatalogError } from '../core/resources/model.js';

const exec = promisify(execFile);
const packageName = '@grasdouble/kitia';
const entryPath = path.join('dist', 'kitia.js');
const managers = {
  npm: { inspect: ['root', '--global'], update: ['install', '--global', `${packageName}@latest`] },
  pnpm: {
    inspect: ['list', '--global', '--depth=0', '--json'],
    update: ['update', '--global', '--latest', packageName],
  },
};
type Manager = keyof typeof managers;
type Installation = { manager: Manager; location: string };
type PnpmProject = {
  path?: string;
  dependencies?: Record<string, { from?: string; path?: string; version?: string; resolved?: string }>;
};

const selfUpdateUnavailable =
  'No matching global npm or pnpm installation was found. Update with your original installer. ' +
  'For one-off runs, use npx --yes @grasdouble/kitia@latest or pnpm dlx @grasdouble/kitia@latest.';

function managerCommand(manager: Manager, args: string[]): [string, string[]] {
  // Windows package managers may be batch shims. Only fixed, internal arguments go through cmd.exe.
  return process.platform === 'win32'
    ? [process.env.ComSpec || 'cmd.exe', ['/d', '/c', [manager, ...args].join(' ')]]
    : [manager, args];
}

async function real(file: string): Promise<string | undefined> {
  return realpath(file).catch(() => undefined);
}

async function inspect(manager: Manager, entry: string, running: string, cwd: string): Promise<Installation[]> {
  try {
    const [file, args] = managerCommand(manager, managers[manager].inspect);
    const { stdout } = await exec(file, args, { cwd, timeout: 10_000, windowsHide: true });
    if (manager === 'npm') {
      const root = stdout.trim();
      if (!path.isAbsolute(root)) return [];
      const canonicalRoot = await real(root);
      if (!canonicalRoot) return [];
      const location = path.join(canonicalRoot, packageName);
      // A global npm link to a checkout does not make that checkout an owned global install.
      return running === path.join(location, entryPath) ? [{ manager, location }] : [];
    }

    const projects = JSON.parse(stdout) as PnpmProject[];
    const modulesPath = path.dirname(path.dirname(path.dirname(path.dirname(entry))));
    if (path.basename(modulesPath) !== 'node_modules' || entry !== path.join(modulesPath, packageName, entryPath)) {
      return [];
    }
    const entryModules = await real(modulesPath);
    if (!entryModules) return [];
    const matches = new Set<string>();
    for (const project of projects) {
      const dependency = project.dependencies?.[packageName];
      if (
        dependency?.from !== packageName ||
        dependency.version?.startsWith('link:') ||
        dependency.resolved?.startsWith('link:') ||
        !dependency.path ||
        !path.isAbsolute(dependency.path)
      ) {
        continue;
      }
      // pnpm can share a real package across global, local, and dlx installs. Match the launcher’s
      // node_modules directory as well as the executable, not just their shared store target.
      const modules = await real(path.dirname(path.dirname(dependency.path)));
      const projectModules =
        project.path && path.isAbsolute(project.path) ? await real(path.join(project.path, 'node_modules')) : undefined;
      if (
        (modules === entryModules || projectModules === entryModules) &&
        running === (await real(path.join(dependency.path, entryPath)))
      ) {
        matches.add(path.join(entryModules, packageName));
      }
    }
    return [...matches].map((location) => ({ manager, location }));
  } catch {
    // An unavailable manager or unrecognized global listing is not proof of ownership.
    return [];
  }
}

export async function prepareSelfUpdate(entry = process.argv[1]) {
  if (!entry) return null;
  const cwd = homedir();
  async function detect(): Promise<Installation | undefined> {
    const running = await real(entry);
    if (!running) return;
    const candidates = (
      await Promise.all([inspect('npm', entry, running, cwd), inspect('pnpm', entry, running, cwd)])
    ).flat();
    return candidates.length === 1 ? candidates[0] : undefined;
  }
  const installation = await detect();
  if (!installation) return null;
  const { manager, location } = installation;
  return {
    manager,
    async apply() {
      const current = await detect();
      if (current?.manager !== manager || current.location !== location) {
        throw new CatalogError(selfUpdateUnavailable, 'SELF_UPDATE_UNAVAILABLE');
      }
      const [file, args] = managerCommand(manager, managers[manager].update);
      const child = spawn(file, args, { cwd, stdio: 'inherit' });
      const [code, signal] = (await once(child, 'close')) as [number | null, NodeJS.Signals | null];
      if (code !== 0) {
        throw new CatalogError(
          `${manager} could not update Kitia (${signal ?? `exit ${code}`}).`,
          'SELF_UPDATE_FAILED',
        );
      }
      console.log('Kitia is up to date. Restart Kitia to use the installed version.');
    },
  };
}

export async function runSelfUpdate(yes: boolean, nonInteractive: boolean) {
  const update = await prepareSelfUpdate();
  if (!update) throw new CatalogError(selfUpdateUnavailable, 'SELF_UPDATE_UNAVAILABLE');
  if (!yes) {
    if (nonInteractive || !process.stdin.isTTY || !process.stdout.isTTY) {
      throw new CatalogError(
        'Use kitia self-update --yes to confirm non-interactively.',
        'SELF_UPDATE_CONFIRMATION_REQUIRED',
      );
    }
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await prompt.question(`Update Kitia globally with ${update.manager}? [y/N] `);
      if (!/^y(?:es)?$/i.test(answer.trim())) return 0;
    } finally {
      prompt.close();
    }
  }
  await update.apply();
  return 0;
}
