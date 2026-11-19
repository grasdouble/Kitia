import { execFileSync, execFile } from 'node:child_process';

import { CatalogError } from './model.js';
import type { CatalogError as CatalogErrorType, CatalogResource } from './model.js';

interface SourceVersion {
  sha: string;
  date: string;
  subject: string;
}
interface SourceVersionCommitInput {
  sha?: unknown;
  commit?: {
    committer?: { date?: unknown } | null;
    message?: unknown;
  } | null;
}
interface HistoryProcessError {
  stderr?: unknown;
  message?: unknown;
}
function errorDetail(error: unknown): string {
  const details = error as HistoryProcessError;
  return String(details.stderr || details.message || 'unknown error')
    .trim()
    .slice(0, 500);
}
const SOURCE_VERSION_PAGE_SIZE = 100;
const SOURCE_VERSION_MAX = 500;
function sourceHistoryPath(resource: CatalogResource): string | null {
  const { source_repository: repository, source_path: sourcePath } = resource;
  if (
    typeof repository !== 'string' ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
    typeof sourcePath !== 'string' ||
    !sourcePath ||
    sourcePath.startsWith('/') ||
    sourcePath.includes('\\') ||
    /[\u0000-\u001f\u007f-\u009f]/.test(sourcePath) ||
    sourcePath.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    return null;
  }
  if (resource.kind === 'skill') return `${sourcePath}/SKILL.md`;
  if ((resource.kind === 'agent' || resource.kind === 'instruction') && /\.md$/i.test(sourcePath)) {
    return sourcePath;
  }
  return null;
}
function latestSourceVersionAtRef(
  resource: CatalogResource,
  ref: string,
  run: typeof execFileSync = execFileSync,
): string | null {
  const historyPath = sourceHistoryPath(resource);
  if (!historyPath) return null;
  let response: string;
  try {
    response = run(
      'gh',
      [
        'api',
        '-X',
        'GET',
        `repos/${resource.source_repository}/commits`,
        '-f',
        `path=${historyPath}`,
        '-f',
        `sha=${ref}`,
        '-F',
        'per_page=1',
      ],
      {
        encoding: 'utf8',
        timeout: 30000,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch (error) {
    const detail = errorDetail(error);
    throw new CatalogError(
      `Cannot check GitHub source history for ${resource.source_repository}/${historyPath}: ${detail}`,
    );
  }
  let commits: unknown;
  try {
    commits = JSON.parse(response);
  } catch {
    throw new CatalogError('GitHub CLI returned invalid JSON while checking source history.');
  }
  const latestCommit: unknown = Array.isArray(commits) && commits.length === 1 ? commits[0] : undefined;
  if (
    !latestCommit ||
    typeof latestCommit !== 'object' ||
    !('sha' in latestCommit) ||
    typeof latestCommit.sha !== 'string' ||
    !/^[a-f0-9]{40}$/i.test(latestCommit.sha)
  ) {
    throw new CatalogError('GitHub CLI returned an invalid source-history response.');
  }
  return latestCommit.sha.toLowerCase();
}
function validateSourceVersionResource(resource: CatalogResource): void {
  if (!resource.source_repository || !sourceHistoryPath(resource)) {
    throw new CatalogError(
      'Commit history is available only for GitHub source resources with supported file paths.',
      'INVALID_ARGUMENT',
    );
  }
}
function sourceVersionArguments(resource: CatalogResource, page: number): string[] {
  const historyPath = sourceHistoryPath(resource);
  if (!historyPath) throw new CatalogError('Source resource has no supported GitHub history path.');
  return [
    'api',
    '-X',
    'GET',
    `repos/${resource.source_repository}/commits`,
    '-f',
    `path=${historyPath}`,
    '-F',
    `per_page=${SOURCE_VERSION_PAGE_SIZE}`,
    '-F',
    `page=${page}`,
  ];
}
function parseSourceVersionPage(response: string): { commits: unknown[]; versions: SourceVersion[] } {
  let commits: unknown;
  try {
    commits = JSON.parse(response);
  } catch {
    throw new CatalogError('GitHub CLI returned invalid JSON while listing source commit history.');
  }
  if (!Array.isArray(commits)) {
    throw new CatalogError('GitHub CLI returned an invalid commit-history response.');
  }
  const versions: SourceVersion[] = [];
  for (const rawEntry of commits as unknown[]) {
    const entry = rawEntry as SourceVersionCommitInput | null | undefined;
    const sha = entry?.sha;
    const commit = entry?.commit;
    const date = commit?.committer?.date;
    const message = commit?.message;
    if (
      !/^[a-f0-9]{40}$/i.test((sha || '') as string) ||
      typeof date !== 'string' ||
      !Number.isFinite(Date.parse(date)) ||
      typeof message !== 'string' ||
      !message.trim()
    ) {
      throw new CatalogError('GitHub CLI returned an invalid commit in source history.');
    }
    versions.push({
      sha: (sha as string).toLowerCase(),
      date,
      subject: message.split(/\r?\n/, 1)[0],
    });
  }
  return { commits, versions };
}
function sourceHistoryFailure(resource: CatalogResource, error: unknown): CatalogErrorType {
  const detail = errorDetail(error);
  return new CatalogError(
    `Cannot list GitHub commit history for ${resource.source_repository}/${sourceHistoryPath(resource) || resource.source_path}: ${detail}`,
  );
}
const runExecFile = (
  program: string,
  args: string[],
  options: { encoding: 'utf8'; timeout: number },
): Promise<string> => {
  const { promise, resolve, reject } = (
    Promise as PromiseConstructor & {
      withResolvers<T>(): {
        promise: Promise<T>;
        resolve(value: T): void;
        reject(reason?: unknown): void;
      };
    }
  ).withResolvers<string>();
  execFile(program, args, options, (error, stdout, stderr) => {
    if (error) {
      const processError = error as NodeJS.ErrnoException & { stderr?: string };
      processError.stderr = stderr;
      reject(error);
    } else {
      resolve(stdout);
    }
  });
  return promise;
};
function listSourceVersions(resource: CatalogResource, run = execFileSync): SourceVersion[] {
  validateSourceVersionResource(resource);
  const versions: SourceVersion[] = [];
  for (let page = 1; page <= SOURCE_VERSION_MAX / SOURCE_VERSION_PAGE_SIZE; page += 1) {
    let response: string;
    try {
      response = run('gh', sourceVersionArguments(resource, page), {
        encoding: 'utf8',
        timeout: 30000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      throw sourceHistoryFailure(resource, error);
    }
    const parsed = parseSourceVersionPage(response);
    versions.push(...parsed.versions);
    if (parsed.commits.length < SOURCE_VERSION_PAGE_SIZE || versions.length >= SOURCE_VERSION_MAX) break;
  }
  return versions;
}
async function listSourceVersionsAsync(resource: CatalogResource, run = runExecFile): Promise<SourceVersion[]> {
  validateSourceVersionResource(resource);
  const versions: SourceVersion[] = [];
  for (let page = 1; page <= SOURCE_VERSION_MAX / SOURCE_VERSION_PAGE_SIZE; page += 1) {
    let response: string;
    try {
      response = await run('gh', sourceVersionArguments(resource, page), {
        encoding: 'utf8',
        timeout: 30000,
      });
    } catch (error) {
      throw sourceHistoryFailure(resource, error);
    }
    const parsed = parseSourceVersionPage(response);
    versions.push(...parsed.versions);
    if (parsed.commits.length < SOURCE_VERSION_PAGE_SIZE || versions.length >= SOURCE_VERSION_MAX) break;
  }
  return versions;
}
function uniqueSourceVersionPrefixes(versions: SourceVersion[]): string[] {
  return versions.map(({ sha }) => {
    let length = 7;
    while (
      length < 40 &&
      versions.some((version) => version.sha !== sha && version.sha.startsWith(sha.slice(0, length)))
    ) {
      length += 1;
    }
    return sha.slice(0, length);
  });
}
function resolveSourceVersionPrefix(versions: SourceVersion[], prefix: string): string {
  const matches = versions.filter(({ sha }) => sha.startsWith(prefix.toLowerCase()));
  if (matches.length !== 1) {
    throw new CatalogError(
      matches.length
        ? `Commit prefix '${prefix}' is ambiguous.`
        : `Commit prefix '${prefix}' was not found in source history.`,
      matches.length ? 'AMBIGUOUS_RESOURCE' : 'RESOURCE_NOT_FOUND',
    );
  }
  return matches[0].sha;
}

export {
  listSourceVersions,
  listSourceVersionsAsync,
  latestSourceVersionAtRef,
  uniqueSourceVersionPrefixes,
  resolveSourceVersionPrefix,
};
