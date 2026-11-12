"use strict";

import React from "react";
import { Box, Text } from "ink";
import type { CatalogResource } from "../catalog/entries.js";
import type { ScanError } from "../catalog/lifecycle.js";
import { adaptiveColumnWidths } from "../table-layout.js";
import { fitColumn, fitText, wrapText } from "./helpers.mjs";
import { DASHBOARD_THEME } from "./colors.js";
import { Panel, ShortcutsPanel, categorizedShortcutLines, wrappedShortcutLines } from "./screens/shared.mjs";

export interface PendingDashboardAction {
  action: "install" | "update" | "uninstall" | "remove-unmanaged" | "preview";
  resource: CatalogResource;
  scope?: string;
  tool?: string;
  ref?: string;
  forceRetry?: boolean;
  ghForceRetry?: boolean;
  ghForceAgent?: string;
  ghForceAgents?: string[];
  conflict?: { category: string; paths: string[]; message?: string };
}

export type SourceVersionOption = { sha: string; prefix: string; date: string; subject: string };

const h = React.createElement;
const MODAL_BACKGROUND = DASHBOARD_THEME.semantic.modal.background;
const MODAL_FOREGROUND = DASHBOARD_THEME.semantic.modal.foreground;

const { semantic } = DASHBOARD_THEME;
function choiceLabel(choice, selected) {
  return selected ? `‹ ${choice.toUpperCase()} ›` : `[ ${choice.toUpperCase()} ]`;
}

function choiceGroup(label, choices, selectedIndex, focused = true) {
  const options = choices.map((choice) => typeof choice === "string" ? { label: choice } : choice);
  const prefix = label ? `${label.padEnd(8)} ` : "";
  const text = `${prefix}${options.map((choice, index) =>
    choiceLabel(choice.label, index === selectedIndex)).join(" ")}`;
  return {
    type: "choice-group",
    text,
    label: prefix,
    options,
    selectedIndex,
    focused,
  };
}

function categorizeShortcutHint(hint: string) {
  const groups: Record<"Actions" | "Filters" | "Display" | "Navigation", string[]> = {
    Actions: [],
    Filters: [],
    Display: [],
    Navigation: [],
  };
  for (const shortcut of hint.split(" · ")) {
    const value = shortcut.toUpperCase();
    const category = /FILTER|SEARCH|TYPE TO|BACKSPACE|APPLY|CLEAR/.test(value)
      ? "Filters"
      : /DETAILS|SHOW DETAILS|PANEL/.test(value)
        ? "Display"
        : /↑|↓|←|→|PGUP|PGDN|TAB|NAVIGATE|SELECT|CHOOSE|MOVE|GUIDE|QUIT|BACK|NEXT|FINISH|INVENTORY/.test(value)
          ? "Navigation"
          : "Actions";
    groups[category].push(shortcut);
  }
  return categorizedShortcutLines(groups);
}

function selectableOption(label, selected) {
  return {
    type: "selectable-option",
    text: `${selected ? "› " : "  "}${label}`,
    label,
    selected,
  };
}

function modalFrame(title, content, columns, accent, maxWidth = 64, headerContent?: string[]) {
  const separateHeader = headerContent !== undefined;
  const width = Math.max(20, Math.min(maxWidth, columns - 4));
  const innerWidth = width - 4;
  const lastContent = content.at(-1);
  const shortcutHint = typeof lastContent === "string" &&
    /ENTER|ESC|CHOOSE|SELECT|FIELD|BACK|NEXT|CANCEL|CLOSE|QUIT|CONFIRM|TOGGLE|CTRL|SPACE|Y\/N/i.test(lastContent)
    ? lastContent
    : undefined;
  const modalContent = shortcutHint ? content.slice(0, -1) : content;
  const label = separateHeader ? "" : ` ${fitText(title, width - 5)} `;
  const top = separateHeader ? "" : `┌─${label}${"─".repeat(Math.max(0, width - label.length - 3))}┐`;
  const body = modalContent.flatMap((entry) => {
    const row = typeof entry === "string" ? { text: entry } : entry;
    const wrapped = row.preserveSpacing ? [row.text] : wrapText(row.text, innerWidth);
    return wrapped.map((line) => ({
      text: separateHeader ? line : `│ ${fitColumn(line, innerWidth)} │`,
      bodyText: line,
      component: wrapped.length === 1 && row.text.length <= innerWidth ? row.type : undefined,
      label: row.label,
      options: row.options,
      selectedIndex: row.selectedIndex,
      focused: row.focused,
      selected: row.selected,
      color: row.color,
      bold: row.bold,
      dimColor: row.dimColor,
      borderColor: accent,
    }));
  });
  return {
    width,
    accent,
    panelTitle: separateHeader ? title : undefined,
    headerLines: (headerContent || []).flatMap((text) =>
      wrapText(text, innerWidth).map((text) => ({ text }))),
    lines: separateHeader ? body : [
      { text: top, color: accent, bold: true },
      ...body,
      { text: `└${"─".repeat(width - 2)}┘`, color: accent, bold: true },
    ],
    shortcuts: shortcutHint ? categorizeShortcutHint(shortcutHint.replaceAll(" | ", " · ")) : [],
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
  ref,
}: {
  resource: CatalogResource;
  scope: string;
  tool: string;
  focus: number;
  resources: CatalogResource[];
  errors: ScanError[];
  columns: number;
  ref?: string | null;
}) {
  const source = (resource.catalog || "-").toUpperCase();
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
    ...wrapText(resource.description || "No description available.", contentWidth, 3),
    { text: `License: ${resource.license_status || "not declared"}`, dimColor: true },
    ...(scopeError
      ? [{ text: `${scope.toUpperCase()} unavailable: ${scopeError.code}`, color: semantic.accents.error }]
      : alreadyInstalled
        ? [{
          text: ref
            ? `Selected revision will replace the installed resource in ${scope} scope.`
            : `Already installed in ${scope} scope.`,
          color: semantic.inventoryStatus.attention,
        }]
        : []),
    ...(resource.kind === "instruction"
      ? [{ text: "Instructions are project-scoped.", dimColor: true }]
      : []),
    "",
    { text: "DESTINATION", bold: true },
    choiceGroup("SCOPE", scopeChoices, scopeChoices.indexOf(scope), focus === 0),
    choiceGroup("CLIENT", toolChoices, toolChoices.indexOf(tool), focus === 1),
    ...(ref ? [{ text: `Selected commit: ${ref}. The catalog pin remains unchanged.`, color: semantic.selected }] : []),
    { text: "Kitia audits the pinned source before every dashboard install; findings or incomplete coverage block it.", color: semantic.accents.warning },
    scopeError || (alreadyInstalled && !ref)
      ? "↑↓ FIELD · ←→ CHOOSE · TAB FOCUS · ESC BACK"
      : alreadyInstalled
        ? "↑↓ FIELD · ←→ CHOOSE · TAB FOCUS · ENTER REPLACE · ESC BACK"
        : "↑↓ FIELD · ←→ CHOOSE · TAB FOCUS · ENTER REVIEW · ESC BACK"
  ], columns, semantic.selected);
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
  const conflict = confirmation.conflict;
  const conflictCategory = confirmation.ghForceRetry
    ? "GitHub CLI reported that the skill is already installed and requires --force to overwrite it."
    : conflict?.category === "tracked-modification"
      ? "Tracked files were locally modified."
      : conflict?.category === "untracked-skill-content"
        ? "Untracked content is present in the skill directory."
        : "A local conflict was detected.";
  const conflictPaths = conflict?.paths || [];
  const forceImpact = confirmation.ghForceRetry
    ? "Retry will pass --force to GitHub CLI only; Kitia's local-modification and untracked-content checks still apply."
    : conflict?.category === "tracked-modification"
      ? "Forcing will overwrite the locally modified tracked files listed above."
      : conflict?.category === "untracked-skill-content"
        ? "Forcing may replace or remove untracked content in this skill directory."
        : "Forcing will overwrite the conflicting local destination files listed above.";
  const targetContext = [
    confirmation.resource.catalog && `catalog ${confirmation.resource.catalog}`,
    confirmation.resource.scope && `scope ${confirmation.resource.scope}`,
  ].filter(Boolean).join(" · ");
  const question = confirmation.ghForceRetry
    ? `GitHub CLI asked to overwrite ${confirmation.resource.kind}:${confirmation.resource.id}${confirmation.ghForceAgent ? ` for ${confirmation.ghForceAgent}` : ""}${targetContext ? ` (${targetContext})` : ""}. Retry with --force?`
    : confirmation.forceRetry
      ? `Conflict detected while updating ${confirmation.resource.kind}:${confirmation.resource.id}${targetContext ? ` (${targetContext})` : ""}. Force update and retry?`
      : confirmation.action === "install"
        ? `Install ${confirmation.resource.kind}:${confirmation.resource.id}?`
        : confirmation.action === "update" && confirmation.ref
          ? `Replace the installed ${confirmation.resource.kind}:${confirmation.resource.id} with the selected revision in ${confirmation.resource.scope} scope?`
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
  const updateSafeguard = confirmation.resource.kind === "skill" && confirmation.resource.source_repository
    ? "The first gh skill install runs without --force. If GH says overwrite requires --force, Kitia asks before retrying; local safety checks apply."
    : "This resource update does not use gh --force. Kitia checks local conflicts and asks separately before Kitia force can overwrite them.";
  return modalFrame(
    confirmation.ghForceRetry
      ? "GH REQUESTS OVERWRITE"
      : confirmation.forceRetry ? "LOCAL CONFLICT" : permanentRemoval ? "CONFIRM PERMANENT REMOVAL" : `CONFIRM ${actionLabel.toUpperCase()}`,
    [
      question,
      ...(confirmation.forceRetry
        ? [
          conflict?.message || conflictCategory,
          ...(!confirmation.ghForceRetry ? conflictPaths.slice(0, 12).map((item) => `• ${item}`) : []),
          ...(!confirmation.ghForceRetry && conflictPaths.length > 12
            ? [`…and ${conflictPaths.length - 12} more path(s)`]
            : []),
          forceImpact,
        ]
        : confirmation.action === "install"
          ? [
            `Destination: ${confirmation.scope} · Client: ${confirmation.tool}`,
            ...(confirmation.ref ? [`Selected revision: ${confirmation.ref} (catalog pin unchanged).`] : []),
            "Normal CLI safeguards apply; --force is not used.",
          ]
          : confirmation.action === "update"
            ? [
              updateSafeguard,
              ...(confirmation.ref ? [`Selected revision: ${confirmation.ref} (catalog pin unchanged).`] : []),
            ]
            : confirmation.action === "remove-unmanaged"
              ? [removalWarning]
              : confirmation.action === "uninstall" && confirmation.resource.kind === "skill"
                ? ["Kitia removes the entire managed skill folder and all of its contents; locally modified tracked files still block uninstall."]
                : ["The CLI safety checks apply; locally modified tracked files are protected."]),
      "",
      choiceGroup("", [
        { label: confirmation.forceRetry ? "NO / CANCEL" : "CANCEL" },
        { label: confirmation.forceRetry ? "YES, RETRY WITH --FORCE" : actionLabel, color: confirmation.action !== "install" ? semantic.accents.danger : semantic.selected },
      ], selectedButton),
      "←/→ CHOOSE · ENTER CONFIRM · Y/N SHORTCUTS",
    ],
    columns,
    semantic.accents.warning,
  );
}
export function actionFailureModal({
  action,
  message,
  columns,
}: {
  action: string;
  message: string;
  columns: number;
}) {
  const outputLines = message.split(/\r?\n/).filter(Boolean);
  return modalFrame(
    `${action.toUpperCase()} FAILED`,
    [
      { text: "Kitia could not complete this action.", color: semantic.accents.error, bold: true },
      ...(outputLines.length ? outputLines : ["No error details were provided."]),
      "ENTER / ESC CLOSE",
    ],
    columns,
    semantic.accents.error,
    88,
  );
}
export function loadingModal({ message, frame, columns }: {
  message: string;
  frame: string;
  columns: number;
}) {
  return modalFrame("LOADING", [
    { text: `${frame} ${message}`, color: semantic.selected, bold: true },
    "",
    "Please wait while Kitia completes this operation.",
  ], columns, semantic.selected, 72);
}
export function sourceVersionsModal({
  resource,
  versions,
  selectedIndex,
  action,
  columns,
  rows,
}: {
  resource: CatalogResource;
  versions: SourceVersionOption[];
  selectedIndex: number;
  action: "install" | "update";
  columns: number;
  rows: number;
}) {
  const width = Math.max(20, columns - 4);
  const lineWidth = width - 4;
  const shortcutHint = `↑↓ SELECT · ENTER ${action.toUpperCase()} · ESC BACK`;
  const shortcutsRows = wrappedShortcutLines(categorizeShortcutHint(shortcutHint), width).length + 4;
  const compactContext = rows <= 18;
  const rangeRows = compactContext ? 0 : wrapText(
    `Showing ${versions.length}-${versions.length} of ${versions.length} commits.`, lineWidth,
  ).length;
  const instruction = compactContext
    ? ""
    : `Select a commit to ${action}; the catalog pin remains unchanged.`;
  const resourceLabel = `${resource.catalog || "source"} / ${resource.kind}:${resource.id}`;
  const instructionRows = instruction ? wrapText(instruction, lineWidth) : [];
  const contextBudget = rows - 4 - shortcutsRows - 1 - rangeRows - 1;
  const resourceRows = wrapText(resourceLabel, lineWidth);
  const context = [
    ...(resourceRows.length + instructionRows.length <= contextBudget
      ? resourceRows : [fitText(resourceLabel, lineWidth)]),
    ...instructionRows,
  ];
  // Reserve both frames, their gap, and header metadata before sizing the revision viewport.
  const headerRows = context.length + rangeRows;
  const availableRows = rows - 4 - shortcutsRows - 1 - headerRows;
  const gap = availableRows > 1 ? [""] : [];
  const count = Math.max(1, Math.min(14, versions.length, availableRows - gap.length));
  const first = Math.max(0, Math.min(selectedIndex - Math.floor(count / 2), versions.length - count));
  const visible = versions.slice(first, first + count);
  const prefixContentWidth = Math.max(9, ...visible.map(({ prefix }) => prefix.length + 2));
  const subjectContentWidth = Math.max(8, ...visible.map(({ subject }) => subject.length));
  const minimumColumnWidth = Math.max(1, Math.floor((lineWidth - 4) / 3));
  const [prefixWidth, dateWidth, subjectWidth] = adaptiveColumnWidths(lineWidth, [
    { contentWidth: prefixContentWidth, minWidth: Math.min(9, minimumColumnWidth), maxWidth: prefixContentWidth + 6, growWeight: 1 },
    { contentWidth: 10, minWidth: Math.min(8, minimumColumnWidth), maxWidth: 10, shrinkWeight: 1 },
    { contentWidth: subjectContentWidth, minWidth: Math.min(8, minimumColumnWidth), growWeight: 2, shrinkWeight: 3 },
  ], 2);
  return modalFrame("RESOURCE REVISIONS", [
    ...gap,
    ...visible.map((version, offset) => ({
      text: [
        fitColumn(`${first + offset === selectedIndex ? "›" : " "} ${version.prefix}`, prefixWidth),
        fitColumn(version.date.slice(0, 10), dateWidth),
        fitText(version.subject, subjectWidth),
      ].join("  "),
      color: first + offset === selectedIndex ? semantic.selected : undefined,
      preserveSpacing: true,
      bold: first + offset === selectedIndex,
    })),
    shortcutHint,
  ], columns, semantic.selected, width, [
    ...context,
    ...(!compactContext && versions.length > count
      ? [`Showing ${first + 1}-${first + count} of ${versions.length} commits.`]
      : []),
  ]);
}





export function inventoryMigrationModal({ scopes, columns }: { scopes: string[]; columns: number }) {
  const affectedScopes = [...new Set(scopes.filter((scope) => ["project", "user"].includes(scope)))];
  const scopeLabel = affectedScopes.length === 2
    ? "project and user inventories"
    : `${affectedScopes[0]} inventory`;
  return modalFrame("INVENTORY MIGRATION REQUIRED", [
    { text: `Migration is required for the ${scopeLabel}.`, color: semantic.accents.warning, bold: true },
    ...affectedScopes.map((scope) => ({
      text: `${scope.toUpperCase()} inventory needs migration.`,
      color: scope === "user" ? semantic.selected : MODAL_FOREGROUND,
      bold: true,
    })),
    "",
    "Run this from the current project directory:",
    {
      text: "npx --yes @grasdouble/kitia migrate --apply",
      color: semantic.selected,
      bold: true,
    },
    "It checks project and home inventories, skipping ones already current.",
    "Restart the dashboard after migration.",
    "",
    { text: "[ EXIT DASHBOARD ]", color: semantic.selected, bold: true },
    "ENTER / ESC TO EXIT",
  ], columns, semantic.accents.warning, 96);
}
export function addCatalogModal({
  step,
  intent = "add",
  entryIndex = 0,
  name,
  repository,
  mode,
  kind,
  path,
  entries,
  message,
  columns,
}: {
  step: string;
  intent?: "add" | "edit";
  entryIndex?: number;
  name: string;
  repository: string;
  mode: "basic" | "custom";
  kind: "skill" | "agent" | "instruction";
  path: string;
  entries: Array<{ kind: string; id?: string; path: string }>;
  message: string;
  columns: number;
}) {
  const field = (label: string, value: string) => ({
    text: `${label}: ${value || "…"}▏`,
    color: semantic.selected,
    bold: true,
  });
  const content = step === "name"
    ? [field("Catalog name", name), ...(message ? [{ text: message, color: semantic.accents.warning }] : []), "", "ENTER CONTINUES · ESC CANCEL"]
    : step === "repository"
      ? [field("HTTPS GitHub URL", repository), ...(message ? [{ text: message, color: semantic.accents.warning }] : []), "", "ENTER CONTINUES · ESC CANCEL"]
      : step === "mode"
        ? [
          choiceGroup("Choose catalog setup:", ["BASIC", "CUSTOM"], mode === "basic" ? 0 : 1),
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
              ? "Enter a skill folder with SKILL.md or a parent folder containing multiple skills."
              : "Enter a Markdown file or a folder containing multiple artifacts of this kind.",
            ...(message ? [{ text: message, color: semantic.accents.warning }] : []),
            "ENTER ADDS ENTRY · ESC CANCEL",
          ]
              : step === "entries"
                ? [
                  `Entries configured: ${entries.length}`,
                  ...entries.map((entry, index) =>
                    selectableOption(`${entry.kind} ← ${entry.path}`, index === entryIndex)),
                  ...(message ? [{ text: message, color: semantic.accents.warning }] : []),
                  "", "[ A ] ADD ENTRY · [ DELETE ] REMOVE SELECTED · [ ENTER ] SAVE · [ ESC ] CANCEL",
                ]
                : [
                  message,
                  "", "ENTER / ESC CLOSE",
                ];
  return modalFrame(
    step === "result"
      ? `${intent === "edit" ? "EDIT" : "ADD"} CATALOG RESULT`
      : `${intent === "edit" ? "EDIT" : "ADD"} CATALOG`,
    content,
    columns,
    step === "result" && /Catalog (?:added|updated):/.test(message) ? semantic.accents.success : semantic.selected,
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
        selectableOption(`${name} (${repository})`, index === state.index)),
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
    state.failed ? semantic.accents.error : state.step === "result" ? semantic.accents.success : semantic.accents.warning,
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
      choiceGroup("", ["ONE CATALOG", "ALL CATALOGS"], state.scope === "one" ? 0 : 1),
      "Refresh updates the local index; installed artifacts stay unchanged.",
      "",
      "← → CHOOSE · ENTER CONTINUE · ESC CANCEL",
    ]
    : state.step === "select"
      ? [
        "Choose a user catalog to refresh:",
        ...catalogs.map(({ name, repository }, index) =>
          selectableOption(`${name} (${repository})`, index === state.index)),
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
    state.failed ? semantic.accents.error : state.step === "result" ? semantic.accents.success : semantic.accents.warning,
    80,
  );
}
export function catalogTransferModal({ action, step, content, message, summary, choices, selectedIndex = 0, working, columns }: {
  action: "import" | "export";
  step: "paste" | "select" | "result";
  content: string;
  message: string;
  summary?: {
    added: string[];
    ignored: Array<{ name: string; reason: string }>;
    refreshed: Array<{ name: string; count: number }>;
    refreshFailures: Array<{ name: string; message: string }>;
  };
  choices?: Array<{ name: string; repository: string; existing: boolean; selected: boolean }>;
  selectedIndex?: number;
  working: boolean;
  columns: number;
}) {
  const contentLines = content.split("\n");
  const visibleLines = contentLines.slice(-6);
  const choiceList = choices || [];
  const choiceStart = Math.max(0, Math.min(selectedIndex - 3, choiceList.length - 8));
  const visibleChoices = choiceList.slice(choiceStart, choiceStart + 8);
  const importLines = step === "result" && summary
    ? [
      `Added (${summary.added.length}): ${summary.added.join(", ") || "none"}`,
      `Ignored (${summary.ignored.length}):`,
      ...summary.ignored.map(({ name, reason }) => `${name}: ${reason}`),
      `Refreshed (${summary.refreshed.length}): ${summary.refreshed.map(({ name, count }) => `${name} · ${count}`).join(", ") || "none"}`,
      `Refresh failed (${summary.refreshFailures.length}):`,
      ...summary.refreshFailures.map(({ name, message }) => `${name}: ${message}`),
    ]
    : step === "select"
      ? [
        "Choose which catalogs to import:",
        ...(choiceStart > 0 ? ["…"] : []),
        ...visibleChoices.map((choice, offset) =>
          selectableOption(`${choice.selected ? "[x]" : "[ ]"} ${choice.name} · ${choice.repository}${choice.existing ? " · already configured" : ""}`,
            choiceStart + offset === selectedIndex)),
        ...(choiceStart + visibleChoices.length < choiceList.length ? ["…"] : []),
      ]
      : [
        "Paste the JSON catalog configuration below:",
        ...visibleLines.map((line) => `│ ${line}`),
        ...(contentLines.length > visibleLines.length ? ["…"] : []),
      ];
  return modalFrame(action === "import" ? "IMPORT CATALOGS" : "EXPORT CATALOGS", [
    ...(action === "import" ? importLines : ["Copy the current catalog configuration to the clipboard?"]),
    ...(message ? [{ text: message, color: semantic.accents.warning }] : []),
    "",
    working ? "PLEASE WAIT"
      : action === "import" && step === "paste" ? "CTRL+S REVIEW · ENTER NEW LINE · ESC CANCEL"
        : action === "import" && step === "select" ? "SPACE/ENTER TOGGLE · CTRL+S IMPORT · ESC BACK"
          : action === "import" ? "ENTER CLOSE · ESC CLOSE"
            : "ENTER COPY TO CLIPBOARD · ESC CANCEL",
  ], columns, semantic.selected, 80);
}
export function catalogPresetModal({ presets, index, columns }: {
  presets: readonly { name: string; repository: string }[];
  index: number;
  columns: number;
}) {
  return modalFrame("ADD CATALOG PRESET", [
    "Choose a catalog preset:",
    ...presets.map(({ name, repository }, presetIndex) =>
      selectableOption(`${name} · ${repository}`, presetIndex === index)),
    "",
    "↑↓ SELECT · ENTER ADD · ESC CANCEL",
  ], columns, semantic.selected, 88);
}

export function onboardingModal(step: number) {
  const tour = [
    {
      title: "1/3 · INVENTORY",
      description: "Your installed resources live here. The highlighted list shows status, scope, kind, and catalog; move the selection to inspect an item.",
      shortcut: "↑ / ↓ move · F filter · C catalog · K kind · D details",
    },
    {
      title: "2/3 · CATALOG",
      description: "Browse resources available to install. Select a resource with Enter to choose its scope and runtime before installing.",
      shortcut: "A from inventory · F filter · C catalog · K kind · Enter select",
    },
    {
      title: "3/3 · CATALOG MANAGEMENT",
      description: "Manage the GitHub catalogs that supply resources. Refreshing updates the catalog index; it does not change installed resources.",
      shortcut: "M from inventory · A add · E edit · R refresh · Delete remove",
    },
  ][step];
  return modalFrame(tour.title, [
    tour.description,
    "",
    tour.shortcut,
    "",
    step < 2 ? "ENTER / SPACE / → NEXT · ← BACK · ESC FINISH" : "ENTER / SPACE / ← BACK · ESC FINISH",
  ], 76, semantic.accents.warning, 76);
}

export function versionAvailableModal(
  installedVersion: string,
  availableVersion: string,
  changelogUrl: string,
  columns: number,
) {
  return modalFrame("NEW VERSION AVAILABLE", [
    "A newer version of Kitia is available.",
    "",
    `Installed: ${installedVersion}`,
    `Available: ${availableVersion}`,
    "",
    "Changelog for this version:",
    changelogUrl,
    "",
    "ENTER / ESC CLOSE",
  ], columns, semantic.accents.success, 76);
}

function fixedModalText(text, props) {
  return h(Box, { flexShrink: 0 }, h(Text, props, text));
}

function ChoiceGroup({ line }) {
  const props = { backgroundColor: MODAL_BACKGROUND, color: line.borderColor };
  const contentWidth = Math.max(0, line.text.length - 3);
  const contentLength = line.label.length + line.options.reduce((length, option, index) =>
    length + (index ? 1 : 0) + choiceLabel(option.label, index === line.selectedIndex).length, 0);
  const padding = Math.max(0, contentWidth - contentLength);
  return h(Box, { width: line.text.length, flexDirection: "row" },
    fixedModalText("│ ", props),
    fixedModalText(line.label, props),
    ...line.options.map((option, index) => fixedModalText(
      `${index ? " " : ""}${choiceLabel(option.label, index === line.selectedIndex)}`,
      {
        backgroundColor: MODAL_BACKGROUND,
        color: index === line.selectedIndex
          ? option.color || line.color || semantic.selected
          : MODAL_FOREGROUND,
        bold: index === line.selectedIndex || line.focused,
        dimColor: index !== line.selectedIndex && !line.focused,
      },
    )),
    fixedModalText(
      " ".repeat(padding),
      { backgroundColor: MODAL_BACKGROUND, color: MODAL_BACKGROUND },
    ),
    fixedModalText("│", props));
}

function SelectableOption({ line }) {
  return h(Box, { width: line.text.length, flexDirection: "row" },
    fixedModalText("│ ", { backgroundColor: MODAL_BACKGROUND, color: line.borderColor }),
    fixedModalText(line.selected ? "› " : "  ", {
      backgroundColor: MODAL_BACKGROUND,
      color: line.selected ? semantic.selected : MODAL_FOREGROUND,
      bold: line.selected,
    }),
    fixedModalText(fitColumn(line.label, line.bodyText.length - 2), {
      backgroundColor: MODAL_BACKGROUND,
      color: line.selected ? semantic.selected : MODAL_FOREGROUND,
      bold: line.selected,
    }),
    fixedModalText(
      " ".repeat(Math.max(0, line.text.length - 3 - line.bodyText.length)),
      { backgroundColor: MODAL_BACKGROUND, color: MODAL_BACKGROUND },
    ),
    fixedModalText("│", { backgroundColor: MODAL_BACKGROUND, color: line.borderColor }));
}

function ModalLine({ line }) {
  const commonProps = {
    color: line.color || MODAL_FOREGROUND,
    backgroundColor: MODAL_BACKGROUND,
    bold: line.bold,
    dimColor: line.dimColor,
  };
  if (line.component === "choice-group") {
    return h(ChoiceGroup, { line });
  }
  if (line.component === "selectable-option") {
    return h(SelectableOption, { line });
  }
  if (line.text?.startsWith("│") && line.text.endsWith("│")) {
    return h(Text, { backgroundColor: MODAL_BACKGROUND },
      h(Text, { color: line.borderColor }, "│"),
      h(Text, commonProps, line.text.slice(1, -1)),
      h(Text, { color: line.borderColor }, "│"));
  }
  return h(Text, commonProps, line.text || " ");
}

export function ModalOverlay({ modal, columns, rows }: {
  modal: ReturnType<typeof modalFrame>;
  columns: number;
  rows: number;
}) {
  const shortcutsRows = modal.shortcuts.length
    ? wrappedShortcutLines(modal.shortcuts, modal.width).length + 4
    : 0;
  const modalHeight = modal.lines.length + modal.headerLines.length + (modal.panelTitle ? 4 : 0) +
    (shortcutsRows ? shortcutsRows + 1 : 0);
  const top = Math.max(0, Math.floor((rows - modalHeight) / 2));
  const left = Math.max(0, Math.floor((columns - modal.width) / 2));
  return h(Box, {
    position: "absolute",
    top,
    left,
    width: modal.width,
    flexDirection: "column",
  },
  modal.panelTitle
    ? h(Panel, {
      title: modal.panelTitle,
      width: modal.width,
      color: modal.accent,
      backgroundColor: MODAL_BACKGROUND,
      separateHeader: true,
      headerContent: modal.headerLines.map((line, index) => h(ModalLine, { key: `modal-header-${index}`, line })),
    }, ...modal.lines.map((line, index) => h(ModalLine, { key: `modal-line-${index}`, line })))
    : modal.lines.map((line, index) => h(ModalLine, { key: `modal-line-${index}`, line })),
  ...(modal.shortcuts.length
    ? [
      h(Text, { key: "modal-shortcuts-gap", backgroundColor: MODAL_BACKGROUND }, " ".repeat(modal.width)),
      h(ShortcutsPanel, {
        key: "modal-shortcuts",
        lines: modal.shortcuts,
        width: modal.width,
        color: modal.accent,
        backgroundColor: MODAL_BACKGROUND,
      }),
    ]
    : []));
}
