import React, { useState } from "react";
import { render, useInput, useWindowSize } from "ink";
import type {
  CatalogResource, DashboardActionResult, PendingDashboardAction, ScanError,
} from "../types.js";
import { cycleFilter, cycleIndex, filterCatalogResources, filterInventory } from "./helpers.mjs";
import { CatalogScreen, InventoryScreen, ScreenFrame } from "./screens.mjs";
import {
  ModalOverlay, addCatalogModal, confirmationModal, inventoryMigrationModal,
  optionsModal, postInstallModal, removeCatalogModal, refreshCatalogModal,
} from "./modals.mjs";

type CatalogEntry = { kind: "skill" | "agent" | "instruction"; id: string; path: string };
type AddCatalogRequest = {
  name: string;
  repository: string;
  mode: "basic" | "custom";
  entries: CatalogEntry[];
};
type UserCatalog = { name: string; repository: string };
type CatalogActionResult = {
  catalogs?: UserCatalog[];
  resources?: CatalogResource[];
  refreshed?: Array<{ name: string; count: number }>;
  failures?: Array<{ name: string; message: string }>;
};
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

const h = React.createElement;
function catalogEntryId(kind: CatalogEntry["kind"], path: string) {
  const segments = path.split("/");
  if (kind === "skill") return segments[segments.length - 1] || "";
  const filename = segments[segments.length - 1] || "";
  return filename.replace(kind === "agent" ? /(?:\.agent)?\.md$/i : /(?:\.instructions)?\.md$/i, "");
}


export function Dashboard({
  resources,
  errors = [],
  actions = {},
  onFinish,
}: {
  resources: CatalogResource[];
  errors?: ScanError[];
  actions?: {
    catalogResources?: CatalogResource[];
    execute?: (
      operation: string,
      resource: CatalogResource,
      options: { scope?: string; tool?: string },
    ) => Promise<DashboardActionResult>;
    addCatalog?: (request: AddCatalogRequest) => Promise<{
      catalog: string;
      count: number;
      catalogs?: UserCatalog[];
      resources?: CatalogResource[];
    }>;
    userCatalogs?: UserCatalog[];
    removeCatalog?: (name: string) => Promise<CatalogActionResult>;
    refreshCatalog?: (name?: string) => Promise<CatalogActionResult>;
  };
  onFinish: (success: boolean) => void;
}) {
  const { columns = 80, rows = 24 } = useWindowSize();
  const [installedResources, setInstalledResources] = useState(() => [...resources]);
  const [scanErrors, setScanErrors] = useState(() => [...errors]);
  const [screenMode, setScreenMode] = useState("inventory");
  const [query, setQuery] = useState("");
  const [filterMode, setFilterMode] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogFilterMode, setCatalogFilterMode] = useState(false);
  const [catalogIndex, setCatalogIndex] = useState(0);
  const [catalogCandidates, setCatalogCandidates] = useState(() => actions.catalogResources || []);
  const [userCatalogs, setUserCatalogs] = useState(() => actions.userCatalogs || []);
  const [catalogRemoval, setCatalogRemoval] = useState<CatalogRemovalState | null>(null);
  const [catalogRefresh, setCatalogRefresh] = useState<CatalogRefreshState | null>(null);
  const [inventoryCatalogFilter, setInventoryCatalogFilter] = useState("all");
  const [inventoryKindFilter, setInventoryKindFilter] = useState("all");
  const [catalogSourceFilter, setCatalogSourceFilter] = useState("all");
  const [catalogKindFilter, setCatalogKindFilter] = useState("all");
  const [installResource, setInstallResource] = useState<CatalogResource | null>(null);
  const [installScope, setInstallScope] = useState("project");
  const [installTool, setInstallTool] = useState("copilot");
  const [installFocus, setInstallFocus] = useState(0);
  const [confirmation, setConfirmation] = useState<PendingDashboardAction | null>(null);
  const [confirmationChoice, setConfirmationChoice] = useState(0);
  const [confirmationStage, setConfirmationStage] = useState(1);
  const [postInstallEnvironment, setPostInstallEnvironment] = useState<string[] | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const [lastActionFailed, setLastActionFailed] = useState(false);
  const [catalogWizard, setCatalogWizard] = useState<null | {
    step: string;
    name: string;
    repository: string;
    mode: "basic" | "custom";
    kind: "skill" | "agent" | "instruction";
    id: string;
    path: string;
    entries: CatalogEntry[];
    message: string;
  }>(null);
  const migrationScopes = [...new Set(scanErrors
    .filter((error) => error.code === "INVENTORY_MIGRATION_REQUIRED")
    .map((error) => error.scope)
    .filter((scope) => ["project", "user"].includes(scope)))];

  const visibleInventory = filterInventory(
    installedResources, query, inventoryCatalogFilter, inventoryKindFilter,
  );
  const activeInventoryIndex = Math.min(selectedIndex, Math.max(0, visibleInventory.length - 1));
  const selectedResource = visibleInventory[activeInventoryIndex];
  const candidates = catalogCandidates;
  const visibleCatalog = filterCatalogResources(
    candidates, catalogQuery, catalogSourceFilter, catalogKindFilter,
  );
  const activeCatalogIndex = Math.min(catalogIndex, Math.max(0, visibleCatalog.length - 1));

  const submitCatalog = async (wizard: NonNullable<typeof catalogWizard>) => {
    setCatalogWizard({ ...wizard, step: "submitting", message: "" });
    setActionPending(true);
    try {
      if (!actions.addCatalog) throw new Error("Dashboard catalog handler is unavailable.");
      const result = await actions.addCatalog({
        name: wizard.name.trim(),
        repository: wizard.repository.trim(),
        mode: wizard.mode,
        entries: wizard.mode === "custom" ? wizard.entries : [],
      });
      if (Array.isArray(result.resources)) setCatalogCandidates([...result.resources]);
      if (Array.isArray(result.catalogs)) setUserCatalogs([...result.catalogs]);
      setLastActionFailed(false);
      setCatalogWizard({
        ...wizard,
        step: "result",
        message: `Catalog added: ${result.catalog} · ${result.count} resource${result.count === 1 ? "" : "s"} indexed.`,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setLastActionFailed(true);
      setCatalogWizard({ ...wizard, step: "result", message: `Catalog add failed: ${detail}` });
    } finally {
      setActionPending(false);
    }
  };

  const runCatalogRemoval = async (name: string) => {
    setCatalogRemoval({ step: "working", index: 0, name, message: `Removing catalog ${name}...`, failed: false });
    setActionPending(true);
    try {
      if (!actions.removeCatalog) throw new Error("Dashboard catalog removal handler is unavailable.");
      const result = await actions.removeCatalog(name);
      if (Array.isArray(result.catalogs)) setUserCatalogs([...result.catalogs]);
      if (Array.isArray(result.resources)) setCatalogCandidates([...result.resources]);
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
    setActionPending(true);
    try {
      if (!actions.refreshCatalog) throw new Error("Dashboard catalog refresh handler is unavailable.");
      const result = await actions.refreshCatalog(name);
      if (Array.isArray(result.catalogs)) setUserCatalogs([...result.catalogs]);
      if (Array.isArray(result.resources)) setCatalogCandidates([...result.resources]);
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

  const runConfirmedAction = async (requested: PendingDashboardAction) => {
    setActionPending(true);
    setLastActionFailed(false);
    const progressLabel = requested.action === "install" ? "Installing"
      : requested.action === "update" ? "Updating"
        : requested.action === "remove-unmanaged" ? "Removing" : "Uninstalling";
    const completedLabel = requested.action === "install" ? "Installed"
      : requested.action === "update" ? "Updated"
        : requested.action === "remove-unmanaged" ? "Removed" : "Uninstalled";
    setActionMessage(`${progressLabel} ${requested.resource.kind}:${requested.resource.id}...`);
    try {
      if (!actions.execute) throw new Error("Dashboard action handler is unavailable.");
      const result = await actions.execute(requested.action, requested.resource, {
        scope: requested.scope,
        tool: requested.tool,
      });
      if (Array.isArray(result.resources)) setInstalledResources([...result.resources]);
      if (Array.isArray(result.errors)) setScanErrors([...result.errors]);
      const outcome = result.messages?.filter(Boolean).join(" · ");
      const failed = result.code !== 0;
      setLastActionFailed(failed);
      setActionMessage(failed
        ? `Action failed${result.code ? ` (exit ${result.code})` : ""}${outcome ? `: ${outcome}` : "."}`
        : outcome || `${completedLabel} ${requested.resource.kind}:${requested.resource.id}.`);
      setPostInstallEnvironment(result.code === 0 && result.postInstallEnvironment?.length
        ? result.postInstallEnvironment
        : null);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setLastActionFailed(true);
      setActionMessage(`Action failed: ${error.message}`);
    } finally {
      setActionPending(false);
    }
  };

  useInput((input, key) => {
    const character = input.toLocaleLowerCase();
    if (migrationScopes.length) {
      if (key.return || key.escape || (key.ctrl && character === "c")) onFinish(false);
      return;
    }
    if (!catalogWizard && !catalogRemoval && !catalogRefresh && !actionPending && character === "n" &&
        screenMode === "inventory" && actions.addCatalog) {
      setCatalogWizard({
        step: "name",
        name: "",
        repository: "",
        mode: "basic",
        kind: "skill",
        id: "",
        path: "",
        entries: [],
        message: "",
      });
      return;
    }
    if (!catalogWizard && !catalogRemoval && !catalogRefresh && !actionPending &&
        character === "g" && screenMode === "inventory" && actions.refreshCatalog && userCatalogs.length) {
      setCatalogRefresh({
        step: "scope", scope: "one", index: 0, name: "", message: "", failed: false,
      });
      return;
    }
    if (!catalogWizard && !catalogRemoval && !catalogRefresh && !actionPending &&
        character === "r" && screenMode === "inventory" && actions.removeCatalog && userCatalogs.length) {
      setCatalogRemoval({ step: "select", index: 0, name: userCatalogs[0].name, message: "", failed: false });
      return;
    }
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
          setCatalogWizard({ ...catalogWizard, step: "kind", kind: "skill", id: "", path: "" });
        } else if (key.return) {
          if (catalogWizard.entries.length) void submitCatalog(catalogWizard);
          else setCatalogWizard({
            ...catalogWizard,
            message: "Add at least one explicit entry before finishing a custom catalog.",
          });
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
          else setCatalogWizard({ ...catalogWizard, step: "kind" });
        } else if (catalogWizard.step === "kind") {
          setCatalogWizard({ ...catalogWizard, step: "path" });
        } else if (catalogWizard.step === "path") {
          const path = catalogWizard.path.trim();
          const id = catalogEntryId(catalogWizard.kind, path);
          if (path && id && !path.startsWith("/") && !path.includes("\\") &&
              !path.split("/").some((segment) => segment === ".." || segment === ".")) {
            const entries = [...catalogWizard.entries, {
              kind: catalogWizard.kind, id, path,
            }];
            setCatalogWizard({ ...catalogWizard, entries, step: "entries", id: "", path: "" });
          } else {
            setCatalogWizard({ ...catalogWizard, message: "Enter a safe source path with a derivable ID." });
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
          else setCatalogRefresh({ ...catalogRefresh, step: "select", name: userCatalogs[0].name });
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
    if (postInstallEnvironment) {
      if (key.return || key.escape || input === " ") setPostInstallEnvironment(null);
      return;
    }
    if (confirmation) {
      if ((key.ctrl && character === "c") || key.escape || character === "n") {
        if (confirmation.action === "install") setScreenMode("install-options");
        setConfirmation(null);
        setConfirmationStage(1);
        setConfirmationChoice(0);
      } else if (key.leftArrow || key.rightArrow || key.upArrow || key.downArrow) {
        setConfirmationChoice(confirmationChoice === 0 ? 1 : 0);
      } else if (character === "y" || (key.return && confirmationChoice === 1)) {
        if (actionPending) return;
        if (confirmation.action === "remove-unmanaged" && confirmationStage === 1) {
          setConfirmationStage(2);
          setConfirmationChoice(0);
          return;
        }
        const requested = confirmation;
        setConfirmation(null);
        setConfirmationStage(1);
        setConfirmationChoice(0);
        if (requested.action === "install") setScreenMode("inventory");
        void runConfirmedAction(requested);
      } else if (key.return) {
        if (confirmation.action === "install") setScreenMode("install-options");
        setConfirmation(null);
        setConfirmationStage(1);
        setConfirmationChoice(0);
      }
      return;
    }
    if (actionPending) return;
    const activeFilter = screenMode === "catalog"
      ? catalogFilterMode
      : screenMode === "inventory" && filterMode;
    if ((key.ctrl && character === "c") || (character === "q" && !activeFilter)) {
      onFinish(!lastActionFailed);
      return;
    }

    if (screenMode === "catalog") {
      if (catalogFilterMode) {
        if (key.return) setCatalogFilterMode(false);
        else if (key.escape) {
          setCatalogFilterMode(false);
          setCatalogQuery("");
          setCatalogIndex(0);
        } else if (key.upArrow) setCatalogIndex(cycleIndex(visibleCatalog.length, activeCatalogIndex, -1));
        else if (key.downArrow) setCatalogIndex(cycleIndex(visibleCatalog.length, activeCatalogIndex, 1));
        else if (key.backspace || key.delete) {
          setCatalogQuery((value) => Array.from(value).slice(0, -1).join(""));
          setCatalogIndex(0);
        } else if (input && !key.ctrl && !key.meta && input >= " ") {
          setCatalogQuery((value) => value + input);
          setCatalogIndex(0);
        }
      } else if (key.escape) {
        setScreenMode("inventory");
      } else if (character === "f") {
        setCatalogFilterMode(true);
      } else if (character === "c") {
        setCatalogSourceFilter(cycleFilter(
          catalogSourceFilter, candidates, "catalog", "kind", catalogKindFilter,
        ));
        setCatalogIndex(0);
      } else if (character === "k") {
        setCatalogKindFilter(cycleFilter(
          catalogKindFilter, candidates, "kind", "catalog", catalogSourceFilter,
        ));
        setCatalogIndex(0);
      } else if (key.upArrow) setCatalogIndex(cycleIndex(visibleCatalog.length, activeCatalogIndex, -1));
      else if (key.downArrow) setCatalogIndex(cycleIndex(visibleCatalog.length, activeCatalogIndex, 1));
      else if (key.return && visibleCatalog[activeCatalogIndex]) {
        const resource = visibleCatalog[activeCatalogIndex];
        setInstallResource(resource);
        setInstallScope("project");
        setInstallTool("copilot");
        setInstallFocus(resource.kind === "instruction" ? 1 : 0);
        setScreenMode("install-options");
        setActionMessage("");
      }
      return;
    }

    if (screenMode === "install-options") {
      if (key.escape) setScreenMode("catalog");
      else if (key.tab) {
        setInstallFocus(installResource.kind === "instruction" ? 1 : installFocus === 0 ? 1 : 0);
      } else if ((key.upArrow || key.downArrow) && installResource.kind !== "instruction") {
        setInstallFocus(installFocus === 0 ? 1 : 0);
      } else if (key.leftArrow || key.rightArrow) {
        const scopeFocused = installFocus === 0 && installResource.kind !== "instruction";
        const choices = scopeFocused ? ["project", "user"] : ["copilot", "claude", "both"];
        const current = scopeFocused ? installScope : installTool;
        const offset = key.rightArrow ? 1 : -1;
        const index = cycleIndex(choices.length, choices.indexOf(current), offset);
        if (scopeFocused) setInstallScope(choices[index]);
        else setInstallTool(choices[index]);
      } else if (key.return) {
        const alreadyInstalled = installedResources.some((resource) =>
          resource.scope === installScope && resource.catalog === installResource.catalog &&
          resource.kind === installResource.kind && resource.id === installResource.id);
        const scopeError = scanErrors.find((error) => error.scope === installScope);
        if (!alreadyInstalled && !scopeError) {
          setConfirmation({
            action: "install",
            resource: { ...installResource, scope: installScope },
            scope: installScope,
            tool: installTool,
          });
          setConfirmationChoice(0);
        }
      }
      return;
    }

    if (filterMode) {
      if (key.return) setFilterMode(false);
      else if (key.escape) {
        setFilterMode(false);
        setQuery("");
        setSelectedIndex(0);
      } else if (key.upArrow) setSelectedIndex(cycleIndex(visibleInventory.length, activeInventoryIndex, -1));
      else if (key.downArrow) setSelectedIndex(cycleIndex(visibleInventory.length, activeInventoryIndex, 1));
      else if (key.backspace || key.delete) {
        setQuery((value) => Array.from(value).slice(0, -1).join(""));
        setSelectedIndex(0);
      } else if (input && !key.ctrl && !key.meta && input >= " ") {
        setQuery((value) => value + input);
        setSelectedIndex(0);
      }
      return;
    }
    if (key.escape) {
      onFinish(!lastActionFailed);
    } else if (key.upArrow) setSelectedIndex(cycleIndex(visibleInventory.length, activeInventoryIndex, -1));
    else if (key.downArrow) setSelectedIndex(cycleIndex(visibleInventory.length, activeInventoryIndex, 1));
    else if (character === "f") setFilterMode(true);
    else if (character === "c") {
      setInventoryCatalogFilter(cycleFilter(
        inventoryCatalogFilter, installedResources, "catalog", "kind", inventoryKindFilter,
      ));
      setSelectedIndex(0);
    } else if (character === "k") {
      setInventoryKindFilter(cycleFilter(
        inventoryKindFilter, installedResources, "kind", "catalog", inventoryCatalogFilter,
      ));
      setSelectedIndex(0);
    } else if (character === "a" && candidates.length) {
      setScreenMode("catalog");
      setCatalogQuery("");
      setCatalogIndex(0);
      setCatalogFilterMode(false);
      setActionMessage("");
    } else if (character === "u" && selectedResource && selectedResource.managed !== false &&
        typeof actions.execute === "function") {
      setConfirmation({ action: "update", resource: selectedResource });
      setConfirmationChoice(0);
      setActionMessage("");
    } else if ((key.delete || (key.backspace && !query)) &&
        selectedResource && typeof actions.execute === "function") {
      setConfirmation({
        action: selectedResource.managed === false ? "remove-unmanaged" : "uninstall",
        resource: selectedResource,
      });
      setConfirmationStage(1);
      setConfirmationChoice(0);
      setActionMessage("");
    } else if (key.backspace && query) {
      setFilterMode(true);
      setQuery((value) => Array.from(value).slice(0, -1).join(""));
      setSelectedIndex(0);
    }
  });

  let baseScreen;
  let modal = null;
  if (migrationScopes.length) {
    modal = inventoryMigrationModal({ scopes: migrationScopes, columns });
  } else if (catalogWizard) {
    modal = addCatalogModal({
      step: catalogWizard.step,
      name: catalogWizard.name,
      repository: catalogWizard.repository,
      mode: catalogWizard.mode,
      kind: catalogWizard.kind,
      id: catalogWizard.id,
      path: catalogWizard.path,
      entries: catalogWizard.entries,
      message: catalogWizard.message,
      columns,
    });
  } else if (catalogRemoval) {
    modal = removeCatalogModal({
      catalogs: userCatalogs,
      state: catalogRemoval,
      columns,
    });
  } else if (catalogRefresh) {
    modal = refreshCatalogModal({
      catalogs: userCatalogs,
      state: catalogRefresh,
      columns,
    });
  } else if (postInstallEnvironment) {
    modal = postInstallModal({ environment: postInstallEnvironment, columns });
  } else if (confirmation) {
    modal = confirmationModal({
      confirmation,
      selectedButton: confirmationChoice,
      stage: confirmationStage,
      columns,
    });
  } else if (screenMode === "install-options" && installResource) {
    modal = optionsModal({
      resource: installResource,
      scope: installScope,
      tool: installTool,
      focus: installFocus,
      resources: installedResources,
      errors: scanErrors,
      columns,
    });
  }
  if (screenMode === "catalog" || screenMode === "install-options") {
    baseScreen = h(CatalogScreen, {
      candidates,
      resources: installedResources,
      query: catalogQuery,
      filterMode: catalogFilterMode,
      catalogFilter: catalogSourceFilter,
      kindFilter: catalogKindFilter,
      selectedIndex: activeCatalogIndex,
      columns,
      rows,
    });
  } else {
    baseScreen = h(InventoryScreen, {
      resources: installedResources,
      errors: scanErrors,
      query,
      filterMode,
      catalogFilter: inventoryCatalogFilter,
      kindFilter: inventoryKindFilter,
      selectedIndex: activeInventoryIndex,
      actionMessage,
      catalogAvailable: candidates.length > 0,
      canRemoveCatalog: typeof actions.removeCatalog === "function" && userCatalogs.length > 0,
      canRefreshCatalog: typeof actions.refreshCatalog === "function" && userCatalogs.length > 0,
      canAddCatalog: typeof actions.addCatalog === "function",
      canExecute: typeof actions.execute === "function" && Boolean(selectedResource),
      columns,
      rows,
    });
  }
  const overlay = modal && h(ModalOverlay, { modal, columns, rows });
  return h(ScreenFrame, { columns, rows }, baseScreen, overlay);
}

export async function runDashboard(
  resources: CatalogResource[],
  input: NodeJS.ReadStream,
  output: NodeJS.WriteStream,
  errors: ScanError[] = [],
  actions: {
    catalogResources?: CatalogResource[];
    execute?: (
      operation: string,
      resource: CatalogResource,
      options: { scope?: string; tool?: string },
    ) => Promise<DashboardActionResult>;
    addCatalog?: (request: AddCatalogRequest) => Promise<{
      catalog: string;
      count: number;
      catalogs?: UserCatalog[];
      resources?: CatalogResource[];
    }>;
    userCatalogs?: UserCatalog[];
    removeCatalog?: (name: string) => Promise<CatalogActionResult>;
    refreshCatalog?: (name?: string) => Promise<CatalogActionResult>;
  } = {},
): Promise<boolean> {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") return false;

  return new Promise((resolve, reject) => {
    let app;
    let finished = false;
    const onFinish = (success) => {
      if (finished) return;
      finished = true;
      resolve(success);
      app.unmount();
    };
    app = render(h(Dashboard, { resources, errors, actions, onFinish }), {
      stdin: input,
      stdout: output,
      exitOnCtrlC: false,
      alternateScreen: true,
      interactive: true,
    });
    app.waitUntilExit().catch((error) => {
      if (!finished) reject(error);
    });
  });
}
