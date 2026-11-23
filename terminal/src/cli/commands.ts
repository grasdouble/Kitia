import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import { loadUserSourceConfiguration, userCatalogDirectory } from '../core/catalogs/config.js';
import type { CatalogLoadWarning } from '../core/catalogs/indexes.js';
import { checkCatalogFreshness } from '../core/catalogs/manage.js';
import type { SourceConfiguration, UserCatalog } from '../core/catalogs/model.js';
import { importCollectionText } from '../core/collections/import.js';
import { collectionData } from '../core/collections/manifest.js';
import { signCollectionManifest } from '../core/collections/signatures.js';
import { diagnose } from '../core/diagnostics/doctor.js';
import type { AuditResult } from '../core/inspection/audit.js';
import { executeInstallationOperation, type InstallationMessage } from '../core/installations/lifecycle.js';
import { checkInstalledResources, collectInstalledScopes } from '../core/inventory/checks.js';
import { listSourceVersions, listSourceVersionsAsync, uniqueSourceVersionPrefixes } from '../core/resources/history.js';
import { CatalogError, type CatalogResource } from '../core/resources/model.js';
import { catalogEntries, enrichInstalledResources, listCatalogResources } from '../core/resources/queries.js';
import { resolveCatalogResource } from '../core/resources/selection.js';
import type { DashboardActionResult } from '../tui/action-result.js';
import type { CatalogActionResult, CatalogMutationResult, DashboardActions } from '../tui/contracts.js';
import {
  browseInstalledResources,
  formatCatalogTable,
  renderInstalledResources,
  selectCatalogResource,
} from '../tui/terminal.js';
import { parseArguments, printHelp, type ParsedCliOptions } from './arguments.js';
import { manageCatalogCommand } from './catalog-command.js';
import { formatSourceVersionTable } from './history.js';
import { formatAuditLines } from './inspection-format.js';
import { loadCommandCatalogs } from './loading.js';
import type { CliReport } from './report.js';
import { formatSourceResource } from './resource-format.js';
import { prepareSelfUpdate, runSelfUpdate } from './self-update.js';

type LoadedCatalogs = { sourceResources: CatalogResource[]; unavailable: string[] };
type DashboardWorkerMessage<Result> =
  | { progress: string; ok?: never }
  | { progress?: string; ok: true; result: Result }
  | {
      progress?: string;
      ok: false;
      error: {
        name: string;
        message: string;
        code?: string;
        category?: string;
        paths?: string[];
        recoverable?: boolean;
        userMessage?: string;
        agent?: string;
      };
    };

function runDashboardWorker<Result>(
  data: Record<string, unknown>,
  onProgress: (message: string) => void = () => {},
  { execArgv }: { execArgv?: string[] } = {},
): Promise<Result> {
  return new Promise<Result>((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'dashboard-worker.js'), {
      workerData: data,
      execArgv,
    });
    let settled = false;
    worker.on('message', (message: DashboardWorkerMessage<Result>) => {
      if (typeof message.progress === 'string') {
        onProgress(message.progress);
        return;
      }
      if (settled || !('ok' in message)) return;
      settled = true;
      if (message.ok) {
        resolve(message.result);
        return;
      }
      if ('error' in message) {
        const error = Object.assign(new Error(message.error.message), message.error);
        error.name = message.error.name;
        reject(error);
      }
    });
    worker.once('error', (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    worker.once('exit', (code: number) => {
      if (settled) return;
      settled = true;
      reject(new Error(`Dashboard worker exited before returning a result (exit ${code}).`));
    });
  });
}

function copyTextToClipboard(text: string): void {
  if (process.platform === 'darwin') {
    execFileSync('pbcopy', [], { input: text });
    return;
  }
  if (process.platform === 'win32') {
    execFileSync('clip', [], { input: text });
    return;
  }
  for (const [program, args] of [
    ['wl-copy', []],
    ['xclip', ['-selection', 'clipboard']],
  ] satisfies [string, string[]][]) {
    try {
      execFileSync(program, args, { input: text });
      return;
    } catch {}
  }
  throw new Error('Clipboard access requires wl-copy or xclip on Linux.');
}
function selectedSourceResource(
  resources: CatalogResource[],
  options: Pick<ParsedCliOptions, 'id' | 'kind' | 'nonInteractive'>,
): Promise<CatalogResource | null> {
  return resolveCatalogResource(
    resources,
    options.id!,
    options.kind,
    options.nonInteractive
      ? (candidates: CatalogResource[]) => {
          throw new CatalogError(
            `Resource '${options.id}' is ambiguous: ${candidates.map((entry) => `${entry.catalog}:${entry.kind}:${entry.id}`).join(', ')}. Specify a kind and source catalog where needed.`,
            'AMBIGUOUS_RESOURCE',
          );
        }
      : selectCatalogResource,
  );
}

function shouldShowOnboarding() {
  return (
    process.stdin.isTTY &&
    process.stdout.isTTY &&
    !fs.existsSync(path.join(userCatalogDirectory(), 'onboarding-complete'))
  );
}

function markOnboardingComplete() {
  const directory = userCatalogDirectory();
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'onboarding-complete'), '1\n');
}

async function executeCommand(options: ParsedCliOptions, report?: CliReport): Promise<number> {
  const output = options.output || console;
  if (options.command === 'onboarding') {
    options.command = 'dashboard';
    options.showOnboarding = true;
  } else if (options.command === 'dashboard') {
    options.showOnboarding = shouldShowOnboarding();
  }
  if (
    options.showOnboarding &&
    process.stdin.isTTY &&
    process.stdout.isTTY &&
    typeof process.stdin.setRawMode === 'function'
  )
    markOnboardingComplete();
  if (options.scope === 'user') output.log(`User scope: ${options.target}`);
  if (options.command === 'help') {
    printHelp();
    return 0;
  }
  if (options.command === 'self-update') {
    return runSelfUpdate(Boolean(options.yes), Boolean(options.nonInteractive));
  }

  if (options.command === 'collection') {
    if (options.action === 'export') {
      const { sourceResources }: LoadedCatalogs = loadCommandCatalogs({ command: 'list' });
      const unsigned = collectionData(sourceResources, loadUserSourceConfiguration(), options.resourceSelectors!);
      const signed = options.signingKey
        ? signCollectionManifest(unsigned, fs.readFileSync(path.resolve(options.signingKey)))
        : undefined;
      fs.writeFileSync(path.resolve(options.file!), `${JSON.stringify(signed ?? unsigned, null, 2)}\n`, {
        flag: 'w',
      });
      output.log(`Exported resource collection to ${options.file}.`);
      if (signed) output.log(`Signature key fingerprint: ${signed.signature.key_id}`);
      return 0;
    }
    const contents = fs.readFileSync(path.resolve(options.file!), 'utf8');
    const trustedKey = options.trustedKey ? fs.readFileSync(path.resolve(options.trustedKey)) : undefined;
    const names = importCollectionText(contents, undefined, { trustedKey });
    output.log(`Imported resource collection: ${names.length} catalog${names.length === 1 ? '' : 's'} registered.`);
    for (const name of names) output.log(`Added pinned catalog: ${name}`);
    output.log('Resource contents are not included; installation requires retrieving the pinned upstream commit.');
    return 0;
  }
  if (options.command === 'catalog') return manageCatalogCommand(options);
  if (options.command === 'versions') {
    const { sourceResources }: LoadedCatalogs = loadCommandCatalogs({ ...options, command: 'list' });
    const candidates = sourceResources.filter(
      (entry) =>
        entry.kind === options.kind &&
        entry.id === options.id &&
        entry.source_repository &&
        entry.source_path &&
        (!options.catalog || entry.catalog === options.catalog),
    );
    if (!candidates.length) {
      throw new CatalogError(`GitHub source ${options.kind} not found: ${options.id}`, 'RESOURCE_NOT_FOUND');
    }
    if (candidates.length > 1) {
      throw new CatalogError(
        `${options.kind} '${options.id}' is ambiguous: ${candidates.map((entry) => entry.catalog).join(', ')}. Specify --catalog.`,
        'AMBIGUOUS_RESOURCE',
      );
    }
    const [resource] = candidates;
    const versions = listSourceVersions(resource);
    output.log(
      `Commit history for ${resource.catalog}:${resource.kind}:${resource.id} (up to 500 newest commits; date is commit committer date):`,
    );
    for (const row of formatSourceVersionTable(versions, process.stdout.isTTY ? process.stdout.columns : undefined))
      output.log(row);
    if (!versions.length) output.log('No commits found for this resource path.');
    return 0;
  }
  if (options.command === 'doctor') {
    const result = diagnose(options);
    if (report) {
      report.checks = result.checks;
    } else {
      for (const check of result.checks) console.log(`${check.status.toUpperCase()} ${check.id}: ${check.message}`);
    }
    return result.attention ? (report ? 2 : 1) : 0;
  }

  const catalogWarnings: CatalogLoadWarning[] = [];
  const { sourceResources, unavailable }: LoadedCatalogs = loadCommandCatalogs(
    options,
    (warning: CatalogLoadWarning) => {
      catalogWarnings.push(warning);
      if (options.command === 'dashboard') return;
      if (report) report.warnings.push(warning);
      else if (options.json) console.error(JSON.stringify(warning));
      else output.error(`Warning: ${warning.message}`);
    },
  );
  const allResources = catalogEntries(sourceResources);

  if (options.command === 'validate') {
    console.log(`Validated ${sourceResources.length} resources across configured user catalogs.`);
    return unavailable.length ? 1 : 0;
  }
  if (options.command === 'list' || options.command === 'search') {
    const matches: CatalogResource[] = listCatalogResources(sourceResources, options);
    if (options.json) {
      console.log(
        JSON.stringify(
          matches.map(({ source, applyTo, ...entry }: CatalogResource & { source?: unknown }) => entry),
          null,
          2,
        ),
      );
    } else {
      console.log(formatCatalogTable(matches, process.stdout));
      if (!matches.length) console.log('No matching resources.');
    }
    return unavailable.length ? 1 : 0;
  }
  if (options.command === 'check') {
    const result = checkInstalledResources(options.target!, sourceResources, options);
    if (report) {
      report.resources = result.resources;
      report.messages = result.messages;
      return result.updateAvailable || unavailable.length ? 2 : 0;
    }
    for (const message of result.messages) console.log(message);
    if (result.updateAvailable) console.log('Updates or installation issues require attention.');
    return result.updateAvailable || unavailable.length ? 1 : 0;
  }
  if (options.command === 'dashboard') {
    const result = collectInstalledScopes({ project: options.target!, user: os.homedir() }, sourceResources);
    result.errors.push(...catalogWarnings.map((warning) => ({ ...warning, scope: 'catalog' })));
    const rows = enrichInstalledResources(result.resources, allResources);
    if (
      !options.nonInteractive &&
      process.stdin.isTTY &&
      process.stdout.isTTY &&
      typeof process.stdin.setRawMode === 'function'
    ) {
      const userCatalogState: () => UserCatalog[] = () => {
        const catalogs: SourceConfiguration[] = loadUserSourceConfiguration();
        return catalogs.map(({ name, repository, mode, entries }) => ({ name, repository, mode, entries }));
      };
      let applySelfUpdate: (() => Promise<void>) | undefined;
      const dashboardActions: DashboardActions = {
        showOnboarding: options.showOnboarding,
        catalogResources: sourceResources,
        prepareSelfUpdate: async () => {
          const update = await prepareSelfUpdate();
          if (!update) return null;
          return {
            manager: update.manager,
            request: () => {
              applySelfUpdate = update.apply;
            },
          };
        },
        addCatalog: (request) => runDashboardWorker<CatalogMutationResult>({ task: 'catalog-add', request }),
        updateCatalog: (originalName, request) =>
          runDashboardWorker<CatalogMutationResult>({ task: 'catalog-update', originalName, request }),
        userCatalogs: userCatalogState(),
        checkCatalogFreshness: (names) => checkCatalogFreshness(undefined, names),
        removeCatalog: (name) => runDashboardWorker<CatalogActionResult>({ task: 'catalog-remove', name }),
        refreshCatalog: (name) => runDashboardWorker<CatalogActionResult>({ task: 'catalog-refresh', name }),
        transferCatalogs: (action, content) =>
          runDashboardWorker<CatalogActionResult>({ task: 'catalog-transfer', action, content }),
        execute: (operation, resource, installOptions) => {
          const { onProgress, ...workerOptions } = installOptions;
          return runDashboardWorker<DashboardActionResult>(
            {
              task: 'resource-action',
              action: operation,
              resource,
              dashboardOptions: {
                target: options.target,
                userTarget: os.homedir(),
              },
              catalogs: { sourceResources, warnings: catalogWarnings },
              installOptions: workerOptions,
            },
            onProgress,
          );
        },
        listSourceVersions: async (resource) => {
          const versions = await listSourceVersionsAsync(resource);
          const prefixes = uniqueSourceVersionPrefixes(versions);
          return versions.map((version, index) => ({ ...version, prefix: prefixes[index] }));
        },
      };
      const completed = await browseInstalledResources(
        rows,
        process.stdin,
        process.stdout,
        result.errors,
        dashboardActions,
      );
      if (completed && applySelfUpdate) {
        await applySelfUpdate();
        return 0;
      }
      return unavailable.length || result.errors.length || !completed ? 1 : 0;
    }
    console.log(renderInstalledResources(rows, process.stdout, result.errors));
    return unavailable.length || result.errors.length ? 1 : 0;
  }
  if (options.command === 'show') {
    const resource = await selectedSourceResource(allResources, options);
    if (resource) output.log(formatSourceResource(resource));
    return 0;
  }
  const operation = options.command;
  if (operation === 'install' || operation === 'preview' || operation === 'update' || operation === 'uninstall') {
    const result = await executeInstallationOperation(
      {
        ...options,
        target: options.target!, // Only mutations use the target, and their parser always sets it.
        tool: options.tool ?? undefined,
        planOnly: options.json,
        operation,
        onMessage: ({ level, text }: InstallationMessage) => output[level](text),
        onAudit: (audit: AuditResult) => {
          for (const line of formatAuditLines(audit)) output.log(line);
        },
      },
      sourceResources,
      selectedSourceResource,
    );
    if (result.preview !== undefined) output.log(`${formatSourceResource(result.resource!)}\n\n${result.preview}`);
    return result.status;
  }
  throw new CatalogError(`Unsupported command: ${options.command}`);
}

export {
  parseArguments,
  printHelp,
  catalogEntries,
  listCatalogResources,
  executeCommand,
  runDashboardWorker,
  copyTextToClipboard,
};
