"use strict";

const readline = require("node:readline");
const { CatalogError } = require("../catalog/resources/index.js");
const { matchesSearchText } = require("../catalog/search.js");
import type { CatalogResource } from "../catalog/entries.js";
const { adaptiveColumnWidths } = require("../table-layout.js");
import { DASHBOARD_THEME } from "./colors.js";

function fitColumn(value, width) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  const characters = Array.from(text);
  const fitted = characters.length <= width
    ? text
    : `${characters.slice(0, Math.max(0, width - 3)).join("")}...`;
  return fitted.padEnd(width);
}

interface Keypress {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

type TerminalInput = NodeJS.ReadStream & { isRaw?: boolean };
type TerminalOutput = NodeJS.WriteStream;

function catalogColumnWidths(resources, width, markerWidth = 0) {
  const contentWidth = (header, value) => resources.reduce((maximum, resource) =>
    Math.max(maximum, String(value(resource) || "").length), header.length);
  const kindWidth = contentWidth("KIND", (resource) => resource.kind);
  const catalogWidth = contentWidth("CATALOG", (resource) => resource.catalog);
  const idWidth = contentWidth("ID", (resource) => resource.id);
  const statusWidth = contentWidth("STATUS", (resource) => resource.status || "-");
  const compact = Number.isFinite(width) && width < 58;
  const rules = [
    { contentWidth: catalogWidth, minWidth: compact ? 7 : catalogWidth, growWeight: 1, shrinkWeight: 1 },
    { contentWidth: kindWidth, minWidth: kindWidth, shrinkWeight: 0 },
    { contentWidth: idWidth, minWidth: compact ? 6 : idWidth, growWeight: 1, shrinkWeight: 1 },
    { contentWidth: statusWidth, minWidth: statusWidth, shrinkWeight: 0 },
    { contentWidth: contentWidth("DESCRIPTION", (resource) => resource.description), minWidth: 12, growWeight: 2, shrinkWeight: 4 },
  ];
  const naturalWidth = rules.reduce((sum, rule) => sum + rule.contentWidth, rules.length - 1);
  const availableWidth = Number.isFinite(width) ? Math.max(1, width - markerWidth) : naturalWidth;
  return adaptiveColumnWidths(availableWidth, rules);
}

function formatCatalogHeader(columns, markerWidth = 0, color = supportsColor()) {
  const labels = ["CATALOG", "KIND", "ID", "STATUS", "DESCRIPTION"];
  return " ".repeat(markerWidth) + labels.map((label, index) =>
    colorize(fitColumn(label, columns[index]), "bold", color)).join(" ");
}

function formatCatalogRow(resource, marker = "", color = supportsColor(), columns) {
  const statusColor = DASHBOARD_THEME.semantic.catalogStatus[resource.status] || DASHBOARD_THEME.semantic.catalogStatus.unknown;
  const catalogColor = resource.source_repository
    ? DASHBOARD_THEME.semantic.catalogRepository.connected
    : DASHBOARD_THEME.semantic.catalogRepository.missing;
  const values = [
    colorize(fitColumn(resource.catalog, columns[0]), catalogColor, color),
    colorize(fitColumn(resource.kind, columns[1]), DASHBOARD_THEME.semantic.terminalKind, color),
    fitColumn(resource.id, columns[2]),
    colorize(fitColumn(resource.status || "-", columns[3]), statusColor, color),
    fitColumn(resource.description, columns[4]),
  ];
  const prefix = marker ? colorize(marker, DASHBOARD_THEME.semantic.selected, color) : "";
  return `${prefix}${values.join(" ")}`;
}

function formatCatalogTable(resources, output = process.stdout) {
  const color = supportsColor(output);
  const width = output.isTTY ? output.columns || 100 : undefined;
  const columns = catalogColumnWidths(resources, width);
  return [
    formatCatalogHeader(columns, 0, color),
    ...resources.map((resource) => formatCatalogRow(resource, "", color, columns)),
  ].join("\n");
}

async function resolveCatalogResource(
  resources: CatalogResource[],
  id: string,
  kind: string | null = null,
  selector: (resources: CatalogResource[]) => Promise<CatalogResource | null> = selectCatalogResource,
): Promise<CatalogResource | null> {
  const candidates = resources.filter((resource) =>
    resource.id === id && (!kind || resource.kind === kind),
  );
  if (!candidates.length) {
    throw new CatalogError(`Resource not found: ${kind ? `${kind} ` : ""}${id}`, "RESOURCE_NOT_FOUND");
  }
  if (candidates.length === 1) {
    return candidates[0];
  }
  const selected = await selector(candidates);
  if (!selected) {
    return null;
  }
  return selected;
}

function selectCatalogResource(
  resources: CatalogResource[],
  input: TerminalInput = process.stdin,
  output: TerminalOutput = process.stdout,
): Promise<CatalogResource | null> {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    const choices = resources.map((resource) =>
      `${resource.kind}:${resource.id} [${resource.catalog}]`).join(", ");
    return Promise.reject(
      new CatalogError(`Resource id '${resources[0]?.id || ""}' is ambiguous; specify a kind (${choices})`),
    );
  }
  const previousRawMode = Boolean(input.isRaw);
  readline.emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();

  return new Promise((resolve) => {
    let query = "";
    let selectedIndex = 0;
    let finished = false;
    const matches = () => {
      return resources.filter((resource) => {
        return matchesSearchText(query, [
          resource.catalog, resource.kind, resource.id,
          resource.status || "", resource.description,
        ]);
      });
    };
    const render = () => {
      const visible = matches();
      selectedIndex = visible.length ? Math.min(selectedIndex, visible.length - 1) : 0;
      const viewport = Math.max(1, (output.rows || 24) - 5);
      const first = Math.max(0, Math.min(
        selectedIndex - viewport + 1,
        visible.length - viewport,
      ));
      const page = visible.slice(first, first + viewport);
      const columns = catalogColumnWidths(visible, output.columns || 100, 2);
      const color = supportsColor(output);
      const lines = [
        "Select a catalog entry (Esc to cancel):",
        `Filter: ${query}`,
        formatCatalogHeader(columns, 2, color),
        ...(page.length
          ? page.map((resource, index) =>
            formatCatalogRow(resource, first + index === selectedIndex ? "> " : "  ", color, columns))
          : ["No matching resources." ]),
        `${visible.length ? `${first + 1}-${first + page.length} of ${visible.length}` : "0 results"} | Enter: select`,
      ];
      output.write(`\u001b[H\u001b[2J${lines.join("\n")}`);
    };
    const finish = (selected) => {
      if (finished) {
        return;
      }
      finished = true;
      input.removeListener("keypress", onKeypress);
      input.setRawMode(previousRawMode);
      input.pause();
      output.write("\u001b[?25h\u001b[?1049l");
      resolve(selected);
    };
    const onKeypress = (character: string, key: Keypress = {}) => {
      if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        finish(null);
        return;
      }
      const visible = matches();
      if (key.name === "up") {
        selectedIndex = visible.length ? (selectedIndex - 1 + visible.length) % visible.length : 0;
      } else if (key.name === "down") {
        selectedIndex = visible.length ? (selectedIndex + 1) % visible.length : 0;
      } else if (key.name === "return" || key.name === "enter") {
        finish(visible[selectedIndex] || null);
        return;
      } else if (key.name === "backspace") {
        query = Array.from(query).slice(0, -1).join("");
        selectedIndex = 0;
      } else if (character && !key.ctrl && !key.meta && character >= " ") {
        query += character;
        selectedIndex = 0;
      }
      render();
    };

    input.on("keypress", onKeypress);
    output.write("\u001b[?1049h\u001b[?25l");
    render();
  });
}


function installedColumnWidths(resources, width) {
  const compact = Number.isFinite(width) && width < 48;
  const contentWidth = (header, value) => resources.reduce((maximum, resource) =>
    Math.max(maximum, String(value(resource) || "").length), header.length);
  const kindWidth = contentWidth("KIND", (resource) => resource.kind);
  const scopeWidth = contentWidth("SCOPE", (resource) => resource.scope || "project");
  const catalogWidth = contentWidth("CATALOG", (resource) => resource.catalog);
  const idWidth = contentWidth("ID", (resource) => resource.id);
  const statusWidth = contentWidth("STATUS", (resource) => dashboardStatus(resource));
  const rules = [
    { contentWidth: scopeWidth, minWidth: scopeWidth, shrinkWeight: 0 },
    { contentWidth: catalogWidth, minWidth: compact ? 6 : catalogWidth, maxWidth: catalogWidth + 4, growWeight: 1, shrinkWeight: 1 },
    { contentWidth: kindWidth, minWidth: kindWidth, shrinkWeight: 0 },
    { contentWidth: idWidth, minWidth: compact ? 6 : idWidth, growWeight: 1, shrinkWeight: 1 },
    { contentWidth: statusWidth, minWidth: statusWidth, shrinkWeight: 0 },
    ...(!compact ? [{
      contentWidth: contentWidth("DESCRIPTION", (resource) => resource.description),
      minWidth: 12,
      growWeight: 3,
      shrinkWeight: 4,
    }] : []),
  ];
  const naturalWidth = rules.reduce((sum, rule) => sum + rule.contentWidth, rules.length - 1);
  const widths = adaptiveColumnWidths(Number.isFinite(width) ? width : naturalWidth, rules);
  return {
    scope: widths[0],
    catalog: widths[1],
    kind: widths[2],
    id: widths[3],
    status: widths[4],
    description: compact ? 0 : widths[5],
    compact,
  };
}

function formatInstalledHeader(columns) {
  return [
    ["SCOPE", columns.scope],
    ["CATALOG", columns.catalog],
    ["KIND", columns.kind],
    ["ID", columns.id],
    ["STATUS", columns.status],
    ...(!columns.compact ? [["DESCRIPTION", columns.description]] : []),
  ].filter(([, columnWidth]) => columnWidth > 0)
    .map(([label, columnWidth]) => fitColumn(label, columnWidth)).join(" ");
}

function dashboardStatus(resource) {
  return resource.status === "attention" && resource.issues?.length &&
    resource.issues.every((issue) => issue.code === "UPDATE_AVAILABLE")
    ? "update"
    : resource.status;
}

function formatInstalledRow(resource, marker = "", color = supportsColor(), columns) {
  const status = dashboardStatus(resource);
  const statusColor = status === "unmanaged"
    ? DASHBOARD_THEME.semantic.inventoryStatus.unmanaged
    : status === "attention"
      ? DASHBOARD_THEME.semantic.inventoryStatus.attention
      : status === "update"
        ? DASHBOARD_THEME.semantic.selected
        : DASHBOARD_THEME.semantic.inventoryStatus.current;
  const scopeColor = resource.scope === "user"
    ? DASHBOARD_THEME.semantic.terminalScope.user
    : DASHBOARD_THEME.semantic.terminalScope.project;
  const catalogColor = resource.source_repository
    ? DASHBOARD_THEME.semantic.catalogRepository.connected
    : DASHBOARD_THEME.semantic.catalogRepository.missing;
  const fields = [
    [colorize(fitColumn(`${marker}${resource.scope || "project"}`, columns.scope), scopeColor, color), columns.scope],
    [colorize(fitColumn(resource.catalog, columns.catalog), catalogColor, color), columns.catalog],
    [colorize(fitColumn(resource.kind, columns.kind), DASHBOARD_THEME.semantic.terminalKind, color), columns.kind],
    [fitColumn(resource.id, columns.id), columns.id],
    [colorize(fitColumn(status, columns.status), statusColor, color), columns.status],
    [fitColumn(resource.description, columns.description), columns.description],
  ];
  return fields.filter(([, width]) => width > 0).map(([value]) => value).join(" ");
}

function renderInstalledResources(resources, output = process.stdout, errors = []) {
  const width = output.isTTY ? output.columns || 100 : undefined;
  const columns = installedColumnWidths(resources, width);
  const lines = resources.length
    ? [
      formatInstalledHeader(columns),
      ...resources.flatMap((resource) => [
        formatInstalledRow(resource, "", supportsColor(output), columns),
        ...(columns.compact && resource.description
          ? [`  ${truncateDescription(resource.description, Math.max(4, width - 2))}`]
          : []),
      ]),
    ]
    : ["No catalog-managed resources found in project or user scope."];
  if (errors.length) {
    lines.push("", ...errors.map((error) => `Error (${error.scope} scope, ${error.code}): ${error.message}`));
  }
  return lines.join("\n");
}

async function browseInstalledResources(
  resources,
  input = process.stdin,
  output = process.stdout,
  errors = [],
  actions = {},
) {
  const { runDashboard } = await import("./dashboard.mjs");
  return runDashboard(resources, input, output, errors, actions);
}

function truncateDescription(description, maxLength = 80) {
  const characters = Array.from(description);
  if (characters.length <= maxLength) {
    return description;
  }
  return `${characters.slice(0, Math.max(0, maxLength - 3)).join("").trimEnd()}...`;
}

function supportsColor(
  stream: { isTTY?: boolean } = process.stdout,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(stream.isTTY && !env.NO_COLOR && env.TERM !== "dumb");
}

function colorize(value, color, enabled = supportsColor()) {
  if (!enabled) {
    return value;
  }
  const code = DASHBOARD_THEME.terminalAnsi[color];
  if (!code) {
    throw new CatalogError(`Unknown terminal color: ${color}`);
  }
  return `\u001b[${code}m${value}\u001b[0m`;
}

module.exports = {
  formatCatalogTable, resolveCatalogResource, selectCatalogResource,
  formatInstalledHeader, formatInstalledRow, renderInstalledResources, browseInstalledResources,
  truncateDescription, supportsColor, colorize,
};
