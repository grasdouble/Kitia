"use strict";

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

export type CatalogName = string;
export type ResourceKind = "skill" | "agent" | "instruction" | "mcp" | "bundle";
type EntryObject = Record<string, unknown>;

function isEntryObject(value: unknown): value is EntryObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isBundleMember(value: unknown): value is BundleMember {
  if (!isEntryObject(value) || Object.keys(value).sort().join(",") !== "catalog,id,kind") return false;
  const id = value.id;
  const kind = value.kind;
  return typeof id === "string" && GROUP_ID.test(id) &&
    value.catalog === "internal" && typeof kind === "string" &&
    (INSTALLABLE_KINDS.has(kind) || kind === "mcp");
}

export interface ResourceIssue {
  code: string;
  paths?: string[];
}

export interface BundleMember {
  catalog: string;
  kind: ResourceKind;
  id: string;
}

export interface McpInput {
  type: string;
  required?: boolean;
  secret?: boolean;
  target_env: string;
  default?: unknown;
  description?: string;
}

export interface McpServer {
  command?: string;
  args?: string[];
  type?: string;
  url?: string;
  env?: Record<string, string>;
}

export interface CatalogResource {
  id: string;
  kind: ResourceKind;
  catalog?: CatalogName;
  catalogId?: string;
  description?: string;
  owner?: string;
  category?: string;
  tags?: string[];
  status?: string;
  use_when?: string;
  example?: string;
  expected_output?: string;
  prerequisites?: string[];
  limitations?: string[];
  deprecation_reason?: string;
  replacement?: string;
  group?: string;
  compatibility?: Record<string, { status: string }>;
  apply_to?: string[];
  applyTo?: string[];
  source?: string | null;
  source_repository?: string;
  source_path?: string;
  source_ref?: string | null;
  license_status?: string;
  url?: string;
  access?: string;
  data_policy?: string;
  last_reviewed?: string;
  mcp_config?: { mcpServers: Record<string, McpServer> };
  inputs?: Record<string, McpInput>;
  installation?: Array<{
    id: string;
    title: string;
    steps: string[];
    command?: string;
    config?: Record<string, unknown>;
    include_mcp_config?: true;
    note?: string;
  }>;
  resources?: BundleMember[];
  scope?: string;
  managed?: boolean;
  issues?: ResourceIssue[];
  paths?: string[];
  version?: string;
  commit?: string;
  unsupported_runtimes?: string[];
  removed?: boolean;
}

function validateEntry(
  value: unknown,
  label: string,
  ErrorType: new (message: string) => Error = Error,
): void {
  const fail = (message: string): never => { throw new ErrorType(`${label}: ${message}`); };
  if (!isEntryObject(value)) fail("entry must be an object");
  const entry: EntryObject = value as EntryObject;
  const local = typeof entry.kind === "string" && LOCAL_KINDS.has(entry.kind);
  const allowed = new Set([
    ...COMMON_FIELDS,
    ...(local
      ? ["group", "compatibility", "apply_to", ...(entry.kind === "bundle" ? ["resources"] : []),
        ...(entry.kind === "mcp" ? ["url", "access", "data_policy", "last_reviewed", "mcp_config", "installation", "inputs"] : [])]
      : ["url", "access", "data_policy", "last_reviewed"]),
  ]);
  const unknown = Object.keys(entry).filter((key) => !allowed.has(key));
  if (unknown.length) fail(`unsupported fields: ${unknown.sort().join(", ")}`);
  for (const field of ["owner", "category", "use_when", "example", "expected_output"]) {
    const fieldValue = entry[field];
    if (typeof fieldValue !== "string" || !fieldValue.trim()) {
      fail(`${field} must be a non-empty string`);
    }
  }
  for (const field of ["tags", "prerequisites", "limitations"]) {
    const fieldValue = entry[field];
    if (!Array.isArray(fieldValue) || !fieldValue.length ||
        fieldValue.some((item: unknown) => typeof item !== "string" || !item.trim()) ||
        new Set(fieldValue).size !== fieldValue.length) {
      fail(`${field} must be a non-empty array of unique strings`);
    }
  }
  if (typeof entry.status !== "string" || !STATUSES.has(entry.status)) {
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
    const resources = entry.resources;
    const members = Array.isArray(resources) ? resources.filter(isBundleMember) : [];
    if (!Array.isArray(resources) || !resources.length || members.length !== resources.length ||
        new Set(members.map((member) => `${member.catalog}:${member.kind}:${member.id}`)).size !== resources.length) {
      fail("resources must contain unique internal skill/agent/instruction/MCP identities");
    }
  }
  if (local) {
    if (typeof entry.group !== "string" || !GROUP_ID.test(entry.group)) {
      fail("group must be a lowercase kebab-case identifier");
    }
    const compatibility = entry.compatibility;
    if (!isEntryObject(compatibility) ||
        Object.keys(compatibility).some((key) => !["claude", "copilot"].includes(key))) {
      fail("compatibility must describe claude and copilot");
    }
    const statuses: string[] = [];
    for (const runtime of ["claude", "copilot"]) {
      const declaration = compatibility[runtime];
      if (!isEntryObject(declaration) || typeof declaration.status !== "string" ||
          !["unverified", "compatible", "unsupported"].includes(declaration.status)) {
        fail(`compatibility.${runtime}.status must be unverified, compatible or unsupported`);
      }
      if (Object.keys(declaration).some((key) => key !== "status")) {
        fail(`unsupported compatibility fields for ${runtime}`);
      }
      statuses.push(declaration.status);
    }
    const supported = statuses.filter((status) => status !== "unsupported");
    if (!supported.length) fail("at least one runtime must be supported");
    if (entry.status === "stable" && supported.some((status) => status !== "compatible")) {
      fail("stable resources require compatible status for every supported runtime");
    }
  }
  if (!local || entry.kind === "mcp") {
    for (const field of ["url", "access", "data_policy", "last_reviewed"]) {
      const fieldValue = entry[field];
      if (typeof fieldValue !== "string" || !fieldValue.trim()) {
        fail(`${field} must be a non-empty string`);
      }
    }
    const urlValue = entry.url;
    let url: URL;
    try {
      if (typeof urlValue !== "string") throw new TypeError();
      url = new URL(urlValue);
    } catch {
      fail("url must be an absolute HTTPS URL");
    }
    if (url.protocol !== "https:" || url.username || url.password) {
      fail("url must use HTTPS without embedded credentials");
    }
    validateDate(entry.last_reviewed, "last_reviewed", fail);
    if (entry.mcp_config !== undefined) validateMcpConfig(entry.mcp_config, fail);
    if (entry.kind === "mcp" && (entry.mcp_config === undefined || entry.inputs === undefined)) {
      fail("MCP entries require mcp_config and an explicit inputs object");
    }
    if (entry.inputs !== undefined) validateMcpInputs(entry, fail);
    if (entry.installation !== undefined) {
      if (entry.kind !== "mcp") fail("installation instructions are only valid for MCP entries");
      validateMcpInstallation(entry.installation, entry.mcp_config !== undefined, fail);
    }
  }
}

function validInputValue(input: Pick<McpInput, "type">, value: unknown): value is string {
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

function validateMcpInputs(entry: EntryObject, fail: (message: string) => never): void {
  const config = entry.mcp_config;
  const servers = isEntryObject(config) && isEntryObject(config.mcpServers)
    ? Object.values(config.mcpServers) : [];
  const inputs = entry.inputs;
  if (servers.length !== 1 || !isEntryObject(inputs) || !isEntryObject(servers[0])) {
    fail("inputs require exactly one MCP server and an input object");
  }
  const server = servers[0];
  if (server.type === "http" && Object.keys(inputs).length) fail("HTTP OAuth MCPs require an empty inputs object");
  const targets = new Set<string>();
  for (const [name, rawInput] of Object.entries(inputs)) {
    const input = rawInput;
    if (!isEntryObject(input)) fail(`invalid MCP input '${name}': use a typed environment binding; secrets cannot have defaults`);
    const inputType = input.type;
    const required = input.required;
    const secret = input.secret;
    const targetEnv = input.target_env;
    if (!/^[a-z][a-z0-9_]*$/.test(name) ||
        Object.keys(input).some((key) => !["type", "required", "secret", "default", "target_env", "description"].includes(key)) ||
        typeof inputType !== "string" || !["string", "url", "json"].includes(inputType) || typeof required !== "boolean" ||
        (input.description !== undefined && (typeof input.description !== "string" || !input.description.trim())) ||
        (secret !== undefined && typeof secret !== "boolean") ||
        typeof targetEnv !== "string" || !/^[A-Z_][A-Z0-9_]*$/.test(targetEnv) || targets.has(targetEnv) ||
        (secret && (! ["string", "json"].includes(inputType) || input.default !== undefined)) ||
        (input.default !== undefined && !validInputValue({ type: inputType }, input.default))) {
      fail(`invalid MCP input '${name}': use a typed environment binding; secrets cannot have defaults`);
    }
    targets.add(targetEnv);
    const reference = `\${${targetEnv}${required ? "" : ":-"}}`;
    const env = isEntryObject(server.env) ? server.env : {};
    if (Object.hasOwn(env, targetEnv) && env[targetEnv] !== reference) {
      fail(`MCP input '${name}' must not also have a literal env value`);
    }
  }
}

function validateMcpConfig(value: unknown, fail: (message: string) => never): void {
  if (!isEntryObject(value) || Object.keys(value).length !== 1 ||
      !isEntryObject(value.mcpServers) || !Object.keys(value.mcpServers).length) {
    fail("mcp_config must contain a non-empty mcpServers object");
  }
  for (const [name, rawServer] of Object.entries(value.mcpServers)) {
    if (!/^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/.test(name) || !isEntryObject(rawServer)) {
      fail(`mcp_config server '${name}' must define a supported stdio or HTTP server`);
    }
    const server = rawServer;
    if (server.type === "http") {
      const urlValue = server.url;
      if (Object.keys(server).some((key) => !["type", "url"].includes(key)) || typeof urlValue !== "string") {
        fail(`mcp_config server '${name}' must define only an HTTP type and URL`);
      }
      let url: URL;
      try {
        url = new URL(urlValue);
      } catch {
        fail(`mcp_config server '${name}' URL must be an absolute HTTPS URL without credentials`);
      }
      if (url.protocol !== "https:" || url.username || url.password) {
        fail(`mcp_config server '${name}' URL must be an absolute HTTPS URL without credentials`);
      }
      continue;
    }
    const command = server.command;
    const args = server.args;
    if ((server.type !== undefined && server.type !== "stdio") ||
        Object.keys(server).some((key) => !["type", "command", "args", "env"].includes(key)) ||
        typeof command !== "string" || !command.trim() || !Array.isArray(args) ||
        args.some((argument: unknown) => typeof argument !== "string" || !argument.trim())) {
      fail(`mcp_config server '${name}' must define a command and string args or an HTTPS HTTP URL`);
    }
    if (server.env !== undefined &&
        (!isEntryObject(server.env) || Object.entries(server.env).some(([key, item]) => !key.trim() || typeof item !== "string"))) {
      fail(`mcp_config server '${name}' env must be an object with non-empty keys and string values`);
    }
  }
}

function validateMcpInstallation(
  installation: unknown,
  hasMcpConfig: boolean,
  fail: (message: string) => never,
): void {
  if (!Array.isArray(installation) || !installation.length) fail("installation must be a non-empty array");
  const ids = new Set<string>();
  for (const rawMethod of installation) {
    const method = rawMethod;
    if (!isEntryObject(method) ||
        Object.keys(method).some((key) => !["id", "title", "steps", "command", "config", "include_mcp_config", "note"].includes(key))) {
      fail("installation methods must have unique kebab-case ids, titles and non-empty steps");
    }
    const id = method.id;
    const title = method.title;
    const steps = method.steps;
    if (typeof id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || ids.has(id) ||
        typeof title !== "string" || !title.trim() || !Array.isArray(steps) || !steps.length ||
        steps.some((step: unknown) => typeof step !== "string" || !step.trim())) {
      fail("installation methods must have unique kebab-case ids, titles and non-empty steps");
    }
    ids.add(id);
    if (method.command !== undefined && (typeof method.command !== "string" || !method.command.trim())) {
      fail(`installation method '${id}' command must be a non-empty string`);
    }
    if (method.note !== undefined && (typeof method.note !== "string" || !method.note.trim())) {
      fail(`installation method '${id}' note must be a non-empty string`);
    }
    if (method.config !== undefined && !isEntryObject(method.config)) {
      fail(`installation method '${id}' config must be an object`);
    }
    if (method.include_mcp_config !== undefined && (method.include_mcp_config !== true || !hasMcpConfig)) {
      fail(`installation method '${id}' may include mcp_config only when it is defined`);
    }
    const contentCount = [
      method.command !== undefined,
      method.config !== undefined,
      method.include_mcp_config === true,
      method.note !== undefined,
    ].filter(Boolean).length;
    if (contentCount !== 1) {
      fail(`installation method '${id}' must define exactly one command, config snippet or note`);
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

module.exports = { KINDS, INSTALLABLE_KINDS, LOCAL_KINDS, STATUSES, validateEntry, validInputValue, formatResource };
