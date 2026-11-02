"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { CatalogError, mcpConfigPaths, addPlanEntry } = require("../resources/index.js");
const { targetPath, installedFingerprint } = require("../inventory/index.js");
import type {
  CatalogResource, InstallState, JsonRecord, McpFileConfig, McpServer,
} from "../../types.js";

const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const identity = (member) => `${member.kind === "mcp" ? "internal" : member.catalog}:${member.kind}:${member.id}`;
const conflict = (message) => { throw new CatalogError(message, "LOCAL_CONFLICT"); };
const tools = (tool) => tool === "both" ? ["claude", "copilot"] : [tool];
const unionTool = (left, right) => new Set([...tools(left), ...tools(right)]).size === 2 ? "both" : right;

function bundleDigest(bundle: CatalogResource, mcps: CatalogResource[] = []) {
  const { source, applyTo, catalog, ...metadata } = bundle;
  return digest({ format: "native-mcp-v1", bundle: metadata,
    mcps: mcps.map(({ id, mcp_config, inputs }) => ({ id, mcp_config, inputs })) });
}

function readMcpConfig(root: string, relativePath: string): McpFileConfig {
  const fingerprint = installedFingerprint(root, relativePath);
  if (!fingerprint) return { data: {}, fingerprint: null, mode: 0o600 };
  let data;
  try {
    data = JSON.parse(fs.readFileSync(targetPath(root, relativePath), "utf8"));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new CatalogError(`Invalid JSON in MCP configuration ${relativePath}. Repair it before retrying.`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      (data.mcpServers !== undefined && (!data.mcpServers ||
        typeof data.mcpServers !== "object" || Array.isArray(data.mcpServers)))) {
    throw new CatalogError(`MCP configuration ${relativePath} must be an object with an optional mcpServers object`);
  }
  return { data, fingerprint, mode: fs.statSync(targetPath(root, relativePath)).mode & 0o777 };
}

function addConfigPlan(plan: Map<string, JsonRecord>, relativePath: string, config: McpFileConfig) {
  const content = Buffer.from(`${JSON.stringify(config.data, null, 2)}\n`);
  addPlanEntry(plan, relativePath, content);
  Object.assign(plan.get(relativePath), { expected: config.fingerprint, mode: config.mode });
}

function isUserMcp(record: JsonRecord): boolean {
  return record.standalone ? record.scope === "user" : !Object.hasOwn(record.configurations, ".mcp.json");
}

function registeredMcpTool(state: InstallState, id: string): string {
  const record = state.mcps?.[id];
  const bundles: Record<string, JsonRecord> = state.bundles || {};
  const registered = [
    ...(record?.tool ? [record.tool] : []),
    ...(record?.configurations[".claude.json"]?.managed ? ["claude"] : []),
    ...(record?.configurations[".copilot/mcp-config.json"]?.managed ? ["copilot"] : []),
    ...Object.values(bundles).filter((bundle) => bundle.resources.some((member) =>
      member.kind === "mcp" && member.id === id)).map((bundle) => bundle.tool),
  ];
  if (!registered.length) throw new CatalogError(`No registered runtimes for mcp:${id}`);
  return registered.reduce((left, right) => unionTool(left, right));
}

module.exports = {
  digest, identity, conflict, tools, unionTool, bundleDigest, readMcpConfig, addConfigPlan,
  isUserMcp, registeredMcpTool,
};
