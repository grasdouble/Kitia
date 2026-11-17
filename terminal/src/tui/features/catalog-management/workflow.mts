import { useRef, useState } from "react";
import type { Key } from "ink";
import { CATALOG_PRESETS } from "../../../core/catalogs/presets.js";
import type { DashboardActions, CatalogMutationResult } from "../../contracts.js";
import type { CatalogEntry } from "../../../core/catalogs/model.js";
import { updateCatalogFreshness, type CatalogFreshnessStatus } from "../../catalog-freshness.mjs";
import { cycleIndex, mergeRefreshedCatalogResources } from "../../helpers.mjs";
import { yieldToRenderer, type DashboardActivity } from "../activity.mjs";
import { addCatalogModal, removeCatalogModal, refreshCatalogModal, catalogPresetModal, catalogTransferModal } from "./modals.mjs";

type CatalogRemovalState = {
  step: "select" | "confirm" | "working" | "result";
  index: number;
  name: string;
  message: string;
  failed: boolean;
};
type CatalogRefreshState = {
  step: "scope" | "select" | "working" | "result" | "errors";
  scope: "one" | "all";
  index: number;
  name: string;
  message: string;
  details?: string[];
  failed: boolean;
};
type CatalogTransferState = {
  action: "import" | "export";
  step: "paste" | "select" | "result";
  content: string;
  message: string;
  working: boolean;
  summary?: {
    added: string[];
    ignored: Array<{ name: string; reason: string }>;
    refreshed: Array<{ name: string; count: number }>;
    refreshFailures: Array<{ name: string; message: string }>;
  };
  sources?: Array<Record<string, unknown>>;
  choices?: Array<{ name: string; repository: string; existing: boolean; selected: boolean }>;
  selectedIndex?: number;
};
type CatalogPresetState = { index: number };

export function useCatalogManagement(actions: DashboardActions, activity: DashboardActivity) {
  const { setActionMessage, setActionPending, setLastActionFailed } = activity;
  const [catalogManagementIndex, setCatalogManagementIndex] = useState(0);
  const [catalogCandidates, setCatalogCandidates] = useState(() => actions.catalogResources || []);
  const [userCatalogs, setUserCatalogs] = useState(() => actions.userCatalogs || []);
  const [catalogFreshness, setCatalogFreshness] = useState<Record<string, CatalogFreshnessStatus>>({});
  const freshnessRequest = useRef(new Map<string, number>());
  const [catalogRemoval, setCatalogRemoval] = useState<CatalogRemovalState | null>(null);
  const [catalogRefresh, setCatalogRefresh] = useState<CatalogRefreshState | null>(null);
  const [catalogTransfer, setCatalogTransfer] = useState<CatalogTransferState | null>(null);
  const [catalogPreset, setCatalogPreset] = useState<CatalogPresetState | null>(null);
  const [catalogWizard, setCatalogWizard] = useState<null | {
    step: string;
    intent: "add" | "edit";
    originalName: string | null;
    name: string;
    repository: string;
    mode: "basic" | "custom";
    kind: "skill" | "agent" | "instruction";
    path: string;
    entries: CatalogEntry[];
    entryIndex: number;
    message: string;
  }>(null);
  const checkCatalogFreshness = (
    catalogs = userCatalogs,
    names = catalogs.map(({ name }) => name),
  ) => updateCatalogFreshness(
    catalogs, names, freshnessRequest.current, setCatalogFreshness, actions.checkCatalogFreshness,
  );

  const submitCatalog = async (wizard: NonNullable<typeof catalogWizard>) => {
    setCatalogWizard({ ...wizard, step: "submitting", message: "" });
    setActionMessage(`${wizard.intent === "edit" ? "Updating" : "Adding"} catalog ${wizard.name.trim()}...`);
    setActionPending(true);
    await yieldToRenderer();
    try {
      const request = {
        name: wizard.name.trim(),
        repository: wizard.repository.trim(),
        mode: wizard.mode,
        entries: wizard.mode === "custom" ? wizard.entries : [],
      };
      let result: CatalogMutationResult;
      if (wizard.intent === "edit") {
        if (!actions.updateCatalog || !wizard.originalName) {
          throw new Error("Dashboard catalog update handler is unavailable.");
        }
        result = await actions.updateCatalog(wizard.originalName, request);
      } else {
        if (!actions.addCatalog) throw new Error("Dashboard catalog handler is unavailable.");
        result = await actions.addCatalog(request);
      }
      if (Array.isArray(result.resources)) setCatalogCandidates([...result.resources]);
      const updatedCatalogs = Array.isArray(result.catalogs) ? [...result.catalogs] : userCatalogs;
      if (Array.isArray(result.catalogs)) setUserCatalogs(updatedCatalogs);
      void checkCatalogFreshness(updatedCatalogs);
      setLastActionFailed(false);
      const action = wizard.intent === "edit" ? "updated" : "added";
      setCatalogWizard({
        ...wizard,
        step: "result",
        message: `Catalog ${action}: ${result.catalog} · ${result.count} resource${result.count === 1 ? "" : "s"} indexed.`,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setLastActionFailed(true);
      const action = wizard.intent === "edit" ? "update" : "add";
      setCatalogWizard({ ...wizard, step: "result", message: `Catalog ${action} failed: ${detail}` });
    } finally {
      setActionPending(false);
    }
  };

  const runCatalogRemoval = async (name: string) => {
    setCatalogRemoval({ step: "working", index: 0, name, message: `Removing catalog ${name}...`, failed: false });
    setActionMessage(`Removing catalog ${name}...`);
    setActionPending(true);
    await yieldToRenderer();
    try {
      if (!actions.removeCatalog) throw new Error("Dashboard catalog removal handler is unavailable.");
      const result = await actions.removeCatalog(name);
      const updatedCatalogs = Array.isArray(result.catalogs)
        ? [...result.catalogs]
        : userCatalogs.filter((catalog) => catalog.name !== name);
      if (Array.isArray(result.catalogs)) setUserCatalogs(updatedCatalogs);
      if (Array.isArray(result.resources)) setCatalogCandidates([...result.resources]);
      void checkCatalogFreshness(updatedCatalogs);
      setCatalogRemoval({
        step: "result", index: 0, name,
        message: `Removed catalog ${name}. Installed artifacts were not removed.`,
        failed: false,
      });
      setLastActionFailed(false);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setCatalogRemoval({ step: "result", index: 0, name, message: `Catalog removal failed: ${detail}`, failed: true });
      setLastActionFailed(true);
    } finally {
      setActionPending(false);
    }
  };
  const runCatalogRefresh = async (name?: string) => {
    const target = name || "all catalogs";
    setCatalogRefresh({
      step: "working", scope: name ? "one" : "all", index: 0, name: target,
      message: `Refreshing ${target}...`, failed: false,
    });
    setActionMessage(`Refreshing ${target}...`);
    setActionPending(true);
    await yieldToRenderer();
    try {
      if (!actions.refreshCatalog) throw new Error("Dashboard catalog refresh handler is unavailable.");
      const result = await actions.refreshCatalog(name);
      const updatedCatalogs = Array.isArray(result.catalogs) ? [...result.catalogs] : userCatalogs;
      if (Array.isArray(result.catalogs)) setUserCatalogs(updatedCatalogs);
      const incomingResources = result.resources;
      if (Array.isArray(incomingResources)) {
        const refreshedCatalogs = result.refreshed?.map(({ name: catalogName }) => catalogName) || [];
        setCatalogCandidates((current) =>
          mergeRefreshedCatalogResources(current, incomingResources, refreshedCatalogs));
      }
      void checkCatalogFreshness(updatedCatalogs, name ? [name] : undefined);
      const count = result.refreshed?.reduce((total, catalog) => total + catalog.count, 0) || 0;
      const refreshed = result.refreshed?.length || 0;
      const failed = Boolean(result.failures?.length);
      const summary = name
        ? refreshed
          ? `Refreshed ${name} · ${count} resource${count === 1 ? "" : "s"} indexed.`
          : `Catalog ${name} was not refreshed.`
        : refreshed
          ? `Refreshed ${refreshed} catalog${refreshed === 1 ? "" : "s"} · ${count} resource${count === 1 ? "" : "s"} indexed.`
          : "No catalogs were refreshed.";
      const failureDetails = result.failures
        ?.map(({ name: failedName, message }) => `${failedName}: ${message}`);
      setCatalogRefresh({
        step: "result", scope: name ? "one" : "all", index: 0, name: target,
        message: failureDetails?.length
          ? `${summary} Failed: ${failureDetails.length} catalog${failureDetails.length === 1 ? "" : "s"}.`
          : summary,
        details: failureDetails,
        failed,
      });
      setLastActionFailed(failed);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setCatalogRefresh({
        step: "result", scope: name ? "one" : "all", index: 0, name: target,
        message: "Catalog refresh failed.",
        details: [`${target}: ${detail}`],
        failed: true,
      });
      setLastActionFailed(true);
    } finally {
      setActionPending(false);
    }
  };

  const activateAction = (action: string) => {
    if (action === "add-catalog" && actions.addCatalog) {
      setCatalogWizard({ step: "name", intent: "add", originalName: null, name: "", repository: "", mode: "basic", kind: "skill", path: "", entries: [], entryIndex: 0, message: "" });
    } else if (action === "presets" && actions.addCatalog) {
      setCatalogPreset({ index: 0 });
    } else if (action === "edit-catalog" && actions.updateCatalog && userCatalogs.length) {
      const selected = userCatalogs[Math.min(catalogManagementIndex, userCatalogs.length - 1)];
      setCatalogWizard({ step: "name", intent: "edit", originalName: selected.name, name: selected.name, repository: selected.repository, mode: selected.mode || "basic", kind: selected.entries?.[0]?.kind || "skill", path: "", entries: selected.mode === "custom" ? [...(selected.entries || [])] : [], entryIndex: 0, message: "" });
    } else if (action === "refresh-catalog" && actions.refreshCatalog && userCatalogs.length) {
      const index = Math.min(catalogManagementIndex, userCatalogs.length - 1);
      setCatalogRefresh({ step: "scope", scope: "one", index, name: "", message: "", failed: false });
    } else if (action === "remove-catalog" && actions.removeCatalog && userCatalogs.length) {
      const index = Math.min(catalogManagementIndex, userCatalogs.length - 1);
      setCatalogRemoval({ step: "select", index, name: userCatalogs[index].name, message: "", failed: false });
    } else if (action === "import-catalogs" && actions.transferCatalogs) {
      setCatalogTransfer({ action: "import", step: "paste", content: "", message: "", working: false });
    } else if (action === "export-catalogs" && actions.transferCatalogs) {
      setCatalogTransfer({ action: "export", step: "paste", content: "", message: "", working: false });
    }
  };
  const handleInput = (input: string, key: Key) => {
    const character = input.toLocaleLowerCase();
    if (catalogWizard) {
      if (catalogWizard.step === "submitting") return;
      if (catalogWizard.step === "result") {
        if (key.return || key.escape || input === " ") setCatalogWizard(null);
        return;
      }
      if (key.escape) {
        setCatalogWizard(null);
        return;
      }
      if (catalogWizard.step === "mode" && (key.leftArrow || key.rightArrow)) {
        setCatalogWizard({
          ...catalogWizard,
          mode: catalogWizard.mode === "basic" ? "custom" : "basic",
        });
        return;
      }
      if (catalogWizard.step === "kind" && (key.leftArrow || key.rightArrow)) {
        const kinds: CatalogEntry["kind"][] = ["skill", "agent", "instruction"];
        const index = kinds.indexOf(catalogWizard.kind);
        setCatalogWizard({
          ...catalogWizard,
          kind: kinds[(index + (key.rightArrow ? 1 : kinds.length - 1)) % kinds.length],
        });
        return;
      }
      if (catalogWizard.step === "entries") {
        if (character === "a") {
          setCatalogWizard({
            ...catalogWizard, step: "kind", kind: "skill", path: "", message: "",
          });
        } else if (catalogWizard.entries.length && key.upArrow) {
          setCatalogWizard({
            ...catalogWizard,
            entryIndex: cycleIndex(catalogWizard.entries.length, catalogWizard.entryIndex, -1),
          });
        } else if (catalogWizard.entries.length && key.downArrow) {
          setCatalogWizard({
            ...catalogWizard,
            entryIndex: cycleIndex(catalogWizard.entries.length, catalogWizard.entryIndex, 1),
          });
        } else if (key.delete && catalogWizard.entries.length) {
          const entries = catalogWizard.entries.filter((_, index) => index !== catalogWizard.entryIndex);
          setCatalogWizard({
            ...catalogWizard,
            entries,
            entryIndex: Math.min(catalogWizard.entryIndex, Math.max(0, entries.length - 1)),
            message: "",
          });
        } else if (key.return) {
          if (catalogWizard.mode === "basic" || catalogWizard.entries.length) {
            void submitCatalog(catalogWizard);
          } else {
            setCatalogWizard({
              ...catalogWizard,
              message: "Add at least one explicit entry before finishing a custom catalog.",
            });
          }
        }
        return;
      }
      if (key.return) {
        if (catalogWizard.step === "name") {
          if (catalogWizard.name.trim()) setCatalogWizard({ ...catalogWizard, step: "repository" });
        } else if (catalogWizard.step === "repository") {
          let url: URL | null = null;
          try { url = new URL(catalogWizard.repository.trim()); } catch {}
          if (url?.protocol === "https:" && url.hostname.toLowerCase() === "github.com" &&
              url.pathname.split("/").filter(Boolean).length >= 2) {
            setCatalogWizard({ ...catalogWizard, step: "mode" });
          } else {
            setCatalogWizard({ ...catalogWizard, message: "Enter an HTTPS GitHub repository URL." });
          }
        } else if (catalogWizard.step === "mode") {
          if (catalogWizard.mode === "basic") void submitCatalog(catalogWizard);
          else if (catalogWizard.intent === "edit") {
            setCatalogWizard({ ...catalogWizard, step: "entries" });
          } else {
            setCatalogWizard({ ...catalogWizard, step: "kind" });
          }
        } else if (catalogWizard.step === "kind") {
          setCatalogWizard({ ...catalogWizard, step: "path" });
        } else if (catalogWizard.step === "path") {
          const path = catalogWizard.path.trim().replace(/\/+$/, "");
          if (path && !path.startsWith("/") && !path.includes("\\") &&
              !path.split("/").some((segment) => segment === ".." || segment === "." || !segment)) {
            const entries = [...catalogWizard.entries, {
              kind: catalogWizard.kind, path,
            }];
            setCatalogWizard({
              ...catalogWizard,
              entries,
              entryIndex: entries.length - 1,
              step: "entries",
              path: "",
              message: "",
            });
          } else {
            setCatalogWizard({
              ...catalogWizard,
              message: "Enter a safe repository-relative directory or Markdown file path.",
            });
          }
        }
        return;
      }
      if (key.backspace || key.delete) {
        const keyName = catalogWizard.step === "name" ? "name"
          : catalogWizard.step === "repository" ? "repository"
          : catalogWizard.step === "path" ? "path" : null;
        if (keyName) setCatalogWizard({
          ...catalogWizard,
          [keyName]: Array.from(catalogWizard[keyName]).slice(0, -1).join(""),
          message: "",
        });
      } else if (input && !key.ctrl && !key.meta && input >= " ") {
        const keyName = catalogWizard.step === "name" ? "name"
          : catalogWizard.step === "repository" ? "repository"
          : catalogWizard.step === "path" ? "path" : null;
        if (keyName) setCatalogWizard({
          ...catalogWizard,
          [keyName]: catalogWizard[keyName] + input,
          message: "",
        });
      }
      return;
    }
    if (catalogRemoval) {
      if (catalogRemoval.step === "working") return;
      if (catalogRemoval.step === "result") {
        if (key.return || key.escape || input === " ") setCatalogRemoval(null);
      } else if (catalogRemoval.step === "select") {
        if (key.escape) setCatalogRemoval(null);
        else if (key.upArrow || key.downArrow) {
          const index = cycleIndex(userCatalogs.length, catalogRemoval.index, key.downArrow ? 1 : -1);
          setCatalogRemoval({ ...catalogRemoval, index, name: userCatalogs[index].name });
        } else if (key.return) setCatalogRemoval({ ...catalogRemoval, step: "confirm" });
      } else if (key.escape) setCatalogRemoval({ ...catalogRemoval, step: "select" });
      else if (character === "n") setCatalogRemoval({ ...catalogRemoval, step: "select" });
      else if (character === "y" || key.return) void runCatalogRemoval(catalogRemoval.name);
      return;
    }
    if (catalogRefresh) {
      if (catalogRefresh.step === "working") return;
      if (catalogRefresh.step === "result") {
        if (catalogRefresh.failed && character === "s") {
          setCatalogRefresh({ ...catalogRefresh, step: "errors" });
        } else if (key.return || key.escape || input === " ") setCatalogRefresh(null);
      } else if (catalogRefresh.step === "errors") {
        if (key.return || key.escape) setCatalogRefresh({ ...catalogRefresh, step: "result" });
      } else if (catalogRefresh.step === "scope") {
        if (key.escape) setCatalogRefresh(null);
        else if (key.leftArrow || key.rightArrow || key.upArrow || key.downArrow) {
          setCatalogRefresh({
            ...catalogRefresh, scope: catalogRefresh.scope === "one" ? "all" : "one",
          });
        } else if (key.return) {
          if (catalogRefresh.scope === "all") void runCatalogRefresh();
          else {
            const index = Math.min(catalogRefresh.index, userCatalogs.length - 1);
            setCatalogRefresh({
              ...catalogRefresh, step: "select", index, name: userCatalogs[index].name,
            });
          }
        }
      } else if (key.escape) {
        setCatalogRefresh({ ...catalogRefresh, step: "scope" });
      } else if (key.upArrow || key.downArrow) {
        const index = cycleIndex(userCatalogs.length, catalogRefresh.index, key.downArrow ? 1 : -1);
        setCatalogRefresh({ ...catalogRefresh, index, name: userCatalogs[index].name });
      } else if (key.return) {
        void runCatalogRefresh(catalogRefresh.name);
      }
      return;
    }
    if (catalogPreset) {
      if (key.escape) {
        setCatalogPreset(null);
      } else if (key.upArrow || key.downArrow) {
        setCatalogPreset({
          index: cycleIndex(CATALOG_PRESETS.length, catalogPreset.index, key.downArrow ? 1 : -1),
        });
      } else if (key.return) {
        const preset = CATALOG_PRESETS[catalogPreset.index];
        setCatalogPreset(null);
        void submitCatalog({
          step: "name",
          intent: "add",
          originalName: null,
          name: preset.catalogName,
          repository: preset.repository,
          mode: preset.mode,
          kind: preset.entries[0]?.kind || "skill",
          path: "",
          entries: preset.entries,
          entryIndex: 0,
          message: "",
        });
      }
      return;
    }
    if (catalogTransfer) {
      if (catalogTransfer.working) return;
      if (key.escape) {
        if (catalogTransfer.step === "select") {
          setCatalogTransfer({ ...catalogTransfer, step: "paste", message: "" });
        } else {
          setCatalogTransfer(null);
        }
      } else if (catalogTransfer.step === "result" && key.return) {
        setCatalogTransfer(null);
      } else if (catalogTransfer.action === "export" && key.return) {
        const current = { ...catalogTransfer, working: true };
        setCatalogTransfer(current);
        setActionPending(true);
        setActionMessage("Exporting catalog configuration...");
        void yieldToRenderer()
          .then(() => actions.transferCatalogs!("export", ""))
          .then((result) => {
            if (Array.isArray(result.catalogs)) setUserCatalogs([...result.catalogs]);
            setCatalogTransfer({ ...current, step: "result", working: false, message: "Configuration copied to clipboard." });
          }).catch((error) => {
            setCatalogTransfer({ ...current, step: "result", working: false, message: error instanceof Error ? error.message : String(error) });
          }).finally(() => setActionPending(false));
      } else if (catalogTransfer.action === "import" && catalogTransfer.step === "paste" && key.ctrl && character === "s") {
        try {
          const parsed = JSON.parse(catalogTransfer.content) as { catalog_version?: unknown; sources?: unknown };
          if (parsed.catalog_version !== 1 || !Array.isArray(parsed.sources)) {
            throw new Error("Configuration must include catalog_version 1 and a sources array.");
          }
          const sources = parsed.sources as Array<Record<string, unknown>>;
          const choices = sources.map((source, index) => {
            const record = source && typeof source === "object" && !Array.isArray(source) ? source : {};
            const name = typeof record.name === "string" ? record.name : `Entry ${index + 1}`;
            const repository = typeof record.repository === "string" ? record.repository : "";
            const normalizedRepository = repository.toLowerCase().replace(/\/+$/u, "").replace(/\.git$/u, "");
            const existing = userCatalogs.some((catalog) =>
              catalog.name.toLowerCase() === name.toLowerCase() ||
              catalog.repository.toLowerCase().replace(/\/+$/u, "").replace(/\.git$/u, "") === normalizedRepository);
            return { name, repository, existing, selected: !existing };
          });
          setCatalogTransfer({
            ...catalogTransfer,
            step: "select",
            message: "",
            sources,
            choices,
            selectedIndex: 0,
          });
        } catch (error) {
          setCatalogTransfer({
            ...catalogTransfer,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      } else if (catalogTransfer.action === "import" && catalogTransfer.step === "select" &&
          catalogTransfer.choices?.length && (key.upArrow || key.downArrow)) {
        setCatalogTransfer({
          ...catalogTransfer,
          selectedIndex: cycleIndex(catalogTransfer.choices.length, catalogTransfer.selectedIndex || 0, key.downArrow ? 1 : -1),
        });
      } else if (catalogTransfer.action === "import" && catalogTransfer.step === "select" &&
          (key.return || input === " ")) {
        const selectedIndex = catalogTransfer.selectedIndex || 0;
        const choices = [...(catalogTransfer.choices || [])];
        const choice = choices[selectedIndex];
        if (choice && !choice.existing) {
          choices[selectedIndex] = { ...choice, selected: !choice.selected };
          setCatalogTransfer({ ...catalogTransfer, choices });
        }
      } else if (catalogTransfer.action === "import" && catalogTransfer.step === "select" && key.ctrl && character === "s") {
        const selectedSources = (catalogTransfer.sources || []).filter((_, index) => catalogTransfer.choices?.[index]?.selected);
        const parsed = JSON.parse(catalogTransfer.content) as Record<string, unknown>;
        const content = JSON.stringify({ ...parsed, sources: selectedSources });
        const current = { ...catalogTransfer, step: "select" as const, working: true };
        setCatalogTransfer(current);
        setActionPending(true);
        setActionMessage("Importing catalog configuration...");
        void yieldToRenderer()
          .then(() => actions.transferCatalogs!("import", content))
          .then((result) => {
            if (Array.isArray(result.catalogs)) setUserCatalogs([...result.catalogs]);
            if (Array.isArray(result.resources)) setCatalogCandidates([...result.resources]);
            setCatalogTransfer({
              ...current,
              step: "result",
              working: false,
              message: `Imported ${result.importSummary?.added.length || 0}, ignored ${result.importSummary?.ignored.length || 0}, refreshed ${result.importSummary?.refreshed.length || 0}, refresh failed ${result.importSummary?.refreshFailures.length || 0}.`,
              summary: result.importSummary,
            });
            if (Array.isArray(result.catalogs)) void checkCatalogFreshness(result.catalogs);
          }).catch((error) => {
            setCatalogTransfer({ ...current, working: false, message: error instanceof Error ? error.message : String(error) });
          }).finally(() => setActionPending(false));
      } else if (catalogTransfer.action === "import" && catalogTransfer.step === "paste" && key.return) {
        setCatalogTransfer({ ...catalogTransfer, content: `${catalogTransfer.content}\n`, message: "" });
      } else if (catalogTransfer.action === "import" && catalogTransfer.step === "paste" && (key.backspace || key.delete)) {
        setCatalogTransfer({ ...catalogTransfer, content: catalogTransfer.content.slice(0, -1), message: "" });
      } else if (catalogTransfer.action === "import" && catalogTransfer.step === "paste" && input && !key.ctrl && !key.meta) {
        setCatalogTransfer({
          ...catalogTransfer,
          content: catalogTransfer.content + input.replace(/\r\n?/gu, "\n"),
          message: "",
        });
      }
      return;
    }
  };
  const active = Boolean(catalogWizard || catalogRemoval || catalogRefresh || catalogPreset || catalogTransfer);
  const modal = (columns: number) => {
    if (catalogWizard) return addCatalogModal({ ...catalogWizard, columns });
    if (catalogRemoval) return removeCatalogModal({ catalogs: userCatalogs, state: catalogRemoval, columns });
    if (catalogRefresh) return refreshCatalogModal({ catalogs: userCatalogs, state: catalogRefresh, columns });
    if (catalogPreset) return catalogPresetModal({ presets: CATALOG_PRESETS, index: catalogPreset.index, columns });
    if (catalogTransfer) return catalogTransferModal({ ...catalogTransfer, columns });
    return null;
  };
  const handleShortcut = (input: string, key: Key) => {
    const action = key.delete ? "remove-catalog" : ({ a: "add-catalog", p: "presets", e: "edit-catalog", r: "refresh-catalog", i: "import-catalogs", x: "export-catalogs" } as Record<string, string>)[input.toLocaleLowerCase()];
    if (!action) return false;
    activateAction(action);
    return true;
  };
  return {
    catalogCandidates, userCatalogs, catalogFreshness, catalogManagementIndex,
    setCatalogManagementIndex, checkCatalogFreshness, active, activateAction,
    handleInput, handleShortcut, modal,
  };
}
