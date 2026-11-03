"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createInterface } = require("node:readline/promises");
const { CatalogError, LOCK_PATH, validateBundleReferences, mcpConfigPaths, addPlanEntry } = require("../resources/index.js");
const { validateResource } = require("../resources/files.js");
const { validInputValue } = require("../entries.js");
const {
  readInstallState, targetPath, installedFingerprint, sameFingerprint,
  inspectInstalledFiles, writeInstallPlan, addInventoryStateToPlan,
} = require("../inventory/index.js");
const { prepareResourceInstall } = require("../lifecycle.js");
const bundleUtils = require("./utils.js");
const {
  digest, identity, conflict, tools, unionTool, bundleDigest, readMcpConfig, mcpConfigServers,
  addConfigPlan, registeredMcpTool,
} = bundleUtils;
import type { BundleMember, CatalogResource, McpServer } from "../entries.js";
import type { JsonObject } from "../json.js";
import { isJsonObject } from "../json.js";
import type { CliOptions } from "../../cli/arguments.js";
import type { BundleInventoryRecord, InstallState, InstallationTool, InventoryScope, McpInventoryRecord } from "../inventory/files.js";
import type { InstallPlanEntry } from "../plan.js";
import type { BuildInfo } from "../resources/files.js";
import type { McpFileConfig } from "./utils.js";

async function configureInputs(
  mcps: CatalogResource[],
  state: InstallState,
  options: CliOptions,
  ask?: (question: string) => Promise<string>,
): Promise<Record<string, Record<string, string>>> {
  const supplied = options.inputs || {};
  const mcpRecords: Record<string, McpInventoryRecord> = state.mcps || {};
  const known = new Set();
  const values: Record<string, Record<string, string>> = Object.create(null);
  const missing = [];
  for (const mcp of mcps) {
    values[mcp.id] = Object.create(null);
    for (const [name, input] of Object.entries(mcp.inputs)) {
      const key = `${mcp.id}.${name}`;
      known.add(key);
      if (input.secret) {
        if (Object.hasOwn(supplied, key)) {
          throw new CatalogError(`Do not pass secret input ${key} with --input. Supply ${input.target_env} in the MCP client's launch environment.`, "INVALID_ARGUMENT");
        }
        (options.output || console).log(`MCP ${mcp.id}: ${input.required ? "required" : "optional"} secret environment variable ${input.target_env} (resolved by the CLI at MCP startup; never stored by the installer).`);
        const server = Object.values(mcp.mcp_config.mcpServers)[0] as McpServer;
        if (server.args?.some((argument) => argument.includes(`\${${input.target_env}`))) {
          (options.output || console).error(`Warning: ${input.target_env} is expanded into MCP process arguments at startup and may be visible in process listings or server diagnostics.`);
        }
        continue;
      }
      const previous = Object.hasOwn(mcpRecords, mcp.id) ? mcpRecords[mcp.id].values : {};
      let value: unknown = supplied[key] ?? (Object.hasOwn(previous, name) ? previous[name] : undefined) ?? input.default;
      if (value !== undefined) {
        if (typeof value !== "string" || !validInputValue(input, value)) {
          throw new CatalogError(`Invalid ${input.type} input ${key}${input.type === "url" ? ": use HTTPS without credentials" : ""}`, "INVALID_ARGUMENT");
        }
        values[mcp.id][name] = value;
      } else if (input.required) {
        missing.push(key);
      }
    }
  }
  for (const key of Object.keys(supplied)) {
    if (!known.has(key))     throw new CatalogError(`Unknown MCP configuration input ${key}`, "INVALID_ARGUMENT");
  }
  if (missing.length) {
    const message = `Missing MCP configuration: ${missing.join(", ")}. Supply --input <mcp-id>.<input>=<value>.`;
    if (!options.dryRun) throw new CatalogError(message, "MISSING_CONFIGURATION");
    (options.output || console).error(message);
  }
  return values;
}

function nativeMcpConfig(mcp: CatalogResource, values: Record<string, string>): JsonObject {
  const server = Object.values(mcp.mcp_config.mcpServers)[0];
  if (server.type === "http") {
    if (typeof server.url !== "string") throw new CatalogError(`MCP ${mcp.id} has an invalid HTTP server URL`);
    return { type: "http", url: server.url };
  }
  if (typeof server.command !== "string" || !Array.isArray(server.args)) {
    throw new CatalogError(`MCP ${mcp.id} has an invalid stdio server`);
  }
  const env = { ...server.env };
  for (const [name, input] of Object.entries(mcp.inputs)) {
    if (input.secret) env[input.target_env] = `\${${input.target_env}${input.required ? "" : ":-"}}`;
    else if (Object.hasOwn(values, name)) env[input.target_env] = values[name];
  }
  return { type: "stdio", command: server.command, args: [...server.args], env };
}

function prepareMcp(
  mcp: CatalogResource,
  values: Record<string, string>,
  state: InstallState,
  root: string,
  tool: InstallationTool,
  scope: InventoryScope,
  plan: Map<string, InstallPlanEntry>,
  configurations: Map<string, McpFileConfig>,
  remove: Set<string>,
  options: CliOptions,
) {
  const mcpRecords: Record<string, McpInventoryRecord> = state.mcps || {};
  const bundles: Record<string, BundleInventoryRecord> = state.bundles || {};
  const previous = Object.hasOwn(mcpRecords, mcp.id) ? mcpRecords[mcp.id] : undefined;
  const otherUsers = Object.entries(bundles).filter(([id, bundle]) => id !== options.id &&
    bundle.resources.some((member) => member.kind === "mcp" && member.id === mcp.id));
  if (previous && digest(previous.values) !== digest(values) && otherUsers.length) {
    conflict(`MCP ${mcp.id} is shared with bundles ${otherUsers.map(([id]) => id).join(", ")}; its parameters cannot be changed implicitly.`);
  }
  const [serverName] = Object.keys(mcp.mcp_config.mcpServers);
  if (previous && previous.server !== serverName) conflict(`MCP ${mcp.id}: server name changed; uninstall its bundles before reconfiguring.`);
  const record: McpInventoryRecord = previous || {
    server: serverName, digest: "", values: {}, configurations: {}, files: {},
  };
  const registeredTool = previous ? registeredMcpTool(state, mcp.id) : tool;
  record.standalone ??= false;
  if (options.standaloneTool) {
    if (record.standalone && record.scope !== scope) conflict(`MCP ${mcp.id} is already independently installed with ${record.scope} scope in this target.`);
    record.scope = scope;
    record.standalone = true;
  }
  record.tool = unionTool(registeredTool, tool);
  for (const runtime of tools(record.tool)) {
    if (mcp.compatibility[runtime].status === "unsupported") {
      throw new CatalogError(`MCP ${mcp.id} does not support ${runtime}`, "UNSUPPORTED_RUNTIME");
    }
  }
  const desired = nativeMcpConfig(mcp, values);
  const recordConfigurations = record.configurations;
  const paths = new Set([...mcpConfigPaths(tool, scope), ...Object.keys(recordConfigurations)]);
  for (const relativePath of paths) {
    if (Object.entries(mcpRecords).some(([id, record]) => id !== mcp.id &&
        record.server === serverName && Object.hasOwn(record.configurations, relativePath))) {
      conflict(`MCP server name ${serverName} is already registered to another resource in ${relativePath}.`);
    }
    const config = configurations.get(relativePath) || readMcpConfig(root, relativePath);
    configurations.set(relativePath, config);
    const servers = mcpConfigServers(config.data);
    const existing = Object.hasOwn(servers, serverName) ? servers[serverName] : undefined;
    if (existing !== undefined && !isJsonObject(existing)) {
      throw new CatalogError(`Invalid MCP server entry ${serverName} in ${relativePath}; repair it before retrying.`);
    }
    const existingObject = isJsonObject(existing) ? existing : {};
    const tracked = recordConfigurations[relativePath];
    if (tracked && !tracked.managed && Array.isArray(existingObject.args) && existingObject.args.some((argument) =>
      Object.keys(record.files).some((file) => argument === path.join(root, ...file.split("/"))))) {
      conflict(`User-managed MCP ${serverName} in ${relativePath} still references a tracked legacy launcher. Update that entry manually before removing the launcher.`);
    }
    if (tracked?.managed && existing !== undefined && digest(existing) !== tracked.sha256) {
      conflict(`MCP ${serverName} was locally modified in ${relativePath}. Review it before retrying; --force does not replace shared configuration entries.`);
    }
    if (!tracked?.managed && existing !== undefined) {
      if (Object.keys(options.inputs || {}).some((key) => key.startsWith(`${mcp.id}.`))) {
        conflict(`Cannot apply inputs to pre-existing MCP ${serverName} in ${relativePath}; its configuration is user-managed.`);
      }
      recordConfigurations[relativePath] = { managed: false };
      (options.output || console).log(`Reusing existing MCP ${serverName} in ${relativePath}; its configuration and authentication remain user-managed. Declared inputs are not applied to this existing server.`);
      continue;
    }
    if (tracked && !tracked.managed && existing === undefined) {
      conflict(`Previously reused MCP ${serverName} is missing from ${relativePath}. Restore it or uninstall the bundle before configuring it again.`);
    }
    if (!isJsonObject(config.data.mcpServers)) config.data.mcpServers = servers;
    Object.defineProperty(servers, serverName, { value: desired, enumerable: true, configurable: true, writable: true });
    recordConfigurations[relativePath] = { managed: true, sha256: digest(desired) };
    config.changed = true;
  }
  if (Object.values(recordConfigurations).some((config) => config.managed)) {
    const command = Object.values(mcp.mcp_config.mcpServers)[0].command;
    if (desired.type !== "http" && !executableAvailable(command)) {
      const message = `MCP ${mcp.id}: executable '${command}' is not available on PATH. Install it before starting the server; the client's PATH may differ.`;
      if (!options.dryRun) throw new CatalogError(message, "MISSING_PREREQUISITE");
      (options.output || console).error(message);
    }
    for (const [relativePath, expected] of Object.entries(record.files)) {
      const actual = installedFingerprint(root, relativePath);
      if (actual && !sameFingerprint(actual, expected)) {
        conflict(`Legacy MCP launcher ${relativePath} has local changes. Back them up and restore the tracked version before migration; --force does not delete a modified launcher during migration.`);
      }
      if (actual) remove.add(relativePath);
    }
    record.files = {};
  }
  record.values = values;
  record.digest = digest({ mcp_config: mcp.mcp_config, inputs: mcp.inputs });
  state.mcps[mcp.id] = record;
}

function executableAvailable(command) {
  const directories = path.isAbsolute(command) ? [""] : (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const extensions = process.platform === "win32" && !path.extname(command)
    ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  return directories.some((directory) => extensions.some((extension) => {
    const file = path.isAbsolute(command) ? `${command}${extension}` : path.join(directory, `${command}${extension}`);
    try {
      fs.accessSync(file, process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
      return fs.statSync(file).isFile();
    } catch (error) {
      if (!["ENOENT", "ENOTDIR", "EACCES"].includes(error.code)) throw error;
      return false;
    }
  }));
}

async function installConfiguredResources(
  selected: CatalogResource[],
  resources: CatalogResource[],
  root: string,
  catalogRoot: string,
  buildInfo: BuildInfo,
  options: CliOptions = {},
) {
  validateBundleReferences(resources);
  const bundles = selected.filter((resource) => resource.kind === "bundle");
  const state = readInstallState(root);
  const inventoryFingerprint = installedFingerprint(root, LOCK_PATH);
  const local = new Map<string, { resource: CatalogResource; tool: InstallationTool }>((options.extraResources || []).map((resource) => [
    `${resource.kind}:${resource.id}`, { resource, tool: state.resources[`${resource.kind}:${resource.id}`].tool },
  ]));
  const mcps = new Map<string, {
    mcp: CatalogResource;
    tool: InstallationTool;
    bundleId: string | null;
    standaloneTool?: InstallationTool | null;
  }>();
  const scope: InventoryScope = options.scope || "project";
  for (const bundle of bundles) {
    const previous = Object.hasOwn(state.bundles, bundle.id) ? state.bundles[bundle.id] : undefined;
    if (previous && previous.scope !== scope) conflict(`Bundle ${bundle.id} is already installed with ${previous.scope} scope in this target.`);
    const tool = options.tool || previous?.tool;
    if (!tool) throw new CatalogError(`No registered runtimes for bundle ${bundle.id}`);
    for (const runtime of tools(tool)) {
      if (bundle.compatibility[runtime].status === "unsupported") {
        throw new CatalogError(`Bundle ${bundle.id} does not support ${runtime}`, "UNSUPPORTED_RUNTIME");
      }
    }
    if (previous && previous.resources.some((member) => !bundle.resources.some((current) => identity(current) === identity(member)))) {
      conflict(`Bundle ${bundle.id} removed dependencies. Uninstall and reinstall it explicitly to review dependency removal.`);
    }
    for (const member of bundle.resources) {
      if (member.kind === "mcp") {
        const mcp = resources.find((resource) => resource.id === member.id && resource.kind === "mcp");
        const current = mcps.get(mcp.id);
        mcps.set(mcp.id, { mcp, tool: current ? unionTool(current.tool, tool) : tool, bundleId: bundle.id });
      } else {
        const resource = resources.find((resource) => resource.kind === member.kind && resource.id === member.id);
        if (scope === "user" && resource.kind === "instruction") {
          throw new CatalogError(`Bundle ${bundle.id} includes project-only instructions`, "INVALID_ARGUMENT");
        }
        validateResource(resource, catalogRoot);
        const key = `${resource.kind}:${resource.id}`;
        const currentTool = local.get(key)?.tool || state.resources[key]?.tool;
        local.set(key, { resource, tool: currentTool ? unionTool(currentTool, tool) : tool });
      }
    }
    state.bundles[bundle.id] = { tool, scope, resources: bundle.resources,
      digest: bundleDigest(bundle, bundle.resources.filter((member) => member.kind === "mcp")
        .map((member) => resources.find((resource) => resource.id === member.id && resource.kind === "mcp"))) };
    options.onResource?.({ catalog: "internal", kind: "bundle", id: bundle.id, status: "planned" });
  }
  for (const mcp of selected.filter((resource) => resource.kind === "mcp")) {
    const previous = Object.hasOwn(state.mcps, mcp.id) ? state.mcps[mcp.id] : undefined;
    if (previous?.standalone && previous.scope !== scope) conflict(`MCP ${mcp.id} is independently installed in ${previous.scope} scope; use that scope for maintenance.`);
    const requested = options.tool || (previous?.standalone ? previous.tool : registeredMcpTool(state, mcp.id));
    const owners = previous ? registeredMcpTool(state, mcp.id) : requested;
    const tool = unionTool(mcps.get(mcp.id)?.tool || owners, requested);
    const standaloneTool = options.command === "update" ? previous?.standalone ? previous.tool : null : requested;
    mcps.set(mcp.id, { mcp, tool, bundleId: mcps.get(mcp.id)?.bundleId || null, standaloneTool });
  }
  let terminal;
  try {
    if (!options.nonInteractive && !options.dryRun && process.stdin.isTTY && process.stdout.isTTY) {
      terminal = createInterface({ input: process.stdin, output: process.stdout });
    }
    const values = await configureInputs([...mcps.values()].map(({ mcp }) => mcp), state, options,
      terminal ? (question) => terminal.question(question) : null);
    const plan = new Map<string, InstallPlanEntry>();
    const configurations = new Map<string, McpFileConfig>();
    const remove = new Set<string>();
    for (const { resource, tool } of local.values()) {
      const prepared = prepareResourceInstall([resource], catalogRoot, root, tool, buildInfo, { ...options, bundle: true }, state);
      for (const [relativePath, file] of prepared.plan) plan.set(relativePath, file);
      for (const relativePath of prepared.remove) remove.add(relativePath);
      options.onResource?.({ catalog: "internal", kind: resource.kind, id: resource.id, status: "planned" });
    }
    for (const { mcp, tool, bundleId, standaloneTool } of mcps.values()) {
      options.onResource?.({ catalog: "internal", kind: "mcp", id: mcp.id, status: "planned" });
      prepareMcp(mcp, values[mcp.id], state, root, tool, scope, plan, configurations, remove, { ...options, id: bundleId, standaloneTool });
    }
    for (const [relativePath, config] of configurations) {
      if (config.changed) addConfigPlan(plan, relativePath, config);
    }
    addInventoryStateToPlan(plan, state);
    plan.get(LOCK_PATH).expected = inventoryFingerprint;
    for (const [relativePath, file] of plan) {
      if (!Object.hasOwn(file, "expected")) file.expected = installedFingerprint(root, relativePath);
    }
    const expectedRemovals = new Map([...remove].map((relativePath) => [relativePath, installedFingerprint(root, relativePath)]));
    const settings = { ...options, force: true, remove: [...remove], expectedRemovals };
    const messages = writeInstallPlan(plan, root, { ...settings, dryRun: true, onAction: () => {} });
    if (!options.dryRun) {
      const output = options.output || console;
      for (const message of messages) output.log(message);
      output.log("Managed MCPs and bundles target Copilot CLI and Claude Code CLI only; desktop apps and IDE integrations are outside the managed setup support scope.");
      if (mcps.size) output.log("MCP servers are configured directly with native ${VARIABLE} references. Set required variables in the CLI's environment, restart the CLI and approve the server. Existing MCPs are never taken over.");
      if (mcps.size) output.log("Configuration only: no server was started and no authentication was performed. Complete any client-required OAuth separately.");
      if (!options.yes) {
        if (!terminal) throw new CatalogError("MCP/bundle setup requires confirmation. Review --dry-run first, then use --yes for non-interactive installation.", "INVALID_ARGUMENT");
        if (!/^(y|yes)$/i.test(await terminal.question("Apply this configuration plan? [y/N] "))) {
          return { messages: ["Cancelled; no files written."], cancelled: true };
        }
      }
    }
    return { messages: writeInstallPlan(plan, root, settings), cancelled: false };
  } finally {
    terminal?.close();
  }
}

module.exports = {
  ...bundleUtils, validateBundleReferences, nativeMcpConfig, installConfiguredResources,
};
