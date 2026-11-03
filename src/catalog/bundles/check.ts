"use strict";

const { inspectInstalledFiles } = require("../inventory/index.js");
const { digest, bundleDigest, readMcpConfig, isUserMcp, registeredMcpTool, tools } = require("./utils.js");
import type { CatalogResource } from "../entries.js";
import type { InstallState, McpInventoryRecord } from "../inventory/files.js";

function checkMcps(
  root: string,
  state: InstallState,
  resources: CatalogResource[],
  { scope }: { scope?: string } = {},
): CatalogResource[] {
  const mcpRecords = state.mcps || {};
  return Object.entries(mcpRecords).filter(([, record]) => scope !== "user" || isUserMcp(record))
    .map(([id, record]) => checkMcp(root, state, resources, id, record));
}

function checkMcp(
  root: string,
  state: InstallState,
  resources: CatalogResource[],
  id: string,
  record: McpInventoryRecord,
): CatalogResource {
  const result: CatalogResource = { catalog: "internal", kind: "mcp", id, status: "current", issues: [] };
  const issue = (code: string, paths: string[] = []) => { result.status = "attention"; result.issues.push({ code, paths }); };
  const resource = resources.find((entry) => entry.kind === "mcp" && entry.id === id);
  if (!resource) issue("REMOVED_FROM_CATALOG");
  else {
    if (resource.status === "deprecated") issue("DEPRECATED");
    if (tools(registeredMcpTool(state, id)).some((runtime) => resource.compatibility[runtime].status === "unsupported")) issue("UNSUPPORTED_RUNTIME");
    if (digest({ mcp_config: resource.mcp_config, inputs: resource.inputs }) !== record.digest ||
        Object.keys(record.files).length) issue("UPDATE_AVAILABLE");
  }
  const { missing, modified } = inspectInstalledFiles(root, record);
  if (missing.length) issue("MISSING_FILES", missing);
  if (modified.length) issue("LOCAL_MODIFICATIONS", modified);
  for (const [relativePath, tracked] of Object.entries(
    record.configurations,
  )) {
    const config = readMcpConfig(root, relativePath);
    const entry = Object.hasOwn(config.data.mcpServers || {}, record.server) ? config.data.mcpServers[record.server] : undefined;
    if (entry === undefined) issue("MISSING_FILES", [relativePath]);
    else if (tracked.managed && digest(entry) !== tracked.sha256) issue("LOCAL_MODIFICATIONS", [relativePath]);
  }
  return result;
}

function checkBundles(
  root: string,
  state: InstallState,
  resources: CatalogResource[],
  checkedDependencies: CatalogResource[] = checkMcps(root, state, resources),
) {
  const dependencies = new Map<string, CatalogResource>(checkedDependencies.filter((resource) => resource.catalog === "internal")
    .map((resource) => [`${resource.kind}:${resource.id}`, resource]));
  const results: CatalogResource[] = [];
  const bundleRecords = state.bundles || {};
  const mcpRecords = state.mcps || {};
  for (const [id, record] of Object.entries(bundleRecords)) {
    const result: CatalogResource = { catalog: "internal", kind: "bundle", id, status: "current", issues: [] };
    const issue = (code: string, paths: string[] = []) => {
      result.status = "attention";
      if (!result.issues.some((finding) => finding.code === code && JSON.stringify(finding.paths) === JSON.stringify(paths))) {
        result.issues.push({ code, paths });
      }
    };
    const bundle = resources.find((resource) => resource.kind === "bundle" && resource.id === id);
    if (!bundle) issue("REMOVED_FROM_CATALOG");
    else {
      if (bundle.status === "deprecated") issue("DEPRECATED");
      if (tools(record.tool).some((tool) => bundle.compatibility[tool].status === "unsupported")) issue("UNSUPPORTED_RUNTIME");
      const mcps = bundle.resources.filter((member) => member.kind === "mcp").map((member) =>
        resources.find((mcp) => mcp.id === member.id && mcp.kind === "mcp"))
        .filter((mcp): mcp is CatalogResource => Boolean(mcp));
      if (mcps.every(Boolean) && bundleDigest(bundle, mcps) !== record.digest) issue("UPDATE_AVAILABLE");
    }
    for (const member of record.resources) {
      const checked = dependencies.get(`${member.kind}:${member.id}`) ||
        (member.kind === "mcp" ? checkMcp(root, state, resources, member.id, mcpRecords[member.id]) : null);
      if (checked) {
        for (const finding of checked.issues) issue(finding.code, finding.paths);
        continue;
      }
      const dependency = member.kind === "mcp" ? mcpRecords[member.id] : state.resources[`${member.kind}:${member.id}`];
      const files = inspectInstalledFiles(root, dependency);
      if (files.missing.length) issue("MISSING_FILES", files.missing);
      if (files.modified.length) issue("LOCAL_MODIFICATIONS", files.modified);
    }
    results.push(result);
  }
  return results;
}

module.exports = { checkBundles, checkMcps };
