import { modalFrame, choiceGroup, selectableOption } from "../../modals.mjs";
import { DASHBOARD_THEME } from "../../colors.js";
const { semantic } = DASHBOARD_THEME;

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
