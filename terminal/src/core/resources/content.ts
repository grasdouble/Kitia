import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { CatalogResource } from './model.js';
import { CatalogError } from './model.js';
function isWithin(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function readUtf8(filePath: string, label = 'file'): string {
  const content = fs.readFileSync(filePath);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    throw new CatalogError(`${label} is not valid UTF-8: ${filePath}`);
  }
}

class PreparedPinnedSourceFile {
  private constructor(
    readonly resource: Readonly<CatalogResource>,
    readonly path: string,
    readonly content: Buffer,
  ) {
    Object.freeze(this);
  }

  static acquire(resource: CatalogResource, acquisition: PinnedSourceAcquisition): PreparedPinnedSourceFile {
    if (!resource.source_repository || !resource.source_ref) {
      throw new CatalogError('Retrieval only supports pinned source-catalog resources', 'INVALID_ARGUMENT');
    }
    if (!resource.source_path) throw new CatalogError('Source resource has no pinned path', 'INVALID_ARGUMENT');
    const pinned = Object.freeze({ ...resource });
    const filePath =
      resource.kind === 'skill' ? `${resource.source_path.replace(/\/$/, '')}/SKILL.md` : resource.source_path;
    return new PreparedPinnedSourceFile(
      pinned,
      filePath,
      acquisition.read(resource.source_repository, resource.source_ref, filePath),
    );
  }
}

function preparePinnedSourceFile(resource: CatalogResource): PreparedPinnedSourceFile {
  return withPinnedSourceFiles((prepare) => prepare(resource));
}

export function withPinnedSourceFiles<T>(use: (prepare: typeof preparePinnedSourceFile) => T): T {
  const acquisition = new PinnedSourceAcquisition();
  try {
    return use((resource) => PreparedPinnedSourceFile.acquire(resource, acquisition));
  } finally {
    acquisition.close();
  }
}

export function isPreparedPinnedSourceFile(
  source: CatalogResource | PreparedPinnedSourceFile,
): source is PreparedPinnedSourceFile {
  return source instanceof PreparedPinnedSourceFile;
}

class PinnedSourceAcquisition {
  private temporaryRoot?: string;
  private readonly checkouts = new Map<string, string>();

  private checkout(repository: string, ref: string): string {
    const key = `${repository.toLowerCase()}@${ref.toLowerCase()}`;
    const existing = this.checkouts.get(key);
    if (existing) return existing;

    this.temporaryRoot ??= fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-source-file-'));
    const checkout = path.join(this.temporaryRoot, `repository-${this.checkouts.size}`);
    const options = {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    } satisfies ExecFileSyncOptionsWithStringEncoding;
    execFileSync('git', ['clone', '--quiet', '--no-checkout', `https://github.com/${repository}.git`, checkout], {
      ...options,
      timeout: 120000,
    });
    execFileSync('git', ['-C', checkout, 'checkout', '--quiet', '--detach', ref], { ...options, timeout: 60000 });
    const actualRef = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (actualRef.toLowerCase() !== ref.toLowerCase()) {
      throw new CatalogError('Retrieved source commit does not match the catalog pin');
    }
    this.checkouts.set(key, checkout);
    return checkout;
  }

  read(repository: string, ref: string, relative: string): Buffer {
    if (!/^[a-f0-9]{40}$/i.test(ref)) throw new CatalogError('Source resource has no pinned commit SHA');
    try {
      if (
        typeof relative !== 'string' ||
        !relative ||
        relative.startsWith('/') ||
        relative.includes('\\') ||
        relative.split('/').some((part) => !part || part === '.' || part === '..')
      ) {
        throw new CatalogError(`Unsafe source resource path: ${relative}`);
      }
      let current = this.checkout(repository, ref);
      for (const part of relative.split('/')) {
        current = path.join(current, part);
        if (fs.lstatSync(current).isSymbolicLink())
          throw new CatalogError(`Refusing symbolic link in pinned source path: ${relative}`);
      }
      if (!fs.statSync(current).isFile())
        throw new CatalogError(`Pinned source resource is not a regular file: ${relative}`);
      return fs.readFileSync(current);
    } catch (error) {
      if (error instanceof CatalogError) throw error;
      const detail = error && typeof error === 'object' && 'message' in error ? error.message : undefined;
      throw new CatalogError(`Cannot retrieve pinned source file ${repository}/${relative}@${ref}: ${String(detail)}`);
    }
  }

  close(): void {
    if (this.temporaryRoot) fs.rmSync(this.temporaryRoot, { recursive: true, force: true });
  }
}

export { isWithin, readUtf8, preparePinnedSourceFile };

export type { PreparedPinnedSourceFile };
