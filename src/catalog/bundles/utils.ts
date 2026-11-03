"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { CatalogError, addPlanEntry } = require("../resources/index.js");
const { targetPath, installedFingerprint } = require("../inventory/index.js");
import type { BundleMember, CatalogResource, McpServer } from "../entries.js";
import type { JsonObject, JsonValue } from "../json.js";
import { isJsonObject } from "../json.js";
import type { InstallState, McpInventoryRecord, InstallationTool } from "../inventory/files.js";
import type { FileFingerprint, InstallPlanEntry } from "../plan.js";

export interface McpFileConfig {
  data: JsonObject;
  fingerprint: FileFingerprint | null;
  mode: number;
  changed?: boolean;
}

function mcpConfigServers(data: JsonObject): JsonObject {
  return isJsonObject(data.mcpServers) ? data.mcpServers : {};
}

const digest = (value: JsonValue | object) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const identity = (member: BundleMember) => `${member.kind === "mcp" ? "internal" : member.catalog}:${member.kind}:${member.id}`;
const conflict = (message: string): never => { throw new CatalogError(message, "LOCAL_CONFLICT"); };
const tools = (tool: InstallationTool): Array<"claude" | "copilot"> => tool === "both" ? ["claude", "copilot"] : [tool];
const unionTool = (left: InstallationTool, right: InstallationTool): InstallationTool => new Set([...tools(left), ...tools(right)]).size === 2 ? "both" : right;

function bundleDigest(bundle: CatalogResource, mcps: CatalogResource[] = []) {
  const { source, applyTo, catalog, ...metadata } = bundle;
  return digest({ format: "native-mcp-v1", bundle: metadata,
    mcps: mcps.map(({ id, mcp_config, inputs }) => ({ id, mcp_config, inputs })) });
}

function readMcpConfig(root: string, relativePath: string): McpFileConfig {
  const fingerprint = installedFingerprint(root, relativePath);
  if (!fingerprint) return { data: {}, fingerprint: null, mode: 0o600 };
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(targetPath(root, relativePath), "utf8"));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new CatalogError(`Invalid JSON in MCP configuration ${relativePath}. Repair it before retrying.`);
  }
  if (!isJsonObject(data) ||
      (data.mcpServers !== undefined && !isJsonObject(data.mcpServers))) {
    throw new CatalogError(`MCP configuration ${relativePath} must be an object with an optional mcpServers object`);
  }
  return { data, fingerprint, mode: fs.statSync(targetPath(root, relativePath)).mode & 0o777 };
}

function addConfigPlan(plan: Map<string, InstallPlanEntry>, relativePath: string, config: McpFileConfig): void {
  const content = Buffer.from(`${JSON.stringify(config.data, null, 2)}\n`);
  addPlanEntry(plan, relativePath, content);
  Object.assign(plan.get(relativePath), { expected: config.fingerprint, mode: config.mode });
}

function isUserMcp(record: McpInventoryRecord): boolean {
  return record.standalone ? record.scope === "user" : !Object.hasOwn(record.configurations, ".mcp.json");
}

function registeredMcpTool(state: InstallState, id: string): InstallationTool {
  const record = state.mcps?.[id];
  const bundles = state.bundles || {};
  const registered: InstallationTool[] = [
    ...(record?.tool ? [record.tool] : []),
    ...(record?.configurations[".claude.json"]?.managed ? ["claude" as const] : []),
    ...(record?.configurations[".copilot/mcp-config.json"]?.managed ? ["copilot" as const] : []),
    ...Object.values(bundles).filter((bundle) => bundle.resources.some((member) =>
      member.kind === "mcp" && member.id === id)).map((bundle) => bundle.tool),
  ];
  if (!registered.length) throw new CatalogError(`No registered runtimes for mcp:${id}`);
  return registered.reduce((left, right) => unionTool(left, right));
}
module.exports = {
  digest, identity, conflict, tools, unionTool, bundleDigest, readMcpConfig, mcpConfigServers, addConfigPlan,
  isUserMcp, registeredMcpTool,
};
