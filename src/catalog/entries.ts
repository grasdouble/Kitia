"use strict";

const { matchesSearch } = require("./search.js");
import type { CatalogResource, JsonRecord, McpInput, McpServer } from "../types.js";
// File-backed kinds use the filesystem planner; MCPs and bundles use declarative plans.
const INSTALLABLE_KINDS = new Set(["skill", "agent", "instruction"]);
const LOCAL_KINDS = new Set([...INSTALLABLE_KINDS, "bundle", "mcp"]);
const KINDS = new Set(LOCAL_KINDS);
const STATUSES = new Set(["experimental", "stable", "deprecated"]);
const GROUP_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COMMON_FIELDS = [
  "id", "kind", "description", "owner", "category", "tags", "status",
  "use_when", "example", "expected_output", "prerequisites", "limitations",
  "deprecation_reason", "replacement",
];

function validateEntry(
  entry: JsonRecord,
  label: string,
  ErrorType: new (message: string) => Error = Error,
): void {
  const fail = (message) => { throw new ErrorType(`${label}: ${message}`); };
  const local = LOCAL_KINDS.has(entry.kind);
  const allowed = new Set([
    ...COMMON_FIELDS,
    ...(local
      ? ["group", "compatibility", "apply_to", ...(entry.kind === "bundle" ? ["resources"] : []),
        ...(entry.kind === "mcp" ? ["url", "access", "data_policy", "last_reviewed", "mcp_config", "installation", "inputs"] : [])]
      : [
        "url", "access", "data_policy", "last_reviewed",
      ]),
  ]);
  const unknown = Object.keys(entry).filter((key) => !allowed.has(key));
  if (unknown.length) {
    fail(`unsupported fields: ${unknown.sort().join(", ")}`);
  }
  for (const field of ["owner", "category", "use_when", "example", "expected_output"]) {
    if (typeof entry[field] !== "string" || !entry[field].trim()) {
      fail(`${field} must be a non-empty string`);
    }
  }
  for (const field of ["tags", "prerequisites", "limitations"]) {
    if (!Array.isArray(entry[field]) || !entry[field].length ||
        entry[field].some((value) => typeof value !== "string" || !value.trim()) ||
        new Set(entry[field]).size !== entry[field].length) {
      fail(`${field} must be a non-empty array of unique strings`);
    }
  }
  if (!STATUSES.has(entry.status)) {
    fail(`status must be one of: ${[...STATUSES].join(", ")}`);
  }
  if (entry.status === "deprecated") {
    if (typeof entry.deprecation_reason !== "string" || !entry.deprecation_reason.trim()) {
      fail("deprecated entries require a deprecation_reason");
    }
  } else if (entry.deprecation_reason || entry.replacement) {
    fail("deprecation_reason and replacement are only valid for deprecated entries");
  }
  if (entry.replacement !== undefined && typeof entry.replacement !== "string") {
    fail("replacement must be a kind:id reference");
  }
  if (entry.kind === "bundle") {
    if (!Array.isArray(entry.resources) || !entry.resources.length ||
        entry.resources.some((member) => !member || Array.isArray(member) ||
          Object.keys(member).sort().join(",") !== "catalog,id,kind" ||
          typeof member.id !== "string" || !GROUP_ID.test(member.id) ||
          !(member.catalog === "internal" && (INSTALLABLE_KINDS.has(member.kind) || member.kind === "mcp"))) ||
        new Set(entry.resources.map((member) => `${member.catalog}:${member.kind}:${member.id}`)).size !== entry.resources.length) {
      fail("resources must contain unique internal skill/agent/instruction/MCP identities");
    }
  }
  if (local) {
    if (typeof entry.group !== "string" || !GROUP_ID.test(entry.group)) {
      fail("group must be a lowercase kebab-case identifier");
    }
    const compatibility = entry.compatibility as Record<string, { status: string }>;
    if (!compatibility || Array.isArray(compatibility) ||
        typeof compatibility !== "object" ||
        Object.keys(compatibility).some((key) => !["claude", "copilot"].includes(key))) {
      fail("compatibility must describe claude and copilot");
    }
    for (const runtime of ["claude", "copilot"]) {
      const declaration = compatibility[runtime];
      if (!declaration || typeof declaration !== "object" || Array.isArray(declaration) ||
          !["unverified", "compatible", "unsupported"].includes(declaration.status)) {
        fail(`compatibility.${runtime}.status must be unverified, compatible or unsupported`);
      }
      if (Object.keys(declaration).some((key) => key !== "status")) {
        fail(`unsupported compatibility fields for ${runtime}`);
      }
    }
    const supported = Object.values(compatibility).filter((value) => value.status !== "unsupported");
    if (!supported.length) {
      fail("at least one runtime must be supported");
    }
    if (entry.status === "stable" && supported.some((value) => value.status !== "compatible")) {
      fail("stable resources require compatible status for every supported runtime");
    }
  }
  if (!local || entry.kind === "mcp") {
    for (const field of ["url", "access", "data_policy", "last_reviewed"]) {
      if (typeof entry[field] !== "string" || !entry[field].trim()) {
        fail(`${field} must be a non-empty string`);
      }
    }
    let url;
    try {
      url = new URL(entry.url);
    } catch {
      fail("url must be an absolute HTTPS URL");
    }
    if (url.protocol !== "https:" || url.username || url.password) {
      fail("url must use HTTPS without embedded credentials");
    }
    validateDate(entry.last_reviewed, "last_reviewed", fail);
    if (entry.mcp_config !== undefined) {
      validateMcpConfig(entry.mcp_config, fail);
    }
    if (entry.kind === "mcp" && (entry.mcp_config === undefined || entry.inputs === undefined)) {
      fail("MCP entries require mcp_config and an explicit inputs object");
    }
    if (entry.inputs !== undefined) validateMcpInputs(entry, fail);
    if (entry.installation !== undefined) {
      if (entry.kind !== "mcp") {
        fail("installation instructions are only valid for MCP entries");
      }
      validateMcpInstallation(entry.installation, entry.mcp_config !== undefined, fail);
    }
  }
}

function validInputValue(input: McpInput, value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  if (input.type === "json") {
    try {
      JSON.parse(value);
      return true;
    } catch {
      return false;
    }
  }
  if (input.type !== "url") return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validateMcpInputs(entry: JsonRecord, fail: (message: string) => never): void {
  const servers = Object.values(entry.mcp_config?.mcpServers || {}) as McpServer[];
  if (servers.length !== 1 ||
      !entry.inputs || typeof entry.inputs !== "object" || Array.isArray(entry.inputs)) {
    fail("inputs require exactly one MCP server and an input object");
  }
  const inputs = entry.inputs as Record<string, McpInput>;
  if (servers[0].type === "http" && Object.keys(inputs).length) fail("HTTP OAuth MCPs require an empty inputs object");
  const targets = new Set();
  for (const [name, input] of Object.entries(inputs)) {
    if (!/^[a-z][a-z0-9_]*$/.test(name) || !input || Array.isArray(input) ||
        Object.keys(input).some((key) => !["type", "required", "secret", "default", "target_env", "description"].includes(key)) ||
        !["string", "url", "json"].includes(input.type) || typeof input.required !== "boolean" ||
        (input.description !== undefined && (typeof input.description !== "string" || !input.description.trim())) ||
        (input.secret !== undefined && typeof input.secret !== "boolean") ||
        !/^[A-Z_][A-Z0-9_]*$/.test(input.target_env) ||
        targets.has(input.target_env) ||
        (input.secret && (!["string", "json"].includes(input.type) || input.default !== undefined)) ||
        (input.default !== undefined && !validInputValue(input, input.default))) {
      fail(`invalid MCP input '${name}': use a typed environment binding; secrets cannot have defaults`);
    }
    targets.add(input.target_env);
    const reference = `\${${input.target_env}${input.required ? "" : ":-"}}`;
    if (Object.hasOwn(servers[0].env || {}, input.target_env) && servers[0].env[input.target_env] !== reference) {
      fail(`MCP input '${name}' must not also have a literal env value`);
    }
  }
}

function validateMcpConfig(config: JsonRecord, fail: (message: string) => never): void {
  if (!config || Array.isArray(config) || typeof config !== "object" ||
      Object.keys(config).length !== 1 || !config.mcpServers ||
      Array.isArray(config.mcpServers) || typeof config.mcpServers !== "object" ||
      !Object.keys(config.mcpServers).length) {
    fail("mcp_config must contain a non-empty mcpServers object");
  }
  for (const [name, server] of Object.entries(config.mcpServers as Record<string, McpServer>)) {
    if (!/^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/.test(name) ||
        !server || Array.isArray(server) || typeof server !== "object") {
      fail(`mcp_config server '${name}' must define a supported stdio or HTTP server`);
    }
    if (server.type === "http") {
      if (Object.keys(server).some((key) => !["type", "url"].includes(key)) ||
          typeof server.url !== "string") {
        fail(`mcp_config server '${name}' must define only an HTTP type and URL`);
      }
      let url;
      try {
        url = new URL(server.url);
      } catch {
        fail(`mcp_config server '${name}' URL must be an absolute HTTPS URL without credentials`);
      }
      if (url.protocol !== "https:" || url.username || url.password) {
        fail(`mcp_config server '${name}' URL must be an absolute HTTPS URL without credentials`);
      }
      continue;
    }
    if ((server.type !== undefined && server.type !== "stdio") ||
      Object.keys(server).some((key) => !["type", "command", "args", "env"].includes(key)) ||
        typeof server.command !== "string" || !server.command.trim() ||
        !Array.isArray(server.args) ||
        server.args.some((argument) => typeof argument !== "string" || !argument.trim())) {
      fail(`mcp_config server '${name}' must define a command and string args or an HTTPS HTTP URL`);
    }
    if (server.env !== undefined &&
        (!server.env || Array.isArray(server.env) || typeof server.env !== "object" ||
         Object.entries(server.env as Record<string, string>).some(([key, value]) => !key.trim() || typeof value !== "string"))) {
      fail(`mcp_config server '${name}' env must be an object with non-empty keys and string values`);
    }
  }
}

function validateMcpInstallation(
  installation: unknown,
  hasMcpConfig: boolean,
  fail: (message: string) => never,
): void {
  if (!Array.isArray(installation) || !installation.length) {
    fail("installation must be a non-empty array");
  }
  const ids = new Set();
  for (const method of installation) {
    if (!method || Array.isArray(method) || typeof method !== "object" ||
        Object.keys(method).some((key) =>
          !["id", "title", "steps", "command", "config", "include_mcp_config", "note"].includes(key)) ||
        typeof method.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(method.id) ||
        ids.has(method.id) ||
        typeof method.title !== "string" || !method.title.trim() ||
        !Array.isArray(method.steps) || !method.steps.length ||
        method.steps.some((step) => typeof step !== "string" || !step.trim())) {
      fail("installation methods must have unique kebab-case ids, titles and non-empty steps");
    }
    ids.add(method.id);
    if (method.command !== undefined &&
        (typeof method.command !== "string" || !method.command.trim())) {
      fail(`installation method '${method.id}' command must be a non-empty string`);
    }
    if (method.note !== undefined &&
        (typeof method.note !== "string" || !method.note.trim())) {
      fail(`installation method '${method.id}' note must be a non-empty string`);
    }
    if (method.config !== undefined &&
        (!method.config || Array.isArray(method.config) || typeof method.config !== "object")) {
      fail(`installation method '${method.id}' config must be an object`);
    }
    if (method.include_mcp_config !== undefined &&
        (method.include_mcp_config !== true || !hasMcpConfig)) {
      fail(`installation method '${method.id}' may include mcp_config only when it is defined`);
    }
    const contentCount = [
      method.command !== undefined,
      method.config !== undefined,
      method.include_mcp_config === true,
      method.note !== undefined,
    ].filter(Boolean).length;
    if (contentCount !== 1) {
      fail(`installation method '${method.id}' must define exactly one command, config snippet or note`);
    }
  }
}

function validateDate(value: unknown, label: string, fail: (message: string) => never): void {
  if (typeof value !== "string") fail(`${label} must be a valid YYYY-MM-DD date`);
  const date = new Date(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value) {
    fail(`${label} must be a valid YYYY-MM-DD date`);
  }
}

function filterResources(
  resources: CatalogResource[],
  { query = "", kind, tag, status, group }: {
    query?: string;
    kind?: string;
    tag?: string;
    status?: string;
    group?: string;
  } = {},
): CatalogResource[] {
  return resources.filter((resource) => {
    return (!kind || resource.kind === kind) &&
      (!tag || resource.tags.includes(tag)) &&
      (!status || resource.status === status) &&
      (!group || resource.group === group) &&
      matchesSearch(resource, query);
  });
}

function renderMcpInstallation(resource: CatalogResource): string[] {
  const lines = ["", "**Installation instructions:**"];
  for (const method of resource.installation) {
    const title = method.title
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
    lines.push("", "<details>", `<summary>${title}</summary>`, "");
    for (const step of method.steps) {
      lines.push(step, "");
    }
    if (method.command) {
      lines.push("```sh", method.command, "```", "");
    }
    if (method.config) {
      lines.push("```json", JSON.stringify(method.config, null, 2), "```", "");
    }
    if (method.note) {
      lines.push(`> **Note:** ${method.note}`, "");
    }
    if (method.include_mcp_config) {
      lines.push(
        "**Portable `.mcp.json` configuration:**",
        "",
        "```json",
        JSON.stringify(resource.mcp_config, null, 2),
        "```",
        "",
      );
    }
    lines.push("</details>");
  }
  return lines;
}

function formatResource(
  resource: CatalogResource,
  { sourceLinkPrefix = "catalogs/" }: { sourceLinkPrefix?: string } = {},
): string {
  const lines = [
    `## ${resource.kind}: ${resource.id}`,
    "",
    resource.description,
    "",
    `**Status:** ${resource.status} | **Owner:** ${resource.owner}`,
    ...(resource.group ? [`**Group:** ${resource.group}`] : []),
    `**Category:** ${resource.category} | **Tags:** ${resource.tags.join(", ")}`,
    "",
    `**When to use:** ${resource.use_when}`,
    "",
    `**Example:** ${resource.example}`,
    "",
    `**Expected result:** ${resource.expected_output}`,
    "",
    "**Prerequisites:**",
    ...resource.prerequisites.map((item) => `- ${item}`),
    "",
    "**Limitations:**",
    ...resource.limitations.map((item) => `- ${item}`),
  ];
  if (resource.status === "deprecated") {
    lines.push("", `**Deprecation:** ${resource.deprecation_reason}`);
    if (resource.replacement) {
      lines.push(`**Replacement:** ${resource.replacement}`);
    }
  }
  if (LOCAL_KINDS.has(resource.kind)) {
    if (["bundle", "mcp"].includes(resource.kind)) {
      lines.push("", "**CLI clients:** Copilot CLI (`copilot`) and Claude Code CLI (`claude`) only. Desktop apps and IDE integrations are outside the managed setup support scope.");
    }
    lines.push("", "**Compatibility:**");
    for (const [runtime, declaration] of Object.entries(resource.compatibility)) {
      lines.push(`- ${runtime}: ${declaration.status}`);
    }
    if (resource.kind === "instruction") {
      lines.push("", `**Scope:** \`${resource.applyTo.join(", ")}\``);
    }
    const supported = Object.entries(resource.compatibility)
      .filter(([, declaration]) => declaration.status !== "unsupported")
      .map(([runtime]) => runtime);
    const tool = supported.length === 2 ? "both" : supported[0];
    const rootSkill = resource.kind === "skill" && resource.group === "general";
    const source = rootSkill
      ? `../skills/${resource.id}/SKILL.md`
      : ["bundle", "mcp"].includes(resource.kind)
      ? `${resource.group}/${resource.kind === "bundle" ? "bundles" : "mcps"}/${resource.id}.json`
      : resource.kind === "skill"
      ? `${resource.group}/skills/${resource.id}/SKILL.md`
      : `${resource.group}/${resource.kind === "agent" ? "agents" : "instructions"}/${resource.id}.md`;
    const sourceLabel = rootSkill ? `skills/${resource.id}/SKILL.md` : `catalogs/${source}`;
    lines.push(
      "",
      `**Source:** [${sourceLabel}](${sourceLinkPrefix}${source})`,
      "",
      "**Installation (preview, current catalog branch):**",
      "",
      "```sh",
      `npx --yes github:grasdouble/Kitia install ${resource.kind} ${resource.id} --target . --tool ${tool} --dry-run`,
      "```",
    );
    if (resource.kind === "bundle") {
      lines.push("", "**Bundle resources:**",
        ...resource.resources.map((member) => `- ${member.catalog}:${member.kind}:${member.id}`),
        "", "MCP servers are configured directly with native ${VARIABLE} references. Secret values are resolved by the CLI at startup, never collected by the site or saved by the installer.");
    }
    if (resource.kind === "mcp") {
      const server = Object.values(resource.mcp_config.mcpServers)[0];
      lines.push("", `**Transport:** ${server.type === "http" ? "HTTP" : "stdio"}`,
        "", `**Official documentation:** ${resource.url}`,
        "", `**Access and authentication:** ${resource.access}`,
        "", `**Data and permissions:** ${resource.data_policy}`,
        "", `**Documentation last reviewed:** ${resource.last_reviewed}`,
        "", "**MCP configuration inputs:**",
        ...Object.entries(resource.inputs).map(([name, input]) =>
          `- ${name}: ${input.type}${input.secret ? ` secret supplied through \`${input.target_env}\`` : ` environment variable \`${input.target_env}\``} (${input.required ? "required" : "optional"})${input.description ? `: ${input.description}` : ""}`),
        ...(Object.keys(resource.inputs).length ? [] : ["- None; complete any client-managed OAuth separately."]),
        "", "Installation writes configuration only. It does not start the server or complete authentication.");
      if (resource.installation) lines.push(...renderMcpInstallation(resource));
      else lines.push("", "```json", JSON.stringify(resource.mcp_config, null, 2), "```");
    }
  }
  return `${lines.join("\n")}\n`;
}

module.exports = { KINDS, INSTALLABLE_KINDS, LOCAL_KINDS, STATUSES, validateEntry, validInputValue, filterResources, formatResource };
