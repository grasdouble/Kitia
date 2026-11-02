"use strict";

const CATALOG_URL = "./data/catalog.json";
const SOURCE_CONFIG_URL = "./data/source-catalogs/catalogSources.json";
const SOURCE_TIMEOUT_MS = 10000;
const RESULT_BATCH_SIZE = 12;
const REPOSITORY_URL = "https://github.com/grasdouble/Kitia";
const INSTALLABLE_KINDS = new Set(["skill", "agent", "instruction", "bundle", "mcp"]);
const RUNTIMES = ["claude", "copilot"];
const DISPLAY_WORDS = { readme: "README", github: "GitHub", mcp: "MCP", ai: "AI", cli: "CLI" };
const TYPE_LABELS = { skill: "Skills", agent: "Agents", instruction: "Instructions", mcp: "MCP integrations", bundle: "Bundles", service: "Services", extension: "Extensions" };
const NEEDS = {
  documentation: { label: "Document a project", categories: ["documentation"] },
  tickets: { label: "Plan or implement a ticket", categories: ["planning", "implementation"] },
  accessibility: { label: "Improve accessibility", categories: ["accessibility"] },
  maintenance: { label: "Maintain dependencies", categories: ["maintenance"] },
  "developer-tools": { label: "Manage AI resources", categories: ["developer-tools"] },
  integrations: { label: "Connect an integration", categories: ["integrations"] },
};

const elements = {
  search: document.querySelector("#search"),
  catalog: document.querySelector("#catalog-filter"),
  kind: document.querySelector("#kind-filter"),
  runtime: document.querySelector("#runtime-filter"),
  compatibility: document.querySelector("#compatibility-filter"),
  clear: document.querySelector("#clear-filters"),
  list: document.querySelector("#resource-list"),
  empty: document.querySelector("#empty-state"),
  count: document.querySelector("#resource-count"),
  resultCount: document.querySelector("#result-count"),
  error: document.querySelector("#load-error"),
  sourceStatus: document.querySelector("#source-status"),
  need: document.querySelector("#need-filter"),
  demos: document.querySelector("#show-demos"),
  demoNote: document.querySelector("#demo-note"),
  advanced: document.querySelector("#advanced-filters"),
  activeFilters: document.querySelector("#active-filters"),
  filterToggle: document.querySelector("#filter-toggle"),
  filterControls: document.querySelector("#filter-controls"),
  emptyReset: document.querySelector("#empty-reset"),
  loadMore: document.querySelector("#load-more"),
  progress: document.querySelector("#result-progress"),
};

let resources = [];
let visibleLimit = RESULT_BATCH_SIZE;
const cardResources = new WeakMap();
let pendingResourceLink = "";
let filterChoices = [];
let syncNeedChoices;
const sources = [
  {
    name: "Internal catalog", catalogName: "internal", url: CATALOG_URL,
    origin: "internal", state: "pending", resources: [],
  },
];
const filterParameters = [
  ["q", elements.search], ["catalog", elements.catalog], ["kind", elements.kind],
  ["runtime", elements.runtime], ["compatibility", elements.compatibility],
  ["need", elements.need],
];

function restoreFilters() {
  const url = new URL(window.location.href);
  const legacyMcpLink = url.hash.startsWith("#resource-external-mcp-");
  if (legacyMcpLink) url.hash = url.hash.replace("#resource-external-mcp-", "#resource-internal-mcp-");
  if (url.searchParams.get("catalog") === "External references" &&
      (legacyMcpLink || url.searchParams.get("kind") === "mcp")) url.searchParams.delete("catalog");
  if (url.href !== window.location.href) window.history.replaceState(null, "", url);
  const parameters = url.searchParams;
  const legacyDemoCatalog = parameters.get("catalog")?.toLocaleLowerCase() === "demo";
  for (const [name, control] of filterParameters) {
    const value = name === "catalog" && legacyDemoCatalog ? "" : parameters.get(name) || "";
    if (value && control !== elements.search &&
        !Array.from(control.options).some((option) => option.value === value)) {
      const option = makeElement("option", "", `${value} (unavailable)`);
      option.value = value;
      control.append(option);
    }
    control.value = value;
  }
  elements.demos.checked = legacyDemoCatalog || parameters.get("demos") === "1";
  elements.advanced.open = [elements.catalog, elements.kind, elements.runtime, elements.compatibility]
    .some((control) => control.value);
  if (legacyDemoCatalog) saveFilters();
}

function saveFilters(push = false) {
  const url = new URL(window.location.href);
  for (const [name, control] of filterParameters) {
    if (control.value) url.searchParams.set(name, control.value);
    else url.searchParams.delete(name);
  }
  if (elements.demos.checked) url.searchParams.set("demos", "1");
  else url.searchParams.delete("demos");
  if (url.href !== window.location.href) {
    window.history[push ? "pushState" : "replaceState"](null, "", url);
  }
}

function focusLinkedResource() {
  if (!pendingResourceLink) return;
  const card = document.getElementById(pendingResourceLink.slice(1));
  const details = card?.querySelector(".resource-details");
  if (details) {
    details.open = true;
    card.scrollIntoView({ block: "start" });
    pendingResourceLink = "";
  }
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

function createIcon(name) {
  const namespace = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(namespace, "svg");
  icon.setAttribute("class", "catalog-icon");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  const use = document.createElementNS(namespace, "use");
  use.setAttribute("href", `./assets/catalog-icons.svg#${name}`);
  icon.append(use);
  return icon;
}

function createChoices(select, parent, label, segmented = false) {
  select.hidden = true;
  const group = makeElement("fieldset", `choice-group${segmented ? " segmented" : ""}`);
  group.append(makeElement("legend", "", label));
  const choices = makeElement("div", "choice-options");
  group.append(choices);
  parent.append(group);
  const entries = new Map();
  function sync() {
    for (const option of Array.from(select.options)) {
      let entry = entries.get(option.value);
      if (!entry) {
        const field = makeElement("label", "choice");
        const input = makeElement("input");
        input.type = "radio";
        input.name = `${select.id}-choices`;
        input.value = option.value;
        const text = makeElement("span");
        input.addEventListener("change", () => {
          if (!input.checked) return;
          select.value = input.value;
          sync();
          select.dispatchEvent(new Event("change", { bubbles: true }));
        });
        field.append(input, text);
        choices.append(field);
        entry = { input, text };
        entries.set(option.value, entry);
      }
      entry.text.textContent = option.textContent;
      entry.input.checked = option.value === select.value;
      entry.input.disabled = Boolean(select.disabled || option.disabled);
    }
  }
  sync();
  return sync;
}

function appendBadge(parent, text, className = "") {
  parent.append(makeElement("span", `badge ${className}`.trim(), text));
}

function appendDetail(parent, label, value, fullWidth = false) {
  if (value === undefined || value === null || value === "") return;
  const block = makeElement("section", `detail-block${fullWidth ? " full-width" : ""}`);
  if (label === "Expected result") block.className += " resource-outcome";
  block.append(makeElement("h4", "", label));
  if (Array.isArray(value)) {
    const list = makeElement("ul");
    for (const item of value) list.append(makeElement("li", "", item));
    block.append(list);
  } else {
    block.append(makeElement("p", "", value));
  }
  parent.append(block);
}

function sourceFor(resource) {
  if (resource.origin !== "internal") {
    return `https://github.com/${resource.source_repository}/blob/${resource.source_ref}/${resource.source_path}`;
  }
  if (resource.group) {
    const folder = ["bundle", "mcp"].includes(resource.kind)
      ? `${resource.kind === "bundle" ? "bundles" : "mcps"}/${resource.id}.json`
      : resource.kind === "skill"
      ? `skills/${resource.id}/SKILL.md`
      : `${resource.kind === "agent" ? "agents" : "instructions"}/${resource.id}.md`;
    const directory = resource.kind === "skill" && resource.group === "general"
      ? ""
      : `catalogs/${resource.group}/`;
    return `${REPOSITORY_URL}/blob/main/${directory}${folder}`;
  }
  return resource.url;
}

function installCommand(resource, tool, scope = "project") {
  if (resource.origin === "internal" && !INSTALLABLE_KINDS.has(resource.kind)) return null;
  if (resource.origin === "external" && !INSTALLABLE_KINDS.has(resource.kind)) return null;
  if (tool === "both" && RUNTIMES.some((runtime) =>
    resource.compatibility?.[runtime]?.status === "unsupported")) return null;
  if (tool !== "both" && resource.compatibility?.[tool]?.status === "unsupported") return null;
  const reference = "github:grasdouble/Kitia";
  const scopeOption = scope === "user" ? " --scope user" : "";
  if (resource.origin !== "internal") {
    return `npx --yes ${reference} install skill ${resource.id} --catalog ${resource.catalogId} --tool ${tool}${scopeOption}`;
  }
  return `npx --yes ${reference} install ${resource.kind} ${resource.id} --tool ${tool}${scopeOption}`;
}

function appendInstallButtons(parent, resource, quickActions) {
  const cliOnly = ["bundle", "mcp"].includes(resource.kind);
  const options = [
    ["copilot", cliOnly ? "Copilot CLI" : "Copilot"],
    ["claude", cliOnly ? "Claude Code CLI" : "Claude"],
    ["both", "Both"],
  ].filter(([tool]) => installCommand(resource, tool));
  if (!options.length) return;
  const actions = makeElement("div", "install-actions");
  const controls = makeElement("div", "install-controls");
  const compatibility = makeElement("span", "install-compatibility");
  const preview = makeElement("pre", "install-command");
  const commandText = makeElement("code");
  preview.append(commandText);
  const feedback = makeElement("span", "install-feedback");
  feedback.setAttribute("role", "status");
  feedback.setAttribute("aria-live", "polite");
  let manualCopy;
  let manualField;
  let copyRequest = 0;
  let scope;
  const quickButton = makeElement("button", "install-button quick-install", "Copy install command");
  quickButton.type = "button";
  quickButton.append(createIcon("copy"));
  const target = makeElement("span", "quick-install-target");
  const clientField = makeElement("div", "install-scope");
  const clientLabel = makeElement("label", "", "AI assistant");
  clientLabel.hidden = true;
  const client = makeElement("select");
  client.id = `client-${resourceAnchor(resource)}`;
  clientLabel.htmlFor = client.id;
  for (const [value, label] of options) {
    const option = makeElement("option", "", label);
    option.value = value;
    client.append(option);
  }
  client.value = options.some(([value]) => value === "both") ? "both" : options[0][0];
  function resetFeedback() {
    copyRequest += 1;
    feedback.textContent = "";
    target.textContent = `${options.find(([value]) => value === client.value)[1]} · ${scope?.value === "user" ? "All projects" : "This project"}`;
    if (manualCopy) manualCopy.hidden = true;
    commandText.textContent = installCommand(resource, client.value, scope?.value);
    compatibility.textContent = (client.value === "both" ? options.filter(([tool]) => tool !== "both")
      : options.filter(([tool]) => tool === client.value))
      .map(([tool, label]) => `${label}: ${resource.compatibility?.[tool]?.status || "not declared"}`).join(" · ");
  }
  client.addEventListener("change", resetFeedback);
  clientField.append(clientLabel, client);
  const syncClient = createChoices(client, clientField, "AI assistant", true);
  controls.append(clientField);
  let syncScope;
  if (["skill", "agent", "bundle", "mcp"].includes(resource.kind)) {
    const field = makeElement("div", "install-scope");
    const label = makeElement("label", "", "Installation scope");
    label.hidden = true;
    scope = makeElement("select");
    scope.id = `scope-${resourceAnchor(resource)}`;
    label.htmlFor = scope.id;
    const scopes = resource.kind === "bundle" && resource.resources.some((member) => member.kind === "instruction")
      ? [["project", "This project"]]
      : [["project", "This project"], ["user", "All projects"]];
    for (const [value, text] of scopes) {
      const option = makeElement("option", "", text);
      option.value = value;
      scope.append(option);
    }
    scope.value = "project";
    scope.addEventListener("change", resetFeedback);
    field.append(label, scope);
    syncScope = createChoices(scope, field, "Installation scope", true);
    if (resource.kind === "agent") {
      field.append(makeElement("span", "", "User agents: Copilot CLI or Claude Code; IDE discovery is not guaranteed."));
    }
    controls.append(field);
  }
  resetFeedback();

  const button = makeElement("button", "install-button copy-command", "Copy command");
  button.append(createIcon("copy"));
  button.type = "button";
  async function copyInstallation() {
    const request = ++copyRequest;
    const command = installCommand(resource, client.value, scope?.value);
    try {
      await navigator.clipboard.writeText(command);
      if (request !== copyRequest) return;
      feedback.textContent = "Installation command copied to clipboard.";
      if (manualCopy) manualCopy.hidden = true;
    } catch {
      if (request !== copyRequest) return;
      feedback.textContent = "Could not copy the installation command. Select and copy it manually below.";
      if (!manualCopy) {
        manualCopy = makeElement("label", "manual-copy");
        manualCopy.append(makeElement("span", "", "Installation command to copy manually"));
        manualField = makeElement("textarea", "manual-copy-field");
        manualField.readOnly = true;
        manualField.rows = 3;
        manualField.spellcheck = false;
        manualCopy.append(manualField);
        quickActions.append(manualCopy);
      }
      manualCopy.hidden = false;
      manualField.value = command;
      manualField.focus();
      manualField.select();
    }
  }
  button.addEventListener("click", copyInstallation);
  quickButton.addEventListener("click", copyInstallation);
  const commandBar = makeElement("div", "install-command-bar");
  commandBar.append(preview, button);
  actions.append(controls, compatibility, commandBar);
  quickActions.append(quickButton, target, feedback);
  parent.append(actions);

  const optionsButton = makeElement("button", "quick-install-options");
  optionsButton.type = "button";
  optionsButton.title = "Installation options";
  optionsButton.setAttribute("aria-label", "Installation options");
  optionsButton.append(createIcon("settings-2"));
  quickActions.insertBefore(optionsButton, target);

  const editor = makeElement("form", "quick-install-editor");
  editor.id = `options-${resourceAnchor(resource)}`;
  editor.setAttribute("aria-label", "Installation options");
  editor.hidden = true;
  optionsButton.setAttribute("aria-controls", editor.id);
  optionsButton.setAttribute("aria-expanded", "false");
  const apply = makeElement("button", "install-button quick-install", "Apply options");
  apply.type = "submit";
  editor.append(apply);
  quickActions.parentElement.insertBefore(editor, quickActions);
  let previousClient;
  let previousScope;

  function closeOptions({ cancel = false } = {}) {
    if (cancel) {
      client.value = previousClient;
      if (scope) scope.value = previousScope;
      syncClient();
      syncScope?.();
    }
    resetFeedback();
    actions.prepend(controls);
    editor.hidden = true;
    quickActions.hidden = false;
    optionsButton.setAttribute("aria-expanded", "false");
    optionsButton.focus();
  }
  optionsButton.addEventListener("click", () => {
    previousClient = client.value;
    previousScope = scope?.value;
    resetFeedback();
    editor.prepend(controls);
    quickActions.hidden = true;
    editor.hidden = false;
    optionsButton.setAttribute("aria-expanded", "true");
    controls.querySelector("input:checked").focus();
  });
  editor.addEventListener("submit", (event) => {
    event.preventDefault();
    closeOptions();
  });
  editor.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeOptions({ cancel: true });
  });
}

function resourceAnchor(resource) {
  return `resource-${resource.origin}-${resource.kind}-${resource.id}`;
}

function isDemo(resource) {
  return resource.group === "demo" || resource.category === "demo" || resource.tags?.includes("demo");
}

function demoIsHidden(resource) {
  return isDemo(resource) && !elements.demos.checked &&
    window.location.hash !== `#${resourceAnchor(resource)}`;
}

function appendAdoptionSummary(parent, resource) {
  const summary = makeElement("section", "adoption-summary");
  const route = makeElement("p", "installation-route");
  const externalReference = resource.origin === "external" && !INSTALLABLE_KINDS.has(resource.kind);
  const [label, requirements] = resource.origin === "internal"
    ? ["Kitia CLI installation", "Requires Node.js 22+, npm, Git and access to this catalog."]
    : externalReference
      ? ["Not installed by the Kitia CLI", "Consult the official reference for access and setup requirements."]
      : [`${capitalizeFirst(resource.catalogId)} via gh skill`,
      "Requires Node.js 22+, npm, GitHub CLI with gh skill support and upstream access."];
  route.append(makeElement("strong", "", label), makeElement("span", "", requirements));
  summary.append(route);
  if (resource.kind === "bundle") {
    appendDetail(summary, "Bundle clients", "Copilot CLI and Claude Code CLI only.");
  }
  if (resource.kind === "mcp") {
    const server = Object.values(resource.mcp_config.mcpServers)[0];
    appendDetail(summary, "Authentication", resource.access);
    appendDetail(summary, "Setup", "Copilot CLI and Claude Code CLI only. Installation prepares configuration; it does not start the server, authenticate or grant access.");
    if (Object.values(resource.inputs || {}).some((input) => input.secret &&
        server.args?.some((argument) => argument.includes(`\${${input.target_env}`)))) {
      appendDetail(summary, "Credential handling", "Secret values are expanded into process arguments at startup and may appear in process listings or server diagnostics. Review the data policy before enabling this server.");
    }
  }
  appendDetail(summary, "Before you start", resource.prerequisites ||
    (resource.origin !== "internal" && !externalReference
      ? ["Consult the upstream skill for project-specific prerequisites and confirm usage rights before installing."]
      : externalReference
        ? ["Review the official reference for access and setup requirements."]
      : null));
  parent.append(summary);
}

function appendNextStep(parent, resource) {
  if (!INSTALLABLE_KINDS.has(resource.kind)) return;
  const nextStep = resource.kind === "agent"
    ? `After running the command, reload your client and select ${resource.id} from its custom agents.`
    : ["bundle", "mcp"].includes(resource.kind)
      ? "Review and confirm the setup plan. Set secret environment variables in your CLI before startup. This site never collects secrets."
      : resource.kind === "instruction"
      ? `After running the command, reload your client. These instructions apply to: ${resource.apply_to.join(", ")}.`
      : `After running the command, reload your client and ask it to use ${resource.id}.`;
  parent.append(makeElement("p", "adoption-next-step", nextStep));
}

function appendCompatibility(parent, resource) {
  const block = makeElement("section", "detail-block full-width");
  block.append(makeElement("h4", "", ["bundle", "mcp"].includes(resource.kind) ? "CLI compatibility" : "Compatibility"));
  const rows = makeElement("div", "compatibility-list");
  for (const runtime of RUNTIMES) {
    const status = resource.compatibility?.[runtime]?.status || "not declared";
    const row = makeElement("div", "compatibility-row");
    const label = ["bundle", "mcp"].includes(resource.kind)
      ? runtime === "claude" ? "Claude Code CLI" : "Copilot CLI"
      : runtime === "claude" ? "Claude" : "Copilot";
    row.append(makeElement("span", "compatibility-runtime", label));
    appendBadge(row, status, status.replaceAll(" ", "-"));
    rows.append(row);
  }
  block.append(rows);
  parent.append(block);
}

function appendMcpConfiguration(parent, resource) {
  if (!resource.mcp_config) return;
  const block = makeElement("section", "detail-block full-width mcp-config-block");
  block.append(makeElement("h4", "", "Portable MCP configuration (.mcp.json)"));
  block.append(makeElement(
    "p",
    "",
    "Merge this snippet into .mcp.json at the project root; keep existing mcpServers entries.",
  ));
  const config = JSON.stringify(resource.mcp_config, null, 2);
  block.append(makeElement("pre", "mcp-config", config));
  const actions = makeElement("div", "install-actions");
  const button = makeElement("button", "install-button", "Copy config snippet");
  button.type = "button";
  const feedback = makeElement("span", "install-feedback");
  feedback.setAttribute("role", "status");
  feedback.setAttribute("aria-live", "polite");
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(config);
      feedback.textContent = "Configuration snippet copied to clipboard.";
    } catch {
      feedback.textContent = "Could not copy the configuration. Check clipboard permissions and try again.";
    }
  });
  actions.append(button, feedback);
  block.append(actions);
  parent.append(block);
}

function appendMcpInstallation(parent, resource) {
  if (!Array.isArray(resource.installation) || !resource.installation.length) return;
  const block = makeElement("section", "mcp-installation");
  const heading = makeElement("h4", "technical-heading", "Alternative setup");
  heading.append(createIcon("terminal"));
  block.append(heading);
  for (const method of resource.installation) {
    const panel = makeElement("details", "mcp-installation-method");
    panel.append(makeElement("summary", "", method.title));
    const content = makeElement("div", "mcp-installation-content");
    for (const step of method.steps) {
      content.append(makeElement("p", "", step));
    }
    if (method.command) {
      content.append(makeElement("pre", "mcp-config", method.command));
    }
    if (method.note) {
      content.append(makeElement("p", "mcp-installation-note", method.note));
    }
    if (method.config) {
      content.append(makeElement("pre", "mcp-config", JSON.stringify(method.config, null, 2)));
    }
    if (method.include_mcp_config) {
      appendMcpConfiguration(content, resource);
    }
    panel.append(content);
    block.append(panel);
  }
  parent.append(block);
}

function appendTechnicalSection(parent, title, iconName) {
  const section = makeElement("section", "technical-section");
  section.setAttribute("aria-label", title);
  const heading = makeElement("h4", "technical-heading", title);
  heading.append(createIcon(iconName));
  section.append(heading);
  parent.append(section);
  return section;
}

function appendTechnicalFacts(parent, entries) {
  const facts = makeElement("dl", "technical-facts");
  for (const [label, value] of entries) {
    if (value === undefined || value === null || value === "" || Array.isArray(value) && !value.length) continue;
    const row = makeElement("div", `technical-fact${["Resource ID", "Upstream source path", "Tags"].includes(label) ? " technical-fact-wide" : ""}`);
    const content = makeElement("dd");
    if (label === "Tags") {
      const tags = makeElement("ul", "reference-tags");
      tags.setAttribute("aria-label", "Tags");
      for (const tag of value) tags.append(makeElement("li", "reference-tag", tag));
      content.append(tags);
    } else if (label === "Status") {
      appendBadge(content, capitalizeFirst(value), value);
    } else if (label === "Catalog") {
      appendBadge(content, value, "reference-catalog");
    } else if (label === "Last reviewed") {
      const date = makeElement("time", "reference-date", value);
      date.setAttribute("datetime", value);
      content.append(date);
    } else if (["Resource ID", "Upstream source path", "Server name"].includes(label)) {
      content.append(makeElement("code", "reference-code", value));
    } else {
      content.textContent = value;
    }
    row.append(makeElement("dt", "", label), content);
    facts.append(row);
  }
  parent.append(facts);
}

function createCard(resource) {
  const card = makeElement("article", "resource-card");
  card.id = resourceAnchor(resource);
  card.setAttribute("data-demo", isDemo(resource) ? "true" : "false");
  const heading = makeElement("div", "card-heading");
  const title = makeElement("h3", "resource-title");
  const displayName = resource.id.replace(/^kitia-/, "").split("-")
    .map((word, index) => Object.hasOwn(DISPLAY_WORDS, word) ? DISPLAY_WORDS[word] : index === 0 ? capitalizeFirst(word) : word).join(" ");
  const permalink = makeElement("a", "resource-title-link", displayName);
  permalink.href = `#${card.id}`;
  permalink.setAttribute("aria-label", `Link to ${resource.id}`);
  permalink.addEventListener("click", () => {
    card.querySelector(".resource-details").open = true;
  });
  title.append(permalink);
  heading.append(createIcon(resource.kind === "mcp" || resource.origin === "external" ? "plug"
    : resource.kind === "bundle" ? "layers" : resource.kind === "agent" ? "terminal" : "book-open"), title);
  const metadata = makeElement("div", "card-metadata");
  appendBadge(metadata, resource.kind === "mcp" ? "Integration" : capitalizeFirst(resource.kind), "type");
  const status = resource.status || (resource.origin !== "internal" ? "upstream" : "reference");
  appendBadge(metadata, capitalizeFirst(status), status);
  appendBadge(metadata, resource.catalog, "catalog");
  if (isDemo(resource)) appendBadge(metadata, "Demo", "experimental");
  heading.append(metadata);
  card.append(heading);
  card.append(makeElement("p", "resource-description", resource.use_when || resource.description));
  const quickActions = makeElement("div", "quick-install-actions");
  card.append(quickActions);

  const details = makeElement("details", "resource-details");
  const summary = makeElement("summary", "", "View resource");
  summary.append(createIcon("arrow-right"));
  details.append(summary);
  const tabs = makeElement("div", "resource-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", `${displayName} details`);
  details.append(tabs);
  const overview = makeElement("div", "resource-overview");
  appendDetail(overview, "Expected result", resource.expected_output);
  if (resource.use_when) appendDetail(overview, "About", resource.description);
  appendDetail(overview, "Example", resource.example);
  details.append(overview);

  const installation = makeElement("div", "resource-installation");
  appendAdoptionSummary(installation, resource);
  if (resource.origin !== "external") {
    installation.append(makeElement("p", "command-note", "Review commands before running. Uses the latest catalog; pin a commit in the CLI for a specific version."));
  }
  appendInstallButtons(installation, resource, quickActions);
  appendNextStep(installation, resource);
  if (resource.kind === "mcp" || resource.kind === "bundle" &&
      resource.resources.some((member) => member.kind === "mcp")) {
    const help = makeElement("p", "adoption-next-step");
    const link = makeElement("a", "", resource.kind === "bundle"
      ? "CLI environment setup (Copilot CLI / Claude Code CLI)"
      : "Where to set environment variables (Linux, macOS, Windows)");
    link.href = "./documentation.html#environment-variables";
    help.append(link);
    installation.append(help);
  }
  details.append(installation);

  const reference = makeElement("div", "resource-reference");
  const identity = appendTechnicalSection(reference, "Reference", "book-open");
  appendTechnicalFacts(identity, [
    ["Resource ID", resource.id],
    ["Catalog", resource.catalog],
    ["Status", resource.status || (resource.origin === "internal" ? "reference" : "upstream")],
    ["Last reviewed", resource.last_reviewed],
    ["Owner", resource.owner],
    ["License", resource.license_status],
    ["Upstream source path", resource.source_path],
    ["Tags", resource.tags],
  ]);
  if (INSTALLABLE_KINDS.has(resource.kind)) appendCompatibility(reference, resource);
  if (resource.access || resource.data_policy || resource.limitations?.length || resource.deprecation_reason || resource.replacement) {
    const safeguards = appendTechnicalSection(reference, "Access & safeguards", "plug");
    appendDetail(safeguards, "Access", resource.access);
    appendDetail(safeguards, "Data and permissions", resource.data_policy);
    appendDetail(safeguards, "Limitations", resource.limitations);
    appendDetail(safeguards, "Deprecation", resource.deprecation_reason);
    appendDetail(safeguards, "Replacement", resource.replacement);
  }
  if (resource.kind === "bundle") {
    const members = appendTechnicalSection(reference, "Bundle resources", "layers");
    const list = makeElement("ul", "technical-members");
    for (const member of resource.resources) {
      const item = makeElement("li");
      item.append(createIcon(member.kind === "mcp" ? "plug" : "book-open"),
        makeElement("code", "", `${member.catalog}:${member.kind}:${member.id}`));
      list.append(item);
    }
    members.append(list);
  }
  if (resource.kind === "mcp") {
    const [name, server] = Object.entries(resource.mcp_config.mcpServers)[0];
    const connection = appendTechnicalSection(reference, "Connection", "plug");
    appendTechnicalFacts(connection, [
      ["Server name", name],
      ["MCP transport", server.type === "http" ? `HTTP: ${server.url}` : `stdio: ${server.command}`],
    ]);
  }
  if (resource.inputs) {
    const inputs = appendTechnicalSection(reference, "MCP configuration inputs", "settings-2");
    if (!Object.keys(resource.inputs).length) {
      inputs.append(makeElement("p", "technical-note", "No user parameters. Complete any client-managed OAuth separately."));
    } else {
      const list = makeElement("ul", "technical-inputs");
      for (const [name, input] of Object.entries(resource.inputs)) {
        const row = makeElement("li");
        const heading = makeElement("div", "technical-input-heading");
        heading.append(makeElement("code", "", name));
        appendBadge(heading, input.required ? "Required" : "Optional", input.required ? "input-required" : "input-optional");
        row.append(heading, makeElement("p", "technical-input-value", input.secret
          ? `${input.type === "json" ? "JSON " : ""}secret environment variable ${input.target_env}, startup only`
          : `${input.type}${input.default !== undefined ? `, default ${input.default}` : ""}`));
        if (input.description) row.append(makeElement("p", "technical-note", input.description));
        list.append(row);
      }
      inputs.append(list);
    }
  }
  if (!resource.installation?.length && resource.mcp_config) {
    const configuration = makeElement("details", "technical-config");
    const summary = makeElement("summary", "", "Configuration JSON");
    summary.append(createIcon("terminal"));
    configuration.append(summary);
    appendMcpConfiguration(configuration, resource);
    reference.append(configuration);
  }

  const links = makeElement("div", "technical-links");
  if (resource.origin === "external" && resource.url) {
    const link = makeElement("a", "source-action", "Official reference");
    link.href = resource.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    card.append(link);
  }
  const sourceUrl = sourceFor(resource);
  if (sourceUrl) {
    const link = makeElement("a", "source-action", "View source ↗");
    link.href = sourceUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    (resource.origin === "external" ? card : links).append(link);
  }
  if (resource.kind === "mcp") {
    const documentation = makeElement("a", "source-action", "Official documentation");
    documentation.href = resource.url;
    documentation.target = "_blank";
    documentation.rel = "noopener noreferrer";
    links.append(documentation);
  }
  if (links.childElementCount) identity.append(links);
  appendMcpInstallation(reference, resource);
  details.append(reference);
  const panels = [overview, installation, reference];
  const labels = ["Overview", resource.origin === "external" ? "Access" : "Install", "Technical"];
  const buttons = panels.map((panel, index) => {
    const button = makeElement("button", "resource-tab", labels[index]);
    button.append(createIcon(["book-open", resource.origin === "external" ? "plug" : "terminal", "settings-2"][index]));
    button.type = "button";
    button.id = `${card.id}-tab-${index}`;
    panel.id = `${card.id}-panel-${index}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", panel.id);
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", button.id);
    panel.tabIndex = 0;
    button.addEventListener("click", () => activate(index));
    button.addEventListener("keydown", (event) => {
      const next = event.key === "ArrowRight" ? (index + 1) % panels.length
        : event.key === "ArrowLeft" ? (index + panels.length - 1) % panels.length
          : event.key === "Home" ? 0 : event.key === "End" ? panels.length - 1 : null;
      if (next === null) return;
      event.preventDefault();
      activate(next);
      buttons[next].focus();
    });
    tabs.append(button);
    return button;
  });
  function activate(selected) {
    panels.forEach((panel, index) => {
      panel.hidden = index !== selected;
      buttons[index].tabIndex = index === selected ? 0 : -1;
      buttons[index].setAttribute("aria-selected", String(index === selected));
    });
  }
  const nextStep = makeElement("button", "resource-next-step", resource.origin === "external" ? "Check access" : "Continue to install");
  nextStep.type = "button";
  nextStep.append(createIcon("arrow-right"));
  nextStep.addEventListener("click", () => {
    activate(1);
    buttons[1].focus();
  });
  overview.append(nextStep);
  activate(0);
  card.append(details);
  cardResources.set(card, resource);
  return card;
}

function filterResources() {
  if (elements.demos.checked) return resources.filter(isDemo);
  const query = elements.search.value.trim().toLocaleLowerCase();
  const catalog = elements.catalog.value;
  const kind = elements.kind.value;
  const runtime = elements.runtime.value;
  const status = elements.compatibility.value;

  return resources.filter((resource) => {
    if (demoIsHidden(resource)) return false;
    if (elements.need.value) {
      const need = Object.hasOwn(NEEDS, elements.need.value) ? NEEDS[elements.need.value] : null;
      if (!need || (need.origin ? resource.origin !== need.origin : !need.categories.includes(resource.category))) return false;
    }
    if (catalog && resource.catalog !== catalog) return false;
    if (kind && resource.kind !== kind) return false;
    if (!CatalogSearch.matchesSearch(resource, query)) return false;
    if (status) {
      const statuses = runtime
        ? [resource.compatibility?.[runtime]?.status || "not-recorded"]
        : RUNTIMES.map((name) => resource.compatibility?.[name]?.status || "not-recorded");
      if (!statuses.includes(status)) return false;
    } else if (runtime && !resource.compatibility?.[runtime]) {
      return false;
    }
    return true;
  });
}

function render() {
  const matching = filterResources();
  const demoMode = elements.demos.checked;
  const linkedIndex = matching.findIndex((resource) => `#${resourceAnchor(resource)}` === (pendingResourceLink || window.location.hash));
  visibleLimit = Math.max(visibleLimit, linkedIndex + 1);
  for (const card of elements.list.children) {
    if (card.querySelector?.(".resource-details")?.open || card.contains?.(document.activeElement)) {
      visibleLimit = Math.max(visibleLimit, matching.indexOf(cardResources.get(card)) + 1);
    }
  }
  for (const [, control] of filterParameters) control.disabled = demoMode;
  elements.demoNote.hidden = !demoMode;
  elements.demoNote.textContent = demoMode ? "All other filters are paused." : "";
  const hiddenDemos = resources.filter(demoIsHidden).length;
  const pending = sources.some((source) => source.state === "pending");
  const summary = demoMode
    ? `${matching.length} demo resources`
    : `${resources.length - hiddenDemos} resources`;
  elements.count.textContent = sources.every((source) => source.state === "failed") ? "Catalog unavailable"
    : `${summary}${pending ? " · Loading remaining sources…" : ""}`;
  const existing = new Map([...elements.list.children].map((card) => [card.id, card]));
  const cards = matching.slice(0, visibleLimit).map((resource) => {
    const card = existing.get(resourceAnchor(resource));
    return card && cardResources.get(card) === resource ? card : createCard(resource);
  });
  const visible = new Set(cards);
  for (const card of [...elements.list.children]) {
    if (!visible.has(card)) card.remove();
  }
  cards.forEach((card, index) => {
    const next = elements.list.children[index] || null;
    if (next !== card) elements.list.insertBefore(card, next);
  });
  elements.empty.hidden = matching.length !== 0 || !sources.some((source) => source.state === "loaded");
  elements.empty.textContent = demoMode
    ? "No demo resources are available from the loaded catalogs."
    : "No resources match these filters. Try a different search or remove a filter.";
  elements.emptyReset.hidden = elements.empty.hidden;
  elements.resultCount.textContent = `${matching.length} result${matching.length === 1 ? "" : "s"}`;
  elements.progress.textContent = matching.length ? `Showing ${cards.length} of ${matching.length} resources` : "";
  elements.loadMore.hidden = cards.length >= matching.length;
  elements.loadMore.textContent = `Show ${Math.min(RESULT_BATCH_SIZE, matching.length - cards.length)} more resources`;
  renderActiveFilters();
  for (const sync of filterChoices) sync();
}

function renderActiveFilters() {
  const labels = { q: "Search", catalog: "Catalog", kind: "Type", runtime: "Runtime", compatibility: "Compatibility", need: "Task" };
  const active = elements.demos.checked
    ? [["demos", elements.demos]]
    : filterParameters.filter(([, control]) => control.value);
  elements.activeFilters.replaceChildren();
  elements.activeFilters.hidden = active.length === 0;
  elements.filterToggle.textContent = `Filters${active.length ? ` (${active.length})` : ""}`;
  for (const [name, control] of active) {
    const value = name === "demos" ? "Demo resources only"
      : `${labels[name]}: ${name === "q" ? control.value : Array.from(control.options).find((option) => option.value === control.value)?.textContent || control.value}`;
    const button = makeElement("button", "active-filter", value);
    button.type = "button";
    button.setAttribute("aria-label", `Remove ${value}`);
    const remove = makeElement("span", "", "×");
    remove.setAttribute("aria-hidden", "true");
    button.append(remove);
    button.addEventListener("click", () => {
      if (name === "demos") control.checked = false;
      else control.value = "";
      visibleLimit = RESULT_BATCH_SIZE;
      saveFilters(true);
      render();
      elements.search.focus();
    });
    elements.activeFilters.append(button);
  }
}

function addOptions(select, values, labelForValue = (value) => value) {
  for (const value of [...new Set(values)].sort((a, b) => a.localeCompare(b))) {
    const existing = Array.from(select.options).find((option) => option.value === value);
    if (existing) {
      existing.textContent = labelForValue(value);
      continue;
    }
    const option = makeElement("option", "", labelForValue(value));
    option.value = value;
    select.append(option);
  }
}

function capitalizeFirst(value) {
  return value ? `${value[0].toLocaleUpperCase()}${value.slice(1)}` : value;
}

function displaySourceName(value) {
  return value.split("-").map(capitalizeFirst).join(" ");
}

function sourceRepositoryId(value) {
  try {
    const url = new URL(value);
    const pathname = url.pathname.replace(/\/+$/, "").replace(/\.git$/i, "");
    const repository = pathname.slice(1);
    return url.protocol === "https:" && url.hostname.toLocaleLowerCase() === "github.com" &&
      !url.username && !url.password && !url.port && !url.search && !url.hash &&
      /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
      ? repository
      : null;
  } catch {
    return null;
  }
}

async function fetchCatalog(url, catalogName) {
  const response = await fetch(url, { signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS), cache: "no-cache" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const catalog = await response.json();
  if (!catalog || !Array.isArray(catalog.resources) ||
      catalog.resources.some((resource) =>
        !resource || typeof resource.id !== "string" || typeof resource.kind !== "string" ||
        typeof resource.description !== "string" ||
        (resource.kind === "bundle" && (!Array.isArray(resource.resources) || !resource.resources.length ||
          resource.resources.some((member) => !member || typeof member.catalog !== "string" ||
            typeof member.kind !== "string" || typeof member.id !== "string"))) ||
        (resource.inputs !== undefined && (!resource.inputs || typeof resource.inputs !== "object" ||
          Array.isArray(resource.inputs) || Object.values(resource.inputs).some((input) =>
            !input || !["string", "url", "json"].includes(input.type) || typeof input.target_env !== "string"))) ||
        (resource.kind === "instruction" && (!Array.isArray(resource.apply_to) ||
          !resource.apply_to.length || resource.apply_to.some((pattern) => typeof pattern !== "string"))) ||
        (catalogName === "internal" && typeof resource.group !== "string") ||
        (resource.compatibility !== undefined && (!resource.compatibility ||
          typeof resource.compatibility !== "object" || Array.isArray(resource.compatibility) ||
          Object.values(resource.compatibility).some((entry) =>
            !entry || !["compatible", "unverified", "unsupported"].includes(entry.status)))) ||
        ["tags", "prerequisites", "limitations"].some((key) => resource[key] !== undefined &&
          (!Array.isArray(resource[key]) || resource[key].some((value) => typeof value !== "string"))) ||
        (resource.installation !== undefined && (!Array.isArray(resource.installation) ||
          resource.installation.some((method) => !method || typeof method.title !== "string" ||
            !Array.isArray(method.steps) || method.steps.some((step) => typeof step !== "string")))))) {
    throw new Error("Invalid catalog data");
  }
  if (catalogName !== "internal" && (catalog.catalog_name !== catalogName ||
      typeof catalog.source_repository !== "string" || !/^[a-f0-9]{40}$/i.test(catalog.source_ref))) {
    throw new Error(`Invalid ${catalogName} catalog source`);
  }
  return catalog;
}

function renderSources() {
  resources = sources.flatMap((source) => source.resources);
  const failures = sources.filter((source) => source.state === "failed");
  elements.error.hidden = !failures.length;
  elements.error.textContent = failures.length
    ? `${failures.length === sources.length ? "All catalog sources failed." : "Some sources are unavailable. Showing loaded resources only."} ${failures.map((source) => `${source.name}: ${source.error}`).join("; ")}`
    : "";
  for (const source of sources) {
    if (source.state === "loaded") {
      source.view?.row.remove();
      continue;
    }
    if (!source.view) {
      const row = makeElement("p", "source-status");
      const message = makeElement("span");
      const retry = makeElement("button", "install-button", `Retry ${source.name}`);
      retry.type = "button";
      retry.addEventListener("click", () => loadSource(source));
      row.append(message, retry);
      source.view = { row, message, retry };
    }
    const { row, message, retry } = source.view;
    message.textContent = `${source.name}: ${source.state === "pending" ? "loading…" : source.error} `;
    retry.hidden = source.state !== "failed";
    if (row.parentElement !== elements.sourceStatus) {
      elements.sourceStatus.append(row);
    }
  }
  addOptions(elements.catalog, resources.filter((resource) => !isDemo(resource))
    .map((resource) => resource.catalog), capitalizeFirst);
  addOptions(elements.kind, resources.map((resource) => resource.kind),
    (kind) => Object.hasOwn(TYPE_LABELS, kind) ? TYPE_LABELS[kind] : capitalizeFirst(kind));
  render();
  focusLinkedResource();
}

async function loadSource(source) {
  source.state = "pending";
  source.error = "";
  renderSources();
  try {
    const catalog = await fetchCatalog(source.url, source.catalogName);
    source.resources = catalog.resources.map((resource) => ({
      ...resource, origin: source.origin,
      catalog: source.origin === "internal" ? resource.group : source.catalogName,
      catalogId: source.catalogName,
      ...(source.origin !== "internal" ? {
        source_repository: catalog.source_repository, source_ref: catalog.source_ref, owner: catalog.source_repository,
      } : {}),
    }));
    source.state = "loaded";
  } catch (error) {
    source.state = "failed";
    source.error = error.name === "TimeoutError" ? "Request timed out after 10 seconds" : error.message;
  }
  renderSources();
}

async function loadConfiguredSources() {
  try {
    const response = await fetch(SOURCE_CONFIG_URL, {
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS), cache: "no-cache",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const configuration = await response.json();
    if (configuration?.catalog_version !== 1 || !Array.isArray(configuration.sources) ||
        configuration.sources.some((source) => !source ||
          typeof source.name !== "string" || !source.name || source.name !== source.name.trim() ||
          /[\/\\:\u0000-\u001f\u007f-\u009f]/u.test(source.name) ||
          source.name.toUpperCase() === "INTERNAL" || typeof source.repository !== "string")) {
      throw new Error("Invalid catalog source configuration");
    }
    const names = new Set();
    const repositories = new Set();
    for (const source of configuration.sources) {
      const nameKey = source.name.toUpperCase();
      if (names.has(nameKey)) throw new Error(`Duplicate catalog source: ${source.name}`);
      const repository = sourceRepositoryId(source.repository);
      if (!repository) throw new Error(`Invalid GitHub repository for source ${source.name}`);
      if (repositories.has(repository)) throw new Error(`Duplicate source repository: ${repository}`);
      names.add(nameKey);
      repositories.add(repository);
      const displayName = displaySourceName(source.name);
      sources.push({
        name: `${displayName} catalog`,
        catalogName: source.name,
        url: `./data/source-catalogs/${encodeURIComponent(source.name)}.json`,
        origin: source.name,
        state: "pending",
        resources: [],
      });
      addNeedShortcut(`source-${source.name}`, {
        label: `Explore ${displayName} skills`,
        origin: source.name,
      });
    }
    renderSources();
    await Promise.all(sources.slice(1).map((source) => loadSource(source)));
  } catch (error) {
    const source = {
      name: "Source catalogs",
      catalogName: "sources",
      origin: "sources",
      state: "failed",
      error: error.name === "TimeoutError" ? "Request timed out after 10 seconds" : error.message,
      resources: [],
    };
    sources.push(source);
    renderSources();
  }
}

for (const control of [elements.search, elements.need, elements.catalog, elements.kind, elements.runtime, elements.compatibility, elements.demos]) {
  control.addEventListener(control === elements.search ? "input" : "change", () => {
    visibleLimit = RESULT_BATCH_SIZE;
    saveFilters(control !== elements.search);
    render();
  });
}
function clearFilters() {
  elements.search.value = "";
  elements.catalog.value = "";
  elements.kind.value = "";
  elements.runtime.value = "";
  elements.compatibility.value = "";
  elements.need.value = "";
  elements.demos.checked = false;
  elements.advanced.open = false;
  visibleLimit = RESULT_BATCH_SIZE;
  saveFilters(true);
  render();
  elements.search.focus();
}

elements.clear.addEventListener("click", clearFilters);
elements.emptyReset.addEventListener("click", clearFilters);
elements.filterToggle.addEventListener("click", () => {
  const expanded = elements.filterToggle.getAttribute("aria-expanded") !== "true";
  elements.filterToggle.setAttribute("aria-expanded", String(expanded));
  elements.filterControls.setAttribute("data-expanded", String(expanded));
});
elements.loadMore.addEventListener("click", () => {
  const previousCount = elements.list.children.length;
  visibleLimit += RESULT_BATCH_SIZE;
  render();
  elements.list.children[previousCount]?.querySelector(".resource-title-link")?.focus();
});

window.addEventListener("popstate", () => {
  visibleLimit = RESULT_BATCH_SIZE;
  pendingResourceLink = window.location.hash;
  restoreFilters();
  render();
  focusLinkedResource();
});
window.addEventListener("hashchange", () => {
  pendingResourceLink = window.location.hash;
  render();
  focusLinkedResource();
  document.getElementById(window.location.hash.slice(1))?.querySelector(".resource-title-link")?.focus({ preventScroll: true });
});

function addNeedShortcut(value, need) {
  NEEDS[value] = need;
  let option = Array.from(elements.need.options).find((entry) => entry.value === value);
  if (option) option.textContent = need.label;
  else {
    option = makeElement("option", "", need.label);
    option.value = value;
    elements.need.append(option);
  }
  syncNeedChoices?.();
}

for (const [value, need] of Object.entries(NEEDS)) addNeedShortcut(value, need);
filterChoices = [
  createChoices(elements.need, document.querySelector("#need-choices"), "Your task"),
  createChoices(elements.kind, document.querySelector("#kind-choices"), "Resource type"),
  createChoices(elements.runtime, document.querySelector("#runtime-choices"), "AI assistant", true),
];
syncNeedChoices = filterChoices[0];
restoreFilters();
pendingResourceLink = window.location.hash;
loadSource(sources[0]);
loadConfiguredSources();
