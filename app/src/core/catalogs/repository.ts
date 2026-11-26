import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { CatalogError } from '../resources/model.js';
import type { SourceCatalogIndex } from './discovery.js';
import { createSourceIndex } from './discovery.js';
import type { SourceConfiguration } from './model.js';

type ExecFileAsync = (
  file: string,
  args: readonly string[],
  options: { encoding: 'utf8'; timeout: number; env: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string }>;
const execFileAsync = promisify(execFile) as ExecFileAsync;

function fetchSourceIndex(source: SourceConfiguration): SourceCatalogIndex {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-catalog-'));
  try {
    const checkout = path.join(temporaryRoot, 'checkout');
    execFileSync('git', ['clone', '--quiet', '--depth', '1', source.repository, checkout], {
      encoding: 'utf8',
      timeout: 120000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return createSourceIndex(source.repository, source.name, checkout, source);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

async function remoteHead(repository: string, run: typeof execFileAsync = execFileAsync): Promise<string> {
  const { stdout } = await run('git', ['ls-remote', '--symref', repository, 'HEAD'], {
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  const match = String(stdout).match(/^([a-f0-9]{40})\tHEAD$/im);
  if (!match) throw new CatalogError(`Cannot resolve the default branch of ${repository}`);
  return match[1].toLowerCase();
}

export { fetchSourceIndex, remoteHead };
