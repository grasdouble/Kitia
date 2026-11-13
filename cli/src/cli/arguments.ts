"use strict";

import { CATALOG_PRESETS } from "../catalog/sources/presets.js";
import type { CatalogResource } from "../catalog/entries.js";
import type { PlanAction, InstallationTool, InventoryScope } from "../catalog/inventory/files.js";
import type { spawn } from "node:child_process";
export interface CliOptions {
  command?: string;
  action?: string;
  target?: string;
  userTarget?: string;
  catalog?: string;
  ref?: string;
  kind?: string;
  id?: string;
  scope?: InventoryScope;
  tool?: InstallationTool | null;
  nonInteractive?: boolean;
  json?: boolean;
  audit?: boolean;
  dryRun?: boolean;
  force?: boolean;
  ghForce?: boolean;
  ghForceAgent?: string;
  allCatalogs?: boolean;
  query?: string;
  tag?: string;
  status?: string;
  license?: string;
  name?: string;
  repository?: string;
  file?: string;
  signingKey?: string;
  trustedKey?: string;
  resourceSelectors?: string[];
  sourceResources?: CatalogResource[];
  resource?: CatalogResource;
  output?: { log(message: string): void; error(message: string): void };
  onAction?: (action: PlanAction) => void;
  captureOutput?: boolean;
  onResource?: (resource: { catalog: string; kind: string; id: string; status?: string; source?: boolean }) => void;
  onProgress?: (message: string) => void;
  spawnProcess?: typeof spawn;
}
const os = require("node:os");
const path = require("node:path");
const { CatalogError, RESOURCE_ID, TOOLS, USER_INSTALLABLE_KINDS } = require("../catalog/resources/index.js");
const { loadUserSourceConfiguration, catalogNameKey } = require("../catalog/sources/config.js");
const KINDS = new Set(["skill", "agent", "instruction"]);
const catalogPresetCommands = CATALOG_PRESETS.map(({ command }) => command);

function isInstallationTool(value: string): value is InstallationTool {
  return value === "claude" || value === "copilot" || value === "both";
}

function catalogNames(): string[] {
  return loadUserSourceConfiguration().map((source) => source.name);
}

function resolveCatalogName(value: string): string | undefined {
  return catalogNames().find((name) => catalogNameKey(name) === catalogNameKey(value));
}

function parseArguments(args: string[]): CliOptions {
  if (args.length === 0) args = ["dashboard"];
  const extras: CliOptions = {};
  const command = args[0];
  const discovery = ["list", "search"].includes(command);
  const remaining = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--non-interactive") extras.nonInteractive = true;
    else if (argument === "--audit") extras.audit = true;
    else if (argument === "--json" && !discovery) extras.json = true;
    else if (argument === "--scope") {
      if (extras.scope) throw new CatalogError("--scope may only be specified once", "INVALID_ARGUMENT");
      const scope = args[++index];
      if (scope !== "project" && scope !== "user") {
        throw new CatalogError("--scope must be project or user", "INVALID_ARGUMENT");
      }
      extras.scope = scope;
    } else if (argument === "--catalog" && !discovery) {
      const catalog = args[++index];
      const resolvedCatalog = resolveCatalogName(catalog);
      if (!resolvedCatalog) {
        const configured = catalogNames();
        const hint = configured.length ? `Choose one of: ${configured.join(", ")}` : "No user catalogs are configured; add one with 'kitia catalog add'.";
        throw new CatalogError(`Unknown catalog: ${catalog}. ${hint}`, "INVALID_ARGUMENT");
      }
      extras.catalog = resolvedCatalog;
    } else remaining.push(argument);
  }
  try {
    const options: CliOptions = command === "doctor"
      ? { ...parseCommandArguments(["check", ...remaining.slice(1)]), command: "doctor" }
      : parseCommandArguments(remaining);
    const action = options.action || options.command;
    if (extras.audit && !["preview", "install"].includes(action)) {
      throw new CatalogError("--audit is only supported for source preview and install commands", "INVALID_ARGUMENT");
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
          throw new CatalogError("--scope user only supports skills and agents");
        }
        extras.target = os.homedir();
        if (!extras.target || !path.isAbsolute(extras.target)) {
          throw new CatalogError("Cannot resolve an absolute user home directory");
        }
      }
    }
    if (extras.json && !["check", "doctor"].includes(action) &&
        !( ["install", "update", "uninstall"].includes(action) && options.dryRun)) {
      throw new CatalogError("--json is supported for discovery, check, doctor and lifecycle --dry-run only");
    }
    if (extras.catalog && !["show", "preview", "install", "update", "uninstall", "check", "validate", "versions"].includes(command)) {
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
  if (command === "collection") {
    const [action, file, ...arguments_] = remaining;
    const usage = "Usage: kitia collection export <file> <catalog:kind:id...> [--signing-key <private-pem>] | import <file> [--trusted-key <public-pem>]";
    if (action === "import" && file) {
      if (!arguments_.length) return { command, action, file };
      if (arguments_.length === 2 && arguments_[0] === "--trusted-key" &&
          arguments_[1] && !arguments_[1].startsWith("--")) {
        return { command, action, file, trustedKey: arguments_[1] };
      }
      throw new CatalogError(usage);
    }
    if (action === "export" && file) {
      const selectors = [];
      let signingKey;
      for (let index = 0; index < arguments_.length; index += 1) {
        const argument = arguments_[index];
        if (argument === "--signing-key") {
          if (signingKey) throw new CatalogError("--signing-key may only be specified once");
          const value = arguments_[++index];
          if (!value || value.startsWith("--")) throw new CatalogError("--signing-key requires a PEM file path");
          signingKey = value;
        } else if (argument.startsWith("--")) {
          throw new CatalogError(`Unknown collection option: ${argument}`);
        } else selectors.push(argument);
      }
      if (!selectors.length) throw new CatalogError(usage);
      for (const selector of selectors) {
        const [catalog, kind, id, ...extra] = selector.split(":");
        if (!catalog || !["skill", "agent", "instruction"].includes(kind) ||
            !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id || "") || extra.length) {
          throw new CatalogError(`Invalid resource selector '${selector}'. Use catalog:kind:id.`);
        }
      }
      if (new Set(selectors).size !== selectors.length) throw new CatalogError("Collection selectors must be unique");
      return { command, action, file, resourceSelectors: selectors, ...(signingKey ? { signingKey } : {}) };
    }
    throw new CatalogError(usage);
  }
  if (command === "catalog") {
    const [action, name, repository, ...extra] = remaining;
    const usage = `Usage: kitia catalog <add <name> <github-repository> | ${catalogPresetCommands.map((preset) => `add ${preset}`).join(" | ")} | import <file> | export <file> | refresh <name> | refresh --all | remove <name> | list>`;
    if (extra.length) throw new CatalogError(usage);
    if (["import", "export"].includes(action) && name && !repository) return { command, action, file: name };
    if (action === "list" && name === undefined) return { command, action };
    if (action === "remove" && name && !repository) return { command, action, name };
    if (action === "refresh" && name && !repository) {
      if (name === "--all") return { command, action, allCatalogs: true };
      return { command, action, name };
    }
    if (action === "add" && name && repository === undefined) {
      const preset = CATALOG_PRESETS.find(({ command: presetCommand }) => presetCommand === name);
      if (preset) return { command, action, name: preset.catalogName, repository: preset.repository };
    }
    if (action === "add" && name && repository) return { command, action, name, repository };
    throw new CatalogError(usage);
  }
  if (command === "onboarding") {
    if (remaining.length) throw new CatalogError("Usage: kitia onboarding");
    return { command, target: "." };
  }
  if (command === "validate") {
    if (remaining.length) throw new CatalogError("validate does not accept arguments");
    return { command };
  }
  if (command === "dashboard") {
    if (remaining.length) throw new CatalogError("Usage: Kitia dashboard [--non-interactive]");
    return { command, target: "." };
  }
  if (command === "list" || command === "search") {
    const options: CliOptions = { command, query: "" };
    if (command === "search") {
      if (!remaining[0] || remaining[0].startsWith("--")) {
        throw new CatalogError(`Usage: Kitia search "<query>" [--catalog <catalog>] [--kind <kind>] [--tag <tag>] [--status <status>] [--license <value>] [--json]`);
      }
      options.query = remaining.shift();
    }
    for (let index = 0; index < remaining.length; index += 1) {
      const option = remaining[index];
      if (option === "--json") {
        options.json = true;
        continue;
      }
      if (!["--kind", "--tag", "--status", "--catalog", "--license"].includes(option)) {
        throw new CatalogError(`Unknown option: ${option}`);
      }
      const value = remaining[++index];
      if (!value || value.startsWith("--")) throw new CatalogError(`${option} requires a value`);
      if (option === "--kind" && !KINDS.has(value)) throw new CatalogError(`Unknown kind: ${value}`);
      const resolvedCatalog = option === "--catalog" ? resolveCatalogName(value) : undefined;
      if (option === "--catalog" && !resolvedCatalog) {
        const configured = catalogNames();
        const hint = configured.length ? `Choose one of: ${configured.join(", ")}` : "No user catalogs are configured; add one with 'kitia catalog add'.";
        throw new CatalogError(`Unknown catalog: ${value}. ${hint}`);
      }
      if (option === "--status" && !["experimental", "stable", "deprecated"].includes(value)) {
        throw new CatalogError(`Unknown status: ${value}`);
      }
      if (option === "--kind") options.kind = value;
      else if (option === "--tag") options.tag = value;
      else if (option === "--status") options.status = value;
      else if (option === "--license") options.license = value;
      else options.catalog = resolvedCatalog;
    }
    return options;
  }
  if (command === "versions") {
    const [kind, id, ...extra] = remaining;
    if (!KINDS.has(kind) || !RESOURCE_ID.test(id || "") || extra.length) {
      throw new CatalogError("Usage: Kitia versions <kind> <id>");
    }
    return { command, kind, id };
  }
  if (command === "show" || command === "preview") {
    const typed = remaining.length >= 2 && KINDS.has(remaining[0]) && RESOURCE_ID.test(remaining[1]);
    const [kind, id, ...extra] = typed ? remaining : [null, remaining[0], ...remaining.slice(1)];
    if (typeof id !== "string" || !RESOURCE_ID.test(id) || extra.length) {
      throw new CatalogError(`Usage: Kitia ${command} [<kind>] <id>`);
    }
    return { command, kind, id };
  }
  if (command === "check") {
    let target = ".";
    for (let index = 0; index < remaining.length; index += 1) {
      if (remaining[index] !== "--target") throw new CatalogError(`Unknown option: ${remaining[index]}`);
      const value = remaining[index + 1];
      if (!value || value.startsWith("--")) throw new CatalogError("--target requires a value");
      target = value;
      index += 1;
    }
    return { command, target };
  }
  if (!["install", "update", "uninstall"].includes(command)) {
    throw new CatalogError(`Unknown command: ${command}`);
  }
  const updateAll = command === "update" && (!remaining.length || remaining[0]?.startsWith("--"));
  const typed = !updateAll && remaining.length >= 2 && KINDS.has(remaining[0]) && RESOURCE_ID.test(remaining[1]);
  const [kind, id] = updateAll ? [null, null] : typed ? remaining : [null, remaining[0]];
  const options = updateAll ? remaining : remaining.slice(typed ? 2 : 1);
  if (!updateAll && (typeof id !== "string" || !RESOURCE_ID.test(id))) {
    throw new CatalogError(`Usage: kitia ${command} [<kind>] <id> [--target <dir>]`);
  }
  const result: CliOptions = { command, kind, id, tool: command === "install" ? "copilot" : null, target: ".", dryRun: false, force: false };
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === "--dry-run") result.dryRun = true;
    else if (option === "--force") result.force = true;
    else if (option === "--ref" && ["install", "update"].includes(command)) {
      const value = options[index + 1];
      if (!value || value.startsWith("--")) throw new CatalogError("--ref requires a commit SHA or hexadecimal prefix");
      if (!/^[a-f0-9]{7,40}$/i.test(value)) throw new CatalogError("--ref must be a 7- to 40-character hexadecimal commit SHA prefix");
      result.ref = value.toLowerCase();
      index += 1;
    } else if (option === "--target" || (option === "--tool" && command === "install")) {
      const value = options[index + 1];
      if (!value || value.startsWith("--")) throw new CatalogError(`${option} requires a value`);
      if (option === "--target") result.target = value;
      else {
        if (!isInstallationTool(value)) throw new CatalogError("--tool must be one of: claude, copilot or both");
        result.tool = value;
      }
      index += 1;
    } else throw new CatalogError(`Unknown option: ${option}`);
  }
  if (result.ref && (!result.kind || !KINDS.has(result.kind) || !result.id)) {
    throw new CatalogError("--ref requires a specific skill, agent, or instruction install or update");
  }
  return result;
}

function printHelp() {
  console.log(`Usage:
  Kitia onboarding                 Show the getting-started guide again
  Kitia [dashboard] [--non-interactive] (dashboard is the default command)
  Kitia list [--catalog <catalog>] [--kind <kind>] [--tag <tag>] [--status <status>] [--license <value>] [--json]
  Kitia search "<query>" [--catalog <catalog>] [--kind <kind>] [--tag <tag>] [--status <status>] [--license <value>] [--json]
  Kitia show [<kind>] <id>
  Kitia preview [<kind>] <id>
  Kitia validate [--catalog <catalog>]
  Kitia check [--target <dir>] [--catalog <catalog>] [--json]
  Kitia doctor [--target <dir>] [--network] [--json]
  Kitia versions <kind> <id> [--catalog <catalog>]
  Kitia install [<kind>] <id> [--ref <full-sha>] [--target <dir>] [options]
  Kitia update [<kind> <id>] [--ref <full-sha>] [--target <dir>] [--dry-run] [--force]
  Kitia uninstall [<kind>] <id> [--target <dir>] [--dry-run] [--force]
  Kitia catalog add <name> <https-github-url>
  ${catalogPresetCommands.map((preset) => `Kitia catalog add ${preset}`).join("\n  ")}
  Kitia catalog import <file>
  Kitia catalog export <file>
  Kitia collection export <file> <catalog:kind:id...> [--signing-key <private-pem>]
  Kitia collection import <file> [--trusted-key <public-pem>]
  Kitia catalog refresh <name>
  Kitia catalog refresh --all
  Kitia catalog list
  Kitia catalog remove <name>

Kinds: skill, agent, instruction

Options:
  --catalog <catalog>           Select a user-managed catalog
  --kind <kind>                 Filter by resource type
  --tag <tag>                   Filter by tag
  --status <status>             Filter by status
  --license <value>             Filter by SPDX ID/expression or exact upstream value
  --signing-key <private-pem>   Optional resource collection export signing key
  --trusted-key <public-pem>   Resource collection import verification key
  Source skill installs/previews are delegated to GitHub CLI
  --json                        Discovery arrays; check/doctor reports; lifecycle --dry-run plans
  --audit                       Audit pinned source bytes; block installs with findings or incomplete coverage
  --non-interactive             Never open interactive selectors, previews, or dashboard
  --target <dir>                Installation target (default: current directory)
  --scope <project|user>        Skills/agents: project or user home; instructions are project-scoped
                                User scope cannot be combined with --target
  --tool <claude|copilot|both>  Install only: desired runtimes (default: copilot)
  --dry-run                     Preview files without writing
  --ref <sha-or-prefix>         Install/update a source skill, agent, or instruction at a specific commit
  --force                       Overwrite files or remove modified/untracked source skills
  F / A / U / Delete            Dashboard only: filter / browse / update / uninstall resources
  Omit <kind> when the resource ID is unique; ambiguous IDs open a selector.
  -h, --help                    Show this help`);
}

module.exports = { parseArguments, parseCommandArguments, printHelp };