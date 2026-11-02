"use strict";

import type { CliOptions } from "../types.js";
const os = require("node:os");
const path = require("node:path");
const { CatalogError, RESOURCE_ID, TOOLS, KINDS, USER_INSTALLABLE_KINDS } = require("../catalog/resources/index.js");
const { loadSourceConfiguration, catalogNameKey } = require("../catalog/sources/config.js");

function catalogNames(): string[] {
  return ["internal", ...loadSourceConfiguration().map((source) => source.name)];
}

function resolveCatalogName(value: string): string | undefined {
  return catalogNames().find((name) => catalogNameKey(name) === catalogNameKey(value));
}

function parseArguments(args: string[]): CliOptions {
  const extras: CliOptions = {};
  const command = args[0];
  const discovery = ["list", "search"].includes(command);
  const remaining = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--non-interactive") extras.nonInteractive = true;
    else if (argument === "--yes") extras.yes = true;
    else if (argument === "--cascade") extras.cascade = true;
    else if (argument === "--input") {
      const value = args[++index];
      const match = value?.match(/^([a-z0-9-]+\.[a-z][a-z0-9_]*)=(.*)$/s);
      if (!match || Object.hasOwn(extras.inputs || {}, match[1])) {
        throw new CatalogError("--input requires a unique <mcp-id>.<input>=<value> binding", "INVALID_ARGUMENT");
      }
      extras.inputs ||= {};
      extras.inputs[match[1]] = match[2];
    } else if (argument === "--offline") extras.offline = true;
    else if (argument === "--refresh-catalog") extras.refreshCatalog = true;
    else if (argument === "--json" && !discovery) extras.json = true;
    else if (argument === "--network" && command === "doctor") extras.network = true;
    else if (argument === "--scope") {
      if (extras.scope) throw new CatalogError("--scope may only be specified once", "INVALID_ARGUMENT");
      const scope = args[++index];
      if (!["project", "user"].includes(scope)) {
        throw new CatalogError("--scope must be project or user", "INVALID_ARGUMENT");
      }
      extras.scope = scope;
    } else if (argument === "--catalog" && !["list", "search"].includes(command)) {
      const catalog = args[++index];
      const resolvedCatalog = resolveCatalogName(catalog);
      if (!resolvedCatalog) throw new CatalogError("Invalid --catalog value", "INVALID_ARGUMENT");
      extras.catalog = resolvedCatalog;
    } else remaining.push(argument);
  }
  try {
    if (extras.offline && extras.refreshCatalog) {
      throw new CatalogError("--offline cannot be combined with --refresh-catalog");
    }
    if ((extras.offline || extras.refreshCatalog) && ["doctor", "--help", "-h"].includes(command)) {
      throw new CatalogError("--offline and --refresh-catalog apply to catalog commands only");
    }
    const options: CliOptions = command === "doctor"
      ? { ...parseCommandArguments(["check", ...remaining.slice(1)]), command: "doctor" }
      : parseCommandArguments(remaining);
    const action = options.action || options.command;
    if (extras.cascade && action !== "uninstall") {
      throw new CatalogError("--cascade is supported only for uninstall", "INVALID_ARGUMENT");
    }
    if ((extras.inputs || extras.yes) && !["install", "update"].includes(action)) {
      throw new CatalogError("--input and --yes are supported only for MCP/bundle installation/update");
    }
    if (extras.scope) {
      if (!["install", "update", "uninstall", "check", "doctor"].includes(action)) {
        throw new CatalogError("--scope is only supported for installation, maintenance and doctor");
      }
      if (extras.scope === "user") {
        if (remaining.includes("--target")) {
          throw new CatalogError("--scope user cannot be combined with --target");
        }
        if (options.kind && !USER_INSTALLABLE_KINDS.has(options.kind)) {
          throw new CatalogError("--scope user only supports skills, agents, MCPs and bundles without instructions");
        }
        extras.target = os.homedir();
        if (!extras.target || !path.isAbsolute(extras.target)) {
          throw new CatalogError("Cannot resolve an absolute user home directory");
        }
      }
    }
    if (extras.json && !["check", "doctor"].includes(action) &&
        !(["install", "update", "uninstall"].includes(action) && options.dryRun)) {
      throw new CatalogError("--json is supported for discovery, check, doctor and lifecycle --dry-run only");
    }
    if (extras.catalog && !["show", "preview", "install", "update", "uninstall", "check", "validate"].includes(command)) {
      throw new CatalogError("--catalog is not supported for this command");
    }
    return { ...options, ...extras };
  } catch (error) {
    if (error instanceof CatalogError) error.code = "INVALID_ARGUMENT";
    throw error;
  }
}

function parseCommandArguments(args: string[]): CliOptions {
  const [command, ...remaining] = args;
  if (command === "catalog") {
    const [action, name, repository, ...extra] = remaining;
    const usage = "Usage: kiti catalog <add <name> <github-repository> | refresh <name> | refresh --all | remove <name> | list>";
    if (extra.length) throw new CatalogError(usage);
    if (action === "list" && name === undefined) return { command, action };
    if (action === "remove" && name && !repository) return { command, action, name };
    if (action === "refresh" && name && !repository) {
      if (name === "--all") return { command, action, allCatalogs: true };
      return { command, action, name };
    }
    if (action === "add" && name && repository) return { command, action, name, repository };
    throw new CatalogError(usage);
  }
  if (!command) return { command: "dashboard", target: "." };
  if (command === "--help" || command === "-h") return { command: "help" };
  if (command === "validate") {
    if (remaining.length) {
      throw new CatalogError(`${command} does not accept arguments`);
    }
    return { command };
  }
  if (command === "dashboard") {
    if (remaining.length) {
      throw new CatalogError("Usage: Kiti dashboard [--non-interactive]");
    }
    return { command, target: "." };
  }
  if (command === "list" || command === "search") {
    const options: CliOptions = { command, query: "" };
    if (command === "search") {
      if (!remaining[0] || remaining[0].startsWith("--")) {
        throw new CatalogError('Usage: Kiti search "<query>" [--catalog <catalog>] [--kind <kind>] [--group <group>] [--tag <tag>] [--status <status>] [--json]');
      }
      options.query = remaining.shift();
    }
    for (let index = 0; index < remaining.length; index += 1) {
      const option = remaining[index];
      if (option === "--json") {
        options.json = true;
        continue;
      }
      if (!["--kind", "--tag", "--status", "--group", "--catalog"].includes(option)) {
        throw new CatalogError(`Unknown option: ${option}`);
      }
      const value = remaining[++index];
      if (!value || value.startsWith("--")) {
        throw new CatalogError(`${option} requires a value`);
      }
      if (option === "--kind" && !KINDS.has(value)) {
        throw new CatalogError(`Unknown kind: ${value}`);
      }
      if (option === "--group" && !RESOURCE_ID.test(value)) {
        throw new CatalogError("--group must be a lowercase kebab-case identifier");
      }
      const resolvedCatalog = resolveCatalogName(value);
      if (option === "--catalog" && !resolvedCatalog) {
        throw new CatalogError(`Unknown catalog: ${value}. Choose one of: ${catalogNames().join(", ")}`);
      }
      if (option === "--status" && !["experimental", "stable", "deprecated"].includes(value)) {
        throw new CatalogError(`Unknown status: ${value}`);
      }
      options[option.slice(2)] = option === "--catalog" ? resolvedCatalog : value;
    }
    return options;
  }
  if (command === "show") {
    const typed = remaining.length === 2 &&
      KINDS.has(remaining[0]) && RESOURCE_ID.test(remaining[1]);
    const [kind, id] = typed ? remaining : [null, remaining[0]];
    if ((!typed && remaining.length !== 1) || typeof id !== "string" || !RESOURCE_ID.test(id)) {
      throw new CatalogError("Usage: Kiti show [<kind>] <id>");
    }
    return { command, kind, id };
  }
  if (command === "preview") {
    const typed = remaining.length >= 2 &&
      KINDS.has(remaining[0]) && RESOURCE_ID.test(remaining[1]);
    const [kind, id, ...options] = typed
      ? remaining
      : [null, remaining[0], ...remaining.slice(1)];
    if (typeof id !== "string" || !RESOURCE_ID.test(id)) {
      throw new CatalogError("Usage: Kiti preview [<kind>] <id> [--file <path>]");
    }
    let file = null;
    for (let index = 0; index < options.length; index += 1) {
      if (options[index] !== "--file") {
        throw new CatalogError(`Unknown option: ${options[index]}`);
      }
      if (file !== null) {
        throw new CatalogError("--file may only be specified once");
      }
      file = options[index + 1];
      if (!file || file.startsWith("--")) {
        throw new CatalogError("--file requires a relative path");
      }
      index += 1;
    }
    return { command, kind, id, file };
  }
  if (command === "check") {
    let target = ".";
    for (let index = 0; index < remaining.length; index += 1) {
      if (remaining[index] !== "--target") {
        throw new CatalogError(`Unknown option: ${remaining[index]}`);
      }
      const value = remaining[index + 1];
      if (!value || value.startsWith("--")) {
        throw new CatalogError("--target requires a value");
      }
      target = value;
      index += 1;
    }
    return { command, target };
  }
  if (!["install", "update", "uninstall"].includes(command)) {
    throw new CatalogError(`Unknown command: ${command}`);
  }
  const updateAll = command === "update" &&
    (!remaining.length || remaining[0]?.startsWith("--"));
  const typed = !updateAll && remaining.length >= 2 &&
    KINDS.has(remaining[0]) && RESOURCE_ID.test(remaining[1]);
  const [kind, id] = updateAll
    ? [null, null]
    : typed ? remaining : [null, remaining[0]];
  const options = updateAll ? remaining : remaining.slice(typed ? 2 : 1);
  if (!updateAll && (typeof id !== "string" || !RESOURCE_ID.test(id))) {
    throw new CatalogError(`Usage: kiti ${command} [<kind>] <id> [--target <dir>]`);
  }
  const result = { command, kind, id, tool: command === "install" ? "copilot" : null, target: ".", dryRun: false, force: false };
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === "--dry-run") {
      result.dryRun = true;
    } else if (option === "--force") {
      result.force = true;
    } else if (option === "--target" || (option === "--tool" && command === "install")) {
      const value = options[index + 1];
      if (!value || value.startsWith("--")) {
        throw new CatalogError(`${option} requires a value`);
      }
      if (option === "--target") {
        result.target = value;
      } else {
        if (!TOOLS.has(value)) {
          throw new CatalogError(`--tool must be one of: ${[...TOOLS].join(", ")}`);
        }
        result.tool = value;
      }
      index += 1;
    } else {
      throw new CatalogError(`Unknown option: ${option}`);
    }
  }
  return result;
}

function printHelp() {
  console.log(`Usage:
  Kiti [dashboard] [--non-interactive] (dashboard is the default command)
  Kiti list [--catalog <catalog>] [--kind <kind>] [--group <group>] [--tag <tag>] [--status <status>] [--json]
  Kiti search "<query>" [--catalog <catalog>] [--kind <kind>] [--group <group>] [--tag <tag>] [--status <status>] [--json]
  Kiti show [<kind>] <id>
  Kiti preview [<kind>] <id> [--file <path>]
  Kiti validate [--catalog <catalog>]
  Kiti check [--target <dir>] [--catalog <catalog>] [--json]
  Kiti doctor [--target <dir>] [--network] [--json]
  Kiti install [<kind>] <id> [--target <dir>] [options]
  Kiti update [<kind> <id>] [--target <dir>] [--dry-run] [--force]
  Kiti uninstall [<kind>] <id> [--target <dir>] [--dry-run] [--force] [--cascade]
  Kiti migrate [--dry-run | --apply]
  Kiti catalog add <name> <https-github-url>
  Kiti catalog refresh <name>
  Kiti catalog refresh --all
  Kiti catalog list
  Kiti catalog remove <name>

Kinds: skill, agent, instruction, bundle, mcp
MCPs and bundles target Copilot CLI and Claude Code CLI only; desktop apps and IDEs are outside their managed support scope.

Options:
  --catalog <catalog>           Select internal or a configured source catalog
  --kind <kind>                 Filter by resource type
  --group <group>               Filter by local resource group
  --tag <tag>                   Filter by tag
  --status <status>             Filter by status
  Source skill installs and previews are delegated to GitHub CLI
  --json                        Discovery arrays; check/doctor reports; lifecycle --dry-run plans
  --non-interactive             Never open interactive selectors, previews, or dashboard
  --input <mcp-id>.<name>=value  MCP/bundle setup: a non-secret parameter (repeatable)
  --yes                         Confirm an MCP/bundle installation/update plan non-interactively
  F / A / U / Delete            Dashboard only: filter / install / update / uninstall resources
  --network                     Doctor only: check GitHub auth and repository access
  --offline                     Use cached source metadata without network access
  --refresh-catalog             Refresh source metadata now (no stale-cache fallback)
  --target <dir>                Installation target (default: current directory)
  --scope <project|user>        Skills/agents/MCPs/bundles: project (default) or user home; also maintenance/doctor
                                User scope cannot be combined with --target
  --tool <claude|copilot|both>  Install only: desired runtimes (default: copilot)
  --dry-run                     Preview files without writing
  --force                       Overwrite files or remove modified/untracked source skills
  --cascade                     Uninstall bundles that depend on the selected resource
  Omit <kind> when the resource ID is unique; ambiguous IDs open a selector.
  -h, --help                    Show this help`);
}

module.exports = { parseArguments, parseCommandArguments, printHelp };
