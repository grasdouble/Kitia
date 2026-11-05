import React, { useEffect, useRef, useState } from "react";
import { render, useInput, useWindowSize } from "ink";
import type { CatalogResource } from "../catalog/entries.js";
import type { ScanError } from "../catalog/lifecycle.js";
import {
  cycleFilter, cycleIndex, filterCatalogResources, filterInventory, inventoryCatalogLabels,
} from "./helpers.mjs";
import {
  CatalogManagementScreen, CatalogScreen, InventoryScreen, ScreenFrame,
  type CatalogFreshnessStatus,
} from "./screens.mjs";
import {
  ModalOverlay, addCatalogModal, confirmationModal, inventoryMigrationModal,
  onboardingModal, optionsModal, refreshCatalogModal, removeCatalogModal,
  versionAvailableModal,
  type PendingDashboardAction,
} from "./modals.mjs";

import type { DashboardActionResult } from "../cli/dashboard.js";
type CatalogEntry = { kind: "skill" | "agent" | "instruction"; id?: string; path: string };
type AddCatalogRequest = {
  name: string;
  repository: string;
  mode: "basic" | "custom";
  entries: CatalogEntry[];
};
type UserCatalog = {
  name: string;
  repository: string;
  mode?: "basic" | "custom";
  entries?: CatalogEntry[];
};
type CatalogFreshnessResult = { name: string; status: CatalogFreshnessStatus };
type CatalogActionResult = {
  catalogs?: UserCatalog[];
  resources?: CatalogResource[];
  refreshed?: Array<{ name: string; count: number }>;
  failures?: Array<{ name: string; message: string }>;
};
type CatalogMutationResult = {
  catalog: string;
  count: number;
  catalogs?: UserCatalog[];
  resources?: CatalogResource[];
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
    addCatalog?: (request: AddCatalogRequest) => Promise<CatalogMutationResult>;
    updateCatalog?: (originalName: string, request: AddCatalogRequest) => Promise<CatalogMutationResult>;
    userCatalogs?: UserCatalog[];
    removeCatalog?: (name: string) => Promise<CatalogActionResult>;
    refreshCatalog?: (name?: string) => Promise<CatalogActionResult>;
    checkCatalogFreshness?: () => Promise<CatalogFreshnessResult[]>;
    showOnboarding?: boolean;
  };
  onFinish: (success: boolean) => void;
}) {
  const { columns = 80, rows = 24 } = useWindowSize();
  const installedVersion = process.env.KITIA_INSTALLED_VERSION || "unknown";
  const [versionLabel, setVersionLabel] = useState("Checking version update");
  const [versionNotice, setVersionNotice] = useState<{
    installed: string;
    available: string;
    changelogUrl: string;
  } | null>(null);
  useEffect(() => {
    let active = true;
    const compare = (left: string, right: string) => {
      const a = left.split(".").map(Number);
      const b = right.split(".").map(Number);
      for (let index = 0; index < 3; index += 1) {
        if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
      }
      return 0;
    };
    void fetch("https://registry.npmjs.org/@grasdouble%2Fkitia/latest", {
      signal: AbortSignal.timeout(1500),
      headers: { accept: "application/json" },
    }).then(async (response) => {
      if (!response.ok) throw new Error("npm registry unavailable");
      const { version } = await response.json();
      if (installedVersion !== "unknown" && compare(version, installedVersion) > 0) {
        setVersionLabel(`${installedVersion} - New version available`);
        const heading = version.toLowerCase().replace(/[^a-z0-9-]/g, "");
        setVersionNotice({
          installed: installedVersion,
          available: version,
          changelogUrl: `https://github.com/grasdouble/Kitia/blob/main/CHANGELOG.md#${heading}`,
        });
      } else {
        setVersionLabel(installedVersion);
      }
    }).catch(() => {
      if (active) setVersionLabel(installedVersion);
    });
    return () => { active = false; };
  }, [installedVersion]);
  const [installedResources, setInstalledResources] = useState(() => [...resources]);
  const [scanErrors, setScanErrors] = useState(() => [...errors]);
  const [screenMode, setScreenMode] = useState("inventory");
  const [query, setQuery] = useState("");
  const [filterMode, setFilterMode] = useState(false);
  const [showDetails, setShowDetails] = useState(true);
  const [tourStep, setTourStep] = useState<number | null>(actions.showOnboarding ? 0 : null);
  const tourStepRef = useRef<number | null>(actions.showOnboarding ? 0 : null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogFilterMode, setCatalogFilterMode] = useState(false);
  const [catalogIndex, setCatalogIndex] = useState(0);
  const [catalogManagementIndex, setCatalogManagementIndex] = useState(0);
  const [catalogCandidates, setCatalogCandidates] = useState(() => actions.catalogResources || []);
  const [userCatalogs, setUserCatalogs] = useState(() => actions.userCatalogs || []);
  const [catalogFreshness, setCatalogFreshness] = useState<Record<string, CatalogFreshnessStatus>>({});
  const freshnessRequest = useRef(0);
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
  const [actionMessage, setActionMessage] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const [lastActionFailed, setLastActionFailed] = useState(false);
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
  const migrationScopes = [...new Set(scanErrors
    .filter((error) => error.code === "INVENTORY_MIGRATION_REQUIRED")
    .map((error) => error.scope)
    .filter((scope) => ["project", "user"].includes(scope)))];

  const checkCatalogFreshness = async (catalogs = userCatalogs) => {
    const request = ++freshnessRequest.current;
    const checking = Object.fromEntries(catalogs.map(({ name }) => [name, "checking" as const]));
    setCatalogFreshness(checking);
    if (!actions.checkCatalogFreshness) {
      setCatalogFreshness(Object.fromEntries(catalogs.map(({ name }) => [name, "unknown" as const])));
      return;
    }
    try {
      const results = await actions.checkCatalogFreshness();
      if (request !== freshnessRequest.current) return;
      const statusByName = new Map(results.map(({ name, status }) => [name, status]));
      setCatalogFreshness(Object.fromEntries(catalogs.map(({ name }) =>
        [name, statusByName.get(name) || "unknown"])));
    } catch {
      if (request === freshnessRequest.current) {
        setCatalogFreshness(Object.fromEntries(catalogs.map(({ name }) =>
          [name, "unknown" as const])));
      }
    }
  };

  const inventoryLabels = inventoryCatalogLabels(installedResources, userCatalogs);
  const visibleInventory = filterInventory(
    installedResources, query, inventoryCatalogFilter, inventoryKindFilter, userCatalogs, inventoryLabels,
  );
  const activeInventoryIndex = Math.min(selectedIndex, Math.max(0, visibleInventory.length - 1));
  const selectedResource = visibleInventory[activeInventoryIndex];
  const candidates = catalogCandidates;
  const visibleCatalog = filterCatalogResources(
    candidates, catalogQuery, catalogSourceFilter, catalogKindFilter, userCatalogs,
  );
  const activeCatalogIndex = Math.min(catalogIndex, Math.max(0, visibleCatalog.length - 1));

  const submitCatalog = async (wizard: NonNullable<typeof catalogWizard>) => {
    setCatalogWizard({ ...wizard, step: "submitting", message: "" });
    setActionPending(true);
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
    setActionPending(true);
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
    setActionPending(true);
    try {
      if (!actions.refreshCatalog) throw new Error("Dashboard catalog refresh handler is unavailable.");
      const result = await actions.refreshCatalog(name);
      const updatedCatalogs = Array.isArray(result.catalogs) ? [...result.catalogs] : userCatalogs;
      if (Array.isArray(result.catalogs)) setUserCatalogs(updatedCatalogs);
      if (Array.isArray(result.resources)) setCatalogCandidates([...result.resources]);
      void checkCatalogFreshness(updatedCatalogs);
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
    if (versionNotice) {
      if (key.return || key.escape || input === " ") setVersionNotice(null);
      return;
    }
    const activeTourStep = tourStepRef.current;
    if (activeTourStep !== null) {
      if (key.escape) {
        tourStepRef.current = null;
        setTourStep(null);
        setScreenMode("inventory");
      } else if (key.leftArrow) {
        const previous = Math.max(0, activeTourStep - 1);
        tourStepRef.current = previous;
        setTourStep(previous);
        setScreenMode(previous === 0 ? "inventory" : previous === 1 ? "catalog" : "catalog-management");
      } else if (key.return || key.rightArrow || input === " ") {
        if (activeTourStep === 2) {
          tourStepRef.current = null;
          setTourStep(null);
          setScreenMode("inventory");
        } else {
          const next = activeTourStep + 1;
          tourStepRef.current = next;
          setTourStep(next);
          setScreenMode(next === 1 ? "catalog" : "catalog-management");
        }
      }
      return;
    }
    if (character === "?" && !filterMode && !catalogFilterMode) {
      tourStepRef.current = 0;
      setTourStep(0);
      setScreenMode("inventory");
      return;
    }
    if (!catalogWizard && !catalogRemoval && !catalogRefresh && !actionPending &&
        character === "m" && screenMode === "inventory" && !filterMode) {
      setScreenMode("catalog-management");
      setCatalogManagementIndex(0);
      void checkCatalogFreshness();
      return;
    }
    if (!catalogWizard && !catalogRemoval && !catalogRefresh && !actionPending && character === "a" &&
        screenMode === "catalog-management" && actions.addCatalog) {
      setCatalogWizard({
        step: "name",
        intent: "add",
        originalName: null,
        name: "",
        repository: "",
        mode: "basic",
        kind: "skill",
        path: "",
        entries: [],
        entryIndex: 0,
        message: "",
      });
      return;
    }
    if (!catalogWizard && !catalogRemoval && !catalogRefresh && !actionPending && character === "e" &&
        screenMode === "catalog-management" && actions.updateCatalog && userCatalogs.length) {
      const selected = userCatalogs[Math.min(catalogManagementIndex, userCatalogs.length - 1)];
      setCatalogWizard({
        step: "name",
        intent: "edit",
        originalName: selected.name,
        name: selected.name,
        repository: selected.repository,
        mode: selected.mode || "basic",
        kind: selected.entries?.[0]?.kind || "skill",
        path: "",
        entries: selected.mode === "custom" ? [...(selected.entries || [])] : [],
        entryIndex: 0,
        message: "",
      });
      return;
    }
    if (!catalogWizard && !catalogRemoval && !catalogRefresh && !actionPending &&
        character === "r" && screenMode === "catalog-management" &&
        actions.refreshCatalog && userCatalogs.length) {
      const index = Math.min(catalogManagementIndex, userCatalogs.length - 1);
      setCatalogRefresh({
        step: "scope", scope: "one", index, name: "", message: "", failed: false,
      });
      return;
    }
    if (!catalogWizard && !catalogRemoval && !catalogRefresh && !actionPending &&
        key.delete && screenMode === "catalog-management" &&
        actions.removeCatalog && userCatalogs.length) {
      const index = Math.min(catalogManagementIndex, userCatalogs.length - 1);
      setCatalogRemoval({
        step: "select", index, name: userCatalogs[index].name, message: "", failed: false,
      });
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
      } else if (character === "d") {
        setShowDetails((value) => !value);
      } else if (character === "f") {
        setCatalogFilterMode(true);
      } else if (character === "c") {
        setCatalogSourceFilter(cycleFilter(
          catalogSourceFilter, candidates, "catalog", "kind", catalogKindFilter, userCatalogs,
        ));
        setCatalogIndex(0);
      } else if (character === "k") {
        setCatalogKindFilter(cycleFilter(
          catalogKindFilter, candidates, "kind", "catalog", catalogSourceFilter, userCatalogs,
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
    if (screenMode === "catalog-management") {
      if (key.escape) setScreenMode("inventory");
      else if (character === "d") setShowDetails((value) => !value);
      else if (key.upArrow || key.downArrow) {
        setCatalogManagementIndex(cycleIndex(
          userCatalogs.length, catalogManagementIndex, key.downArrow ? 1 : -1,
        ));
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
    else if (character === "d") setShowDetails((value) => !value);
    else if (character === "f") setFilterMode(true);
    else if (character === "m") {
      setScreenMode("catalog-management");
      setCatalogManagementIndex(0);
    }
    else if (character === "c") {
      setInventoryCatalogFilter(cycleFilter(
        inventoryCatalogFilter, installedResources, "catalog", "kind", inventoryKindFilter, userCatalogs,
      ));
      setSelectedIndex(0);
    } else if (character === "k") {
      setInventoryKindFilter(cycleFilter(
        inventoryKindFilter, installedResources, "kind", "catalog", inventoryCatalogFilter, userCatalogs,
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
      intent: catalogWizard.intent,
      entryIndex: catalogWizard.entryIndex,
      name: catalogWizard.name,
      repository: catalogWizard.repository,
      mode: catalogWizard.mode,
      kind: catalogWizard.kind,
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
  if (screenMode === "catalog-management") {
    baseScreen = h(CatalogManagementScreen, {
      catalogs: userCatalogs,
      catalogResources: candidates,
      installedResources,
      selectedIndex: catalogManagementIndex,
      freshness: catalogFreshness,
      canAdd: typeof actions.addCatalog === "function",
      canRemove: typeof actions.removeCatalog === "function" && userCatalogs.length > 0,
      canEdit: typeof actions.updateCatalog === "function" && userCatalogs.length > 0,
      canRefresh: typeof actions.refreshCatalog === "function" && userCatalogs.length > 0,
      versionLabel,
      showDetails,
      columns,
      rows,
      tourStep,
    });
  } else if (screenMode === "catalog" || screenMode === "install-options") {
    baseScreen = h(CatalogScreen, {
      candidates,
      resources: installedResources,
      catalogs: userCatalogs,
      query: catalogQuery,
      filterMode: catalogFilterMode,
      catalogFilter: catalogSourceFilter,
      kindFilter: catalogKindFilter,
      selectedIndex: activeCatalogIndex,
      versionLabel,
      screenName: screenMode === "install-options" ? "INSTALL OPTIONS" : "INSTALL FROM CATALOG",
      showDetails,
      columns,
      rows,
      tourStep,
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
      versionLabel,
      actionMessage,
      catalogAvailable: candidates.length > 0,
      showDetails,
      canExecute: typeof actions.execute === "function" && Boolean(selectedResource),
      columns,
      rows,
      userCatalogs,
      tourStep,
      inventoryLabels,
    });
  }
  if (versionNotice && !migrationScopes.length) {
    modal = versionAvailableModal(
      versionNotice.installed,
      versionNotice.available,
      versionNotice.changelogUrl,
      columns,
    );
  } else if (tourStep !== null) {
    modal = onboardingModal(tourStep);
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
    addCatalog?: (request: AddCatalogRequest) => Promise<CatalogMutationResult>;
    updateCatalog?: (originalName: string, request: AddCatalogRequest) => Promise<CatalogMutationResult>;
    userCatalogs?: UserCatalog[];
    removeCatalog?: (name: string) => Promise<CatalogActionResult>;
    refreshCatalog?: (name?: string) => Promise<CatalogActionResult>;
    checkCatalogFreshness?: () => Promise<CatalogFreshnessResult[]>;
    showOnboarding?: boolean;
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
