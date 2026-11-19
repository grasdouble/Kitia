#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

import manifest from '../../package.json';
import { parseArguments } from './cli/arguments.js';
import type { CliReport } from './cli/report.js';
import { CLI_REPORT_SCHEMA_VERSION } from './cli/schema-versions.js';
import { acquireOperationLock } from './core/installations/lock.js';
import { readInstallState } from './core/inventory/inventory.js';

function createReport(command: string, dryRun = false): CliReport {
  return {
    schema_version: CLI_REPORT_SCHEMA_VERSION,
    command,
    dry_run: dryRun,
    status: 'ok',
    resources: [],
    actions: [],
    warnings: [],
    messages: [],
    errors: [],
  };
}

async function main(args: string[] = process.argv.slice(2)): Promise<number> {
  // Keep the command graph out of migration startup and import-only callers.
  const { executeCommand } = await import('./cli/commands.js');

  let release: (() => void) | undefined;
  let report: CliReport | undefined;
  try {
    const options = parseArguments(args);
    const action = options.action || options.command;
    if (options.json && ['check', 'doctor', 'install', 'update', 'uninstall'].includes(action)) {
      const cliReport = createReport(action, Boolean(options.dryRun));
      report = cliReport;
      if (options.scope) {
        report.scope = options.scope;
        report.target = path.resolve(options.target!);
      }
      options.nonInteractive = true;
      options.onResource = (resource) => {
        const { source: _source, ...entry } = resource;
        if (
          !cliReport.resources.some(
            (existing) =>
              existing.catalog === entry.catalog && existing.kind === entry.kind && existing.id === entry.id,
          )
        )
          cliReport.resources.push(entry);
      };
      options.onAction = (action) => {
        const resource = action.resource;
        cliReport.actions.push({
          ...action,
          resource: resource ? { catalog: resource.catalog, kind: resource.kind, id: resource.id } : null,
        });
      };
      options.output = {
        log: (message: string) => cliReport.messages.push(message),
        error: (message: string) => cliReport.warnings.push({ code: 'WARNING', message }),
      };
    }
    if (['install', 'update', 'uninstall'].includes(action) && !options.dryRun) {
      release = acquireOperationLock(options.target!);
      readInstallState(fs.realpathSync(options.target!));
    }
    const code = await executeCommand(options, report);
    if (release) {
      const unlock = release;
      release = undefined;
      unlock();
    }
    if (report) {
      report.status = code === 0 ? 'ok' : code === 2 ? 'attention' : 'error';
      console.log(JSON.stringify(report, null, 2));
    }
    return code;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const errorCode = (error as NodeJS.ErrnoException).code;
    if (args.includes('--json')) {
      const failure = { code: errorCode || 'INTERNAL_ERROR', message: error.message };
      console.log(
        JSON.stringify({ ...(report || createReport(args[0] || 'help')), status: 'error', errors: [failure] }, null, 2),
      );
    } else console.error(`Error: ${error.message}`);
    return 1;
  } finally {
    if (release) release();
  }
}

if (require.main === module) {
  process.env.KITIA_INSTALLED_VERSION = manifest.version;
  const run =
    process.argv[2] === 'migrate'
      ? import('./migrations/run.js').then(({ main }) => main(process.argv.slice(3)))
      : main();
  run
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: Error) => {
      console.error(`Error: ${error.message}`);
      process.exitCode = 1;
    });
}

export { main };
