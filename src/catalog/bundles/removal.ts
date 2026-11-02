"use strict";

const { CatalogError, LOCK_PATH } = require("../resources/index.js");
const {
  readInstallState, installedFingerprint, inspectInstalledFiles, writeInstallPlan,
  isUserResource, addInventoryStateToPlan,
} = require("../inventory/index.js");
const {
  digest, identity, conflict, readMcpConfig, addConfigPlan, isUserMcp,
} = require("./utils.js");
import type {
  BundleMember, CatalogResource, CliOptions, InstallState, JsonRecord, McpConfiguration, McpFileConfig,
} from "../../types.js";

function prepareMcpRemoval(
  id: string,
  record: JsonRecord,
  root: string,
  configurations: Map<string, McpFileConfig>,
  remove: string[],
  messages: string[],
  options: CliOptions,
) {
  for (const [relativePath, tracked] of Object.entries(
    record.configurations as Record<string, McpConfiguration>,
  )) {
    if (!tracked.managed) {
      messages.push(`Preserved pre-existing MCP ${record.server} in ${relativePath}`);
      continue;
    }
    const config = configurations.get(relativePath) || readMcpConfig(root, relativePath);
    configurations.set(relativePath, config);
    const entry = Object.hasOwn(config.data.mcpServers || {}, record.server) ? config.data.mcpServers[record.server] : undefined;
    if (entry !== undefined && digest(entry) !== tracked.sha256) conflict(`MCP ${record.server} was locally modified in ${relativePath}; refusing to remove it, even with --force.`);
    if (entry !== undefined) {
      delete config.data.mcpServers[record.server];
      config.changed = true;
    }
  }
  const { modified } = inspectInstalledFiles(root, record);
  if (modified.length && !options.force) conflict(`Refusing to remove locally modified launchers: ${modified.join(", ")}`);
  remove.push(...Object.keys(record.files));
  options.onResource?.({ catalog: "internal", kind: "mcp", id, status: "planned" });
}

function memberKey(member: { kind: string; id: string }): string {
  return `${member.kind}:${member.id}`;
}

function prepareUninstall(
  bundleIds: string[],
  root: string,
  options: CliOptions = {},
  requestedResource: CatalogResource | null = null,
) {
  const state = readInstallState(root);
  const inventoryFingerprint = installedFingerprint(root, LOCK_PATH);
  const bundleRecords: Record<string, JsonRecord> = state.bundles || {};
  const mcpRecords: Record<string, JsonRecord> = state.mcps || {};
  const bundles: Array<[string, JsonRecord]> = bundleIds.map((id): [string, JsonRecord] => {
    const bundle = Object.hasOwn(bundleRecords, id) ? bundleRecords[id] : null;
    if (!bundle || options.scope && bundle.scope !== options.scope) {
      throw new CatalogError(`No tracked installation for bundle:${id}`, "RESOURCE_NOT_FOUND");
    }
    return [id, bundle];
  });
  if (requestedResource) {
    const { kind, id } = requestedResource;
    const record = kind === "mcp" ? mcpRecords[id] : state.resources[`${kind}:${id}`];
    const installedInScope = kind === "mcp"
      ? record && (options.scope !== "user" || isUserMcp(record))
      : record && (options.scope !== "user" || isUserResource(`${kind}:${id}`, record));
    if (!installedInScope) {
      throw new CatalogError(`No tracked installation for ${kind}:${id}`, "RESOURCE_NOT_FOUND");
    }
    const dependents = Object.entries(bundleRecords).filter(([, bundle]) =>
      bundle.resources.some((member) => memberKey(member) === `${kind}:${id}`));
    if (options.scope && dependents.some(([, bundle]) => bundle.scope !== options.scope)) {
      throw new CatalogError(
        `${kind}:${id} is also required by bundles outside ${options.scope} scope; refusing to remove resources in another scope.`,
        "LOCAL_CONFLICT",
      );
    }
    if (dependents.length !== bundleIds.length ||
        dependents.some(([bundleId]) => !bundleIds.includes(bundleId))) {
      throw new CatalogError(`Cascade plan for ${kind}:${id} does not include every dependent bundle.`, "LOCAL_CONFLICT");
    }
  }

  const plan = new Map();
  const configurations = new Map<string, McpFileConfig>();
  const remove: string[] = [];
  const messages = [];
  const requestedKey = requestedResource ? `${requestedResource.kind}:${requestedResource.id}` : null;
  const members = new Map<string, BundleMember>();
  for (const [id, bundle] of bundles) {
    delete state.bundles[id];
    options.onResource?.({ catalog: "internal", kind: "bundle", id, status: "planned" });
    for (const member of bundle.resources) members.set(memberKey(member), member);
  }

  const removed = new Set();
  const preserved = new Set();
  const removeMember = (member: BundleMember, explicit = false) => {
    const key = memberKey(member);
    const resourceRecord = member.kind === "mcp" ? state.mcps[member.id] : state.resources[key];
    if (!resourceRecord) {
      throw new CatalogError(`Bundle dependency ${key} has no tracked installation; refusing partial removal.`, "LOCAL_CONFLICT");
    }
    if (!explicit && resourceRecord.standalone) {
      messages.push(member.kind === "mcp"
        ? `Preserved independently installed MCP: ${key}`
        : `Preserved independently installed resource: ${key}`);
      preserved.add(key);
      return;
    }
    if (member.kind === "mcp") {
      prepareMcpRemoval(member.id, resourceRecord, root, configurations, remove, messages, options);
      delete state.mcps[member.id];
    } else {
      const { modified } = inspectInstalledFiles(root, resourceRecord);
      if (modified.length && !options.force) {
        conflict(`Refusing to remove locally modified files: ${modified.join(", ")}`);
      }
      remove.push(...Object.keys(resourceRecord.files));
      delete state.resources[key];
      options.onResource?.({ catalog: "internal", kind: member.kind, id: member.id, status: "planned" });
    }
    removed.add(key);
  };

  for (const [key, member] of members) {
    if (key === requestedKey) continue;
    const shared = Object.values(bundleRecords).some((other) =>
      other.resources.some((entry) => memberKey(entry) === key));
    if (shared) {
      messages.push(`Preserved shared dependency: ${identity(member)}`);
      preserved.add(key);
      continue;
    }
    removeMember(member);
  }
  if (requestedResource) {
    removeMember({ ...requestedResource, catalog: "internal" }, true);
  }
  for (const [relativePath, config] of configurations) {
    if (config.changed) addConfigPlan(plan, relativePath, config);
  }
  addInventoryStateToPlan(plan, state);
  plan.get(LOCK_PATH).expected = inventoryFingerprint;
  const uniqueRemove = [...new Set(remove)];
  const expectedRemovals = new Map(uniqueRemove.map((relativePath) =>
    [relativePath, installedFingerprint(root, relativePath)]));
  const settings = { ...options, force: true, remove: uniqueRemove, expectedRemovals };
  const summary = requestedResource ? {
    resource: requestedKey,
    bundles: bundles.map(([id]) => id),
    dependencies: [...removed].filter((key) => key !== requestedKey).sort(),
    preserved: [...preserved].sort(),
  } : null;
  return { plan, settings, messages, summary };
}

function cascadeSummaryText(summary: JsonRecord): string {
  const parts = [
    `Cascade uninstall of ${summary.resource} will also remove bundles: ${summary.bundles.join(", ")}.`,
  ];
  if (summary.dependencies.length) parts.push(`Additional dependencies removed: ${summary.dependencies.join(", ")}.`);
  if (summary.preserved.length) parts.push(`Shared or independently installed dependencies preserved: ${summary.preserved.join(", ")}.`);
  return parts.join(" ");
}

function uninstallBundle(id: string, root: string, options: CliOptions = {}) {
  const prepared = prepareUninstall([id], root, options);
  const messages = writeInstallPlan(prepared.plan, root, prepared.settings);
  return [...prepared.messages, ...messages];
}

async function uninstallResourceWithBundles(kind: BundleMember["kind"], id: string, root: string, options: CliOptions = {}) {
  const state = readInstallState(root);
  const bundleRecords: Record<string, JsonRecord> = state.bundles || {};
  const dependents = Object.entries(bundleRecords).filter(([, bundle]) =>
    bundle.resources.some((member) => memberKey(member) === `${kind}:${id}`)).map(([bundleId]) => bundleId);
  if (!dependents.length) {
    throw new CatalogError(`No bundles depend on ${kind}:${id}; use the regular uninstall command.`, "INVALID_ARGUMENT");
  }
  const prepared = prepareUninstall(dependents, root, options, { kind, id });
  const preview = writeInstallPlan(prepared.plan, root, {
    ...prepared.settings, dryRun: true, onAction: options.dryRun ? options.onAction : () => {},
  });
  const summaryText = cascadeSummaryText(prepared.summary);
  if (options.dryRun) return [summaryText, ...prepared.messages, ...preview];
  if (!options.cascade) {
    if (typeof options.confirm !== "function") {
      throw new CatalogError(
        `${kind}:${id} is required by bundles: ${dependents.join(", ")}. Re-run with --cascade to remove them non-interactively.`,
        "LOCAL_CONFLICT",
      );
    }
    if (!await options.confirm(prepared.summary, [summaryText, ...prepared.messages, ...preview])) {
      return ["Cancelled; no files written."];
    }
    return [...prepared.messages, ...writeInstallPlan(prepared.plan, root, prepared.settings)];
  }
  return [summaryText, ...prepared.messages, ...writeInstallPlan(prepared.plan, root, prepared.settings)];
}

function uninstallMcp(id: string, root: string, options: CliOptions = {}) {
  const state = readInstallState(root);
  const mcpRecords: Record<string, JsonRecord> = state.mcps || {};
  const bundleRecords: Record<string, JsonRecord> = state.bundles || {};
  const record = Object.hasOwn(mcpRecords, id) ? mcpRecords[id] : null;
  if (!record || options.scope === "user" && !isUserMcp(record)) throw new CatalogError(`No tracked installation for mcp:${id}`, "RESOURCE_NOT_FOUND");
  const dependents = Object.entries(bundleRecords).filter(([, bundle]) => bundle.resources.some((member) =>
    member.kind === "mcp" && member.id === id)).map(([id]) => id);
  if (dependents.length) conflict(`mcp:${id} is required by bundles: ${dependents.join(", ")}. Uninstall those bundles first.`);
  const plan = new Map();
  const configurations = new Map<string, McpFileConfig>();
  const remove: string[] = [];
  const messages = [];
  prepareMcpRemoval(id, record, root, configurations, remove, messages, options);
  delete state.mcps[id];
  for (const [relativePath, config] of configurations) {
    if (config.changed) addConfigPlan(plan, relativePath, config);
  }
  addInventoryStateToPlan(plan, state);
  return [...messages, ...writeInstallPlan(plan, root, { ...options, force: true, remove })];
}

module.exports = {
  uninstallBundle, uninstallMcp, uninstallResourceWithBundles, cascadeSummaryText,
};
