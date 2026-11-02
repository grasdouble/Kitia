"use strict";

import React from "react";
import { Box, Text } from "ink";
import type { CatalogResource, PendingDashboardAction, ScanError } from "../types.js";
import { fitColumn, fitText, wrapText } from "./helpers.mjs";

const h = React.createElement;
const MODAL_BACKGROUND = "#111827";
const MODAL_FOREGROUND = "#f9fafb";

function modalFrame(title, content, columns, accent, maxWidth = 64) {
  const width = Math.max(20, Math.min(maxWidth, columns - 4));
  const innerWidth = width - 4;
  const label = ` ${fitText(title, width - 5)} `;
  const top = `┌─${label}${"─".repeat(Math.max(0, width - label.length - 3))}┐`;
  const body = content.flatMap((entry) => {
    const row = typeof entry === "string" ? { text: entry } : entry;
    return wrapText(row.text, innerWidth).map((line) => ({
      text: `│ ${fitColumn(line, innerWidth)} │`,
      color: row.color,
      bold: row.bold,
      dimColor: row.dimColor,
    }));
  });
  return {
    width,
    lines: [
      { text: top, color: accent, bold: true },
      ...body,
      { text: `└${"─".repeat(width - 2)}┘`, color: accent, bold: true },
    ],
  };
}

function renderChoiceLine(label, choices, selected, focused) {
  return {
    text: `${label.padEnd(8)} ${choices.map((choice) =>
      `${choice === selected ? "> " : "  "}[ ${choice.toUpperCase()} ]`).join("  ")}`,
    color: focused ? "cyan" : "#d1d5db",
  };
}

export function optionsModal({
  resource,
  scope,
  tool,
  focus,
  resources,
  errors,
  columns,
}: {
  resource: CatalogResource;
  scope: string;
  tool: string;
  focus: number;
  resources: CatalogResource[];
  errors: ScanError[];
  columns: number;
}) {
  const source = resource.catalog === "internal" ? "INTERNAL" : resource.catalog.toUpperCase();
  const modalWidth = Math.max(20, Math.min(64, columns - 4));
  const contentWidth = Math.max(1, modalWidth - 8);
  const scopeChoices = resource.kind === "instruction" ? ["project"] : ["project", "user"];
  const toolChoices = ["copilot", "claude", "both"];
  const alreadyInstalled = resources.some((entry) =>
    entry.scope === scope && entry.catalog === resource.catalog &&
    entry.kind === resource.kind && entry.id === resource.id);
  const scopeError = errors.find((error) => error.scope === scope);

  return modalFrame("INSTALL OPTIONS", [
    `${source} / ${resource.kind}:${resource.id}`,
    ...wrapText(resource.description || "No description available.", contentWidth, 2),
    { text: `License: ${resource.license_status || "not declared"}`, dimColor: true },
    ...(["bundle", "mcp"].includes(resource.kind)
      ? [{ text: "Clients: Copilot CLI / Claude Code CLI only.", dimColor: true }]
      : []),
    ...(scopeError
      ? [{ text: `${scope.toUpperCase()} unavailable: ${scopeError.code}`, color: "redBright" }]
      : alreadyInstalled
        ? [{ text: `Already installed in ${scope} scope.`, color: "yellow" }]
        : []),
    ...(resource.kind === "instruction"
      ? [{ text: "Instructions are project-scoped.", dimColor: true }]
      : []),
    "",
    { text: "DESTINATION", bold: true },
    renderChoiceLine("SCOPE", scopeChoices, scope, focus === 0),
    renderChoiceLine("CLIENT", toolChoices, tool, focus === 1),
    scopeError || alreadyInstalled
      ? "↑↓ FIELD · ←→ CHOOSE · ESC BACK"
      : "↑↓ FIELD · ←→ CHOOSE · ENTER REVIEW · ESC BACK",
  ], columns, "cyan");
}

export function confirmationModal({
  confirmation,
  selectedButton,
  stage,
  columns,
}: {
  confirmation: PendingDashboardAction;
  selectedButton: number;
  stage: number;
  columns: number;
}) {
  const permanentRemoval = confirmation.action === "remove-unmanaged" && stage === 2;
  const actionLabel = confirmation.action === "install" ? "Install"
    : confirmation.action === "update" ? "Update"
      : confirmation.action === "remove-unmanaged"
        ? permanentRemoval ? "Remove permanently" : "Remove"
        : "Uninstall";
  const question = confirmation.action === "install"
    ? `Install ${confirmation.resource.kind}:${confirmation.resource.id}?`
    : confirmation.action === "remove-unmanaged"
      ? permanentRemoval
        ? `Permanently remove unmanaged ${confirmation.resource.kind}:${confirmation.resource.id}?`
        : `Remove unmanaged ${confirmation.resource.kind}:${confirmation.resource.id}?`
      : `${actionLabel} ${confirmation.resource.kind}:${confirmation.resource.id} from ${confirmation.resource.scope}?`;
  const removalWarning = permanentRemoval
    ? `This artifact is not managed by a Kitia catalog. This action is irreversible; ${
      confirmation.resource.kind === "skill" ? "all data in its skill directory" : "the artifact file"
    } will be permanently lost.`
    : confirmation.resource.kind === "skill"
      ? "Kitia will remove the entire detected skill folder and all of its contents."
      : "Kitia will remove the detected artifact file.";
  return modalFrame(
    permanentRemoval ? "CONFIRM PERMANENT REMOVAL" : `CONFIRM ${actionLabel.toUpperCase()}`,
    [
      question,
      ...(confirmation.action === "install"
        ? [`Destination: ${confirmation.scope} · Client: ${confirmation.tool}`,
          "Normal CLI safeguards apply; --force is not used."]
        : confirmation.action === "remove-unmanaged"
          ? [removalWarning]
          : confirmation.action === "uninstall" && confirmation.resource.kind === "skill"
            ? ["Kitia removes the entire managed skill folder and all of its contents; locally modified tracked files still block uninstall."]
            : ["The CLI safety checks apply; locally modified tracked files are protected."]),
      {
        text: `${selectedButton === 0 ? "> " : "  "}[ Cancel ]   ${selectedButton === 1 ? "> " : "  "}[ ${actionLabel} ]`,
        color: "cyan",
        bold: true,
      },
      "←/→ CHOOSE · ENTER SELECT · Y/N SHORTCUTS",
    ],
    columns,
    "yellow",
  );
}

export function postInstallModal({ environment, columns }: { environment: string[]; columns: number }) {
  const modalWidth = Math.min(64, columns - 4);
  const contentWidth = Math.max(1, modalWidth - 8);
  return modalFrame("MCP POST-INSTALL SETUP", [
    { text: "REQUIRED ENVIRONMENT", bold: true },
    ...wrapText(
        "Set these required environment variables in the environment used to launch the configured MCP client:",
        contentWidth,
      ).map((line) => ({ text: line, color: "redBright" })),
    ...environment.map((name) => ({ text: `  ${name}`, color: "redBright" })),
    { text: "Restart the CLI and approve the MCP server.", color: "redBright" },
    { text: "[ OK ]", color: "cyan", bold: true },
    "ENTER / ESC TO CLOSE",
  ], columns, "redBright");
}

export function inventoryMigrationModal({ scopes, columns }: { scopes: string[]; columns: number }) {
  const affectedScopes = [...new Set(scopes.filter((scope) => ["project", "user"].includes(scope)))];
  const scopeLabel = affectedScopes.length === 2
    ? "project and user inventories"
    : `${affectedScopes[0]} inventory`;
  return modalFrame("INVENTORY MIGRATION REQUIRED", [
    { text: `Migration is required for the ${scopeLabel}.`, color: "yellow", bold: true },
    ...affectedScopes.map((scope) => ({
      text: `${scope.toUpperCase()} inventory needs migration.`,
      color: scope === "user" ? "cyan" : MODAL_FOREGROUND,
      bold: true,
    })),
    "",
    "Run this from the current project directory:",
    {
      text: "npx --yes github:grasdouble/Kitia migrate --apply",
      color: "cyan",
      bold: true,
    },
    "It checks project and home inventories, skipping ones already current.",
    "Restart the dashboard after migration.",
    "",
    { text: "[ EXIT DASHBOARD ]", color: "cyan", bold: true },
    "ENTER / ESC TO EXIT",
  ], columns, "yellow", 96);
}
export function addCatalogModal({
  step,
  name,
  repository,
  mode,
  kind,
  id,
  path,
  entries,
  message,
  columns,
}: {
  step: string;
  name: string;
  repository: string;
  mode: "basic" | "custom";
  kind: "skill" | "agent" | "instruction";
  id: string;
  path: string;
  entries: Array<{ kind: string; id: string; path: string }>;
  message: string;
  columns: number;
}) {
  const field = (label: string, value: string) => ({
    text: `${label}: ${value || "…"}▏`,
    color: "cyan",
    bold: true,
  });
  const content = step === "name"
    ? [field("Catalog name", name), ...(message ? [{ text: message, color: "yellow" }] : []), "", "ENTER CONTINUES · ESC CANCEL"]
    : step === "repository"
      ? [field("HTTPS GitHub URL", repository), ...(message ? [{ text: message, color: "yellow" }] : []), "", "ENTER CONTINUES · ESC CANCEL"]
      : step === "mode"
        ? [
          `Choose catalog setup:  ${mode === "basic" ? "> BASIC" : "  BASIC"}    ${mode === "custom" ? "> CUSTOM" : "  CUSTOM"}`,
          "Basic detects skills, agents, and instructions in common repository paths.",
          "Custom lets you specify other paths explicitly.",
          "",
          "← → CHOOSE · ENTER CONTINUES · ESC CANCEL",
        ]
        : step === "kind"
          ? [
            `Artifact kind: ${kind.toUpperCase()}  (← → to change)`,
            "", "ENTER CONTINUES · ESC CANCEL",
          ]
        : step === "path"
          ? [
            field("Repository-relative source path", path),
            kind === "skill"
              ? "Use the skill directory containing SKILL.md; ID is its directory name."
              : "Use the Markdown file path; ID is derived from its filename.",
            ...(message ? [{ text: message, color: "yellow" }] : []),
            "ENTER ADDS ENTRY · ESC CANCEL",
          ]
              : step === "entries"
                ? [
                  `Entries configured: ${entries.length}`,
                  ...entries.map((entry) => `• ${entry.kind}:${entry.id} ← ${entry.path}`),
                  ...(message ? [{ text: message, color: "yellow" }] : []),
                  "", "[ A ] ADD ANOTHER ENTRY    [ ENTER ] FINISH    [ ESC ] CANCEL",
                ]
                : [
                  message,
                  "", "ENTER / ESC CLOSE",
                ];
  return modalFrame(
    step === "result" ? "ADD CATALOG RESULT" : "ADD CATALOG",
    content,
    columns,
    step === "result" && message.startsWith("Catalog added") ? "green" : "cyan",
    80,
  );
}


export function removeCatalogModal({
  catalogs,
  state,
  columns,
}: {
  catalogs: Array<{ name: string; repository: string }>;
  state: { step: string; index: number; name: string; message: string; failed: boolean };
  columns: number;
}) {
  const content = state.step === "select"
    ? [
      "Choose a user catalog to remove:",
      ...catalogs.map(({ name, repository }, index) =>
        `${index === state.index ? "> " : "  "}${name} (${repository})`),
      "",
      "↑↓ SELECT · ENTER CONTINUE · ESC CANCEL",
    ]
    : state.step === "confirm"
      ? [
        `Remove catalog ${state.name}?`,
        "This removes its local definition and index.",
        "Already-installed artifacts are not removed.",
        "",
        "[ Y ] REMOVE    [ N / ESC ] BACK",
      ]
      : [
        state.message,
        "",
        state.step === "working" ? "PLEASE WAIT" : "ENTER / ESC CLOSE",
      ];
  return modalFrame(
    state.step === "confirm" ? "CONFIRM CATALOG REMOVAL" : "REMOVE CATALOG",
    content,
    columns,
    state.failed ? "redBright" : state.step === "result" ? "green" : "yellow",
    80,
  );
}
export function refreshCatalogModal({
  catalogs,
  state,
  columns,
}: {
  catalogs: Array<{ name: string; repository: string }>;
  state: { step: string; scope: "one" | "all"; index: number; name: string; message: string; details?: string[]; failed: boolean };
  columns: number;
}) {
  const content = state.step === "scope"
    ? [
      "Choose catalog refresh scope:",
      `  ${state.scope === "one" ? "> ONE CATALOG" : "  ONE CATALOG"}    ${state.scope === "all" ? "> ALL CATALOGS" : "  ALL CATALOGS"}`,
      "Refresh updates the local index; installed artifacts stay unchanged.",
      "",
      "← → CHOOSE · ENTER CONTINUE · ESC CANCEL",
    ]
    : state.step === "select"
      ? [
        "Choose a user catalog to refresh:",
        ...catalogs.map(({ name, repository }, index) =>
          `${index === state.index ? "> " : "  "}${name} (${repository})`),
        "",
        "↑↓ SELECT · ENTER REFRESH · ESC BACK",
      ]
      : state.step === "errors"
        ? [
          "Refresh error details:",
          ...(state.details?.length ? state.details : ["No error details available."]),
          "",
          "ENTER / ESC BACK",
        ]
        : [
          state.message,
          "",
          state.step === "working" ? "PLEASE WAIT"
            : state.failed ? "S SHOW DETAILS · ENTER / ESC CLOSE" : "ENTER / ESC CLOSE",
        ];
  return modalFrame(
    state.step === "scope" ? "REFRESH CATALOGS"
      : state.step === "errors" ? "CATALOG REFRESH ERRORS" : "REFRESH CATALOG",
    content,
    columns,
    state.failed ? "redBright" : state.step === "result" ? "green" : "yellow",
    80,
  );
}

export function ModalOverlay({ modal, columns, rows }: {
  modal: ReturnType<typeof modalFrame>;
  columns: number;
  rows: number;
}) {
  const top = Math.max(0, Math.floor((rows - modal.lines.length) / 2));
  const left = Math.max(0, Math.floor((columns - modal.width) / 2));
  return h(Box, {
    position: "absolute",
    top,
    left,
    width: modal.width,
    flexDirection: "column",
  }, ...modal.lines.map((line, index) => h(Text, {
    key: `modal-line-${index}`,
    color: line.color || MODAL_FOREGROUND,
    backgroundColor: MODAL_BACKGROUND,
    bold: line.bold,
    dimColor: line.dimColor,
  }, line.text)));
}
