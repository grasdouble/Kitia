"use strict";

const readline = require("node:readline");
const { CatalogError } = require("../catalog/resources/index.js");
const { matchesSearchText } = require("../catalog/search.js");
import type { CatalogResource } from "../catalog/entries.js";

interface Keypress {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

type TerminalInput = NodeJS.ReadStream & { isRaw?: boolean };
type TerminalOutput = NodeJS.WriteStream;

function formatCatalogHeader() {
  return `${colorize("CATALOG".padEnd(18), "bold")} ${colorize("KIND".padEnd(11), "bold")} ${colorize("ID".padEnd(30), "bold")} ${colorize("STATUS".padEnd(13), "bold")} DESCRIPTION`;
}

function formatCatalogRow(resource: CatalogResource, marker = "", color = supportsColor()): string {
  const statusColor = {
    experimental: "yellow",
    stable: "green",
    deprecated: "red",
  }[resource.status] || "gray";
  const catalogColor = resource.source_repository ? "cyan" : "gray";
  const fields = [
    colorize(resource.catalog.padEnd(18), catalogColor, color),
    colorize(resource.kind.padEnd(11), "magenta", color),
    resource.id.padEnd(30),
    colorize((resource.status || "-").padEnd(13), statusColor, color),
    truncateDescription(resource.description),
  ];
  const prefix = marker ? colorize(marker, "cyan", color) : "";
  return `${prefix}${fields.join(" ")}`;
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
      const lines = [
        "Select a catalog entry (Esc to cancel):",
        `Filter: ${query}`,
        formatCatalogHeader(),
        ...(page.length
          ? page.map((resource, index) =>
            formatCatalogRow(resource, first + index === selectedIndex ? "> " : "  ", supportsColor(output)))
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


function installedColumns(width) {
  const description = Math.max(12, Math.min(36, width - 68));
  const id = Math.max(12, Math.min(22, width - (9 + 15 + 11 + 10 + description + 5)));
  return { scope: 9, catalog: 15, kind: 11, id, status: 10, description };
}

function fitColumn(value, width) {
  const characters = Array.from(String(value || ""));
  if (characters.length > width) {
    return `${characters.slice(0, Math.max(0, width - 3)).join("")}...`;
  }
  return characters.join("").padEnd(width);
}

function formatInstalledHeader(width = 100) {
  const columns = installedColumns(width);
  return ([
    ["SCOPE", columns.scope],
    ["CATALOG", columns.catalog],
    ["KIND", columns.kind],
    ["ID", columns.id],
    ["STATUS", columns.status],
    ["DESCRIPTION", columns.description],
  ] as Array<[string, number]>).map(([label, columnWidth]) => label.padEnd(columnWidth)).join(" ");
}

function dashboardStatus(resource) {
  return resource.status === "attention" && resource.issues?.length &&
    resource.issues.every((issue) => issue.code === "UPDATE_AVAILABLE")
    ? "update"
    : resource.status;
}

function formatInstalledRow(resource, marker = "", color = supportsColor(), width = 100) {
  const columns = installedColumns(width);
  const status = dashboardStatus(resource);
  const statusColor = status === "unmanaged" ? "gray" : status === "attention" ? "yellow" : status === "update" ? "cyan" : "green";
  const scopeColor = resource.scope === "user" ? "cyan" : "blue";
  const catalogColor = resource.source_repository ? "cyan" : "gray";
  return [
    colorize(fitColumn(`${marker}${resource.scope || "project"}`, columns.scope), scopeColor, color),
    colorize(fitColumn(resource.catalog, columns.catalog), catalogColor, color),
    colorize(fitColumn(resource.kind, columns.kind), "magenta", color),
    fitColumn(resource.id, columns.id),
    colorize(fitColumn(status, columns.status), statusColor, color),
    fitColumn(resource.description, columns.description),
  ].join(" ");
}

function renderInstalledResources(resources, output = process.stdout, errors = []) {
  const width = output.columns || 100;
  const lines = resources.length
    ? [
      formatInstalledHeader(width),
      ...resources.map((resource) => formatInstalledRow(resource, "", supportsColor(output), width)),
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
  const codes = {
    bold: "1",
    gray: "90",
    red: "31",
    green: "32",
    yellow: "33",
    blue: "34",
    magenta: "35",
    cyan: "36",
    whiteOnBlue: "97;44",
    whiteOnGray: "97;100",
  };
  const code = codes[color];
  if (!code) {
    throw new CatalogError(`Unknown terminal color: ${color}`);
  }
  return `\u001b[${code}m${value}\u001b[0m`;
}

module.exports = {
  formatCatalogHeader, formatCatalogRow, resolveCatalogResource, selectCatalogResource,
  formatInstalledHeader, formatInstalledRow, renderInstalledResources, browseInstalledResources,
  truncateDescription, supportsColor, colorize,
};
