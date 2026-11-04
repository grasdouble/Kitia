"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { acquireOperationLock } = require("../catalog/operation.js");
const commandApi = require("./commands.js");
const { CLI_REPORT_SCHEMA_VERSION } = require("./schema-versions.js");
const { readInstallState, parseArguments, executeCommand } = commandApi;
import type { CliReport } from "./report.js";

function createReport(command: string, dryRun = false): CliReport {
  return {
    schema_version: CLI_REPORT_SCHEMA_VERSION, command, dry_run: dryRun, status: "ok",
    resources: [], actions: [], warnings: [], messages: [], errors: [],
  };
}

async function main(args: string[] = process.argv.slice(2)): Promise<number> {
  let release;
  let report: CliReport | undefined;
  try {
    const options = parseArguments(args);
    const action = options.action || options.command;
    if (options.json && ["check", "doctor", "install", "update", "uninstall"].includes(action)) {
      report = createReport(action, Boolean(options.dryRun));
      if (options.scope) {
        report.scope = options.scope;
        report.target = path.resolve(options.target);
      }
      options.nonInteractive = true;
      options.onResource = (resource) => {
        const { source: _source, ...entry } = resource;
        if (!report.resources.some((existing) => existing.catalog === entry.catalog &&
            existing.kind === entry.kind && existing.id === entry.id)) report.resources.push(entry);
      };
      options.onAction = (action) => {
        const resource = action.resource;
        report.actions.push({ ...action, resource: resource
          ? { catalog: resource.catalog, kind: resource.kind, id: resource.id }
          : null });
      };
      options.output = {
        log: (message) => report.messages.push(message),
        error: (message) => report.warnings.push({ code: "WARNING", message }),
      };
    }
    if (["install", "update", "uninstall"].includes(action) && !options.dryRun) {
      release = acquireOperationLock(options.target);
      readInstallState(fs.realpathSync(options.target));
    }
    const code = await executeCommand(options, report);
    if (release) {
      const unlock = release;
      release = undefined;
      unlock();
    }
    if (report) {
      report.status = code === 0 ? "ok" : code === 2 ? "attention" : "error";
      console.log(JSON.stringify(report, null, 2));
    }
    return code;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const errorCode = (error as Error & { code?: string }).code;
    if (args.includes("--json")) {
      const failure = { code: errorCode || "INTERNAL_ERROR", message: error.message };
      console.log(JSON.stringify({ ...(report || createReport(args[0] || "help")),
        status: "error", errors: [failure] }, null, 2));
    } else console.error(`Error: ${error.message}`);
    return 1;
  } finally {
    if (release) release();
  }
}

if (require.main === module) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  ...commandApi, main,
};
