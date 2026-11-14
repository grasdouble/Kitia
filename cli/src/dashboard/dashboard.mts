import React, { useEffect, useRef, useState } from "react";
import { checkInstalledVersion, type VersionNotice } from "./version-check.mjs";
import { updateCatalogFreshness, type CatalogFreshnessStatus } from "./catalog-freshness.mjs";
import { createForceRetryPrompt } from "./action-retry.mjs";
import { render, useInput, useWindowSize } from "ink";
import { CATALOG_PRESETS } from "../catalog/sources/presets.js";
import type { CatalogResource } from "../catalog/entries.js";
import type { ScanError } from "../catalog/lifecycle.js";
import { catalogFilterOptions, cycleCatalogFilter, cycleFilter, cycleIndex, cycleInventoryLicense, filterCatalogResources, filterInventory, inventoryCatalogLabels, inventoryFilterOptions,
  mergeRefreshedCatalogResources,
} from "./helpers.mjs";
import { type DashboardControlButton, type DashboardControlFilter } from "./controls.mjs";
import { DashboardMouseRegions, type DashboardControlFocus, type DashboardFilter, type DashboardMouseTarget, type DashboardSection } from "./input-transport.mjs";
import { createDashboardInputTransport } from "./input-transport.mjs";
import type { DashboardControlsProps } from "./controls.mjs";
import {
  CatalogManagementScreen, CatalogScreen, InspectionScreen, InventoryScreen, ScreenFrame,
  inspectionPageCount,
} from "./screens.mjs";
import {
  ModalOverlay, actionFailureModal, addCatalogModal, confirmationModal, inventoryMigrationModal,
  loadingModal, onboardingModal, optionsModal, refreshCatalogModal, removeCatalogModal, sourceVersionsModal,
  versionAvailableModal,
  catalogTransferModal, catalogPresetModal,
  type PendingDashboardAction, type SourceVersionOption,
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
  importSummary?: {
    added: string[];
    ignored: Array<{ name: string; reason: string }>;
    refreshed: Array<{ name: string; count: number }>;
    refreshFailures: Array<{ name: string; message: string }>;
  };
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
function yieldToRenderer(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
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

const h = React.createElement;
const sectionScreens: Record<string, "inventory" | "catalog" | "catalog-management"> = {
  "1": "inventory",
  "2": "catalog",
  "3": "catalog-management",
};


export function Dashboard({
  resources,
  errors = [],
  actions = {},
  onFinish,
  mouse,
}: {
  resources: CatalogResource[];
  errors?: ScanError[];
  actions?: {
    catalogResources?: CatalogResource[];
    execute?: (
      operation: string,
      resource: CatalogResource,
      options: {
        scope?: string;
        tool?: string;
        force?: boolean;
        ref?: string;
        ghForce?: boolean;
        ghForceAgent?: string;
        onProgress?: (message: string) => void;
      },
    ) => Promise<DashboardActionResult>;
    listSourceVersions?: (resource: CatalogResource) => SourceVersionOption[] | Promise<SourceVersionOption[]>;
    addCatalog?: (request: AddCatalogRequest) => Promise<CatalogMutationResult>;
    updateCatalog?: (originalName: string, request: AddCatalogRequest) => Promise<CatalogMutationResult>;
    userCatalogs?: UserCatalog[];
    removeCatalog?: (name: string) => Promise<CatalogActionResult>;
    refreshCatalog?: (name?: string) => Promise<CatalogActionResult>;
    transferCatalogs?: (action: "import" | "export", content: string) => Promise<CatalogActionResult>;
    checkCatalogFreshness?: (names?: string[]) => Promise<CatalogFreshnessResult[]>;
    showOnboarding?: boolean;
  };
  onFinish: (success: boolean) => void;
  mouse?: DashboardMouseRegions;
}) {
  const { columns = 80, rows = 24 } = useWindowSize();
  const installedVersion = process.env.KITIA_INSTALLED_VERSION || "unknown";
  const [versionLabel, setVersionLabel] = useState("Checking version update");
  const [versionNotice, setVersionNotice] = useState<VersionNotice | null>(null);
  useEffect(() => {
    if (installedVersion === "unknown") {
      setVersionLabel(installedVersion);
      return;
    }
    let active = true;
    void checkInstalledVersion(installedVersion).then(({ label, notice }) => {
      if (!active) return;
      setVersionLabel(label);
      setVersionNotice(notice);
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
  const [controlFocus, setControlFocus] = useState<DashboardControlFocus>("list");
  const [controlActionIndex, setControlActionIndex] = useState(0);
  const [filterMenu, setFilterMenu] = useState<DashboardFilter | null>(null);
  const [filterMenuIndex, setFilterMenuIndex] = useState(0);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogFilterMode, setCatalogFilterMode] = useState(false);
  const [catalogIndex, setCatalogIndex] = useState(0);
  const [catalogManagementIndex, setCatalogManagementIndex] = useState(0);
  const [catalogCandidates, setCatalogCandidates] = useState(() => actions.catalogResources || []);
  const [userCatalogs, setUserCatalogs] = useState(() => actions.userCatalogs || []);
  const [catalogFreshness, setCatalogFreshness] = useState<Record<string, CatalogFreshnessStatus>>({});
  const freshnessRequest = useRef(new Map<string, number>());
  const [catalogRemoval, setCatalogRemoval] = useState<CatalogRemovalState | null>(null);
  const [catalogRefresh, setCatalogRefresh] = useState<CatalogRefreshState | null>(null);
  const [catalogTransfer, setCatalogTransfer] = useState<CatalogTransferState | null>(null);
  const [catalogPreset, setCatalogPreset] = useState<CatalogPresetState | null>(null);
  const [inventoryCatalogFilter, setInventoryCatalogFilter] = useState("all");
  const [inventoryKindFilter, setInventoryKindFilter] = useState("all");
  const [inventoryLicenseFilter, setInventoryLicenseFilter] = useState("all");
  const [catalogSourceFilter, setCatalogSourceFilter] = useState("all");
  const [catalogKindFilter, setCatalogKindFilter] = useState("all");
  const [catalogLicenseFilter, setCatalogLicenseFilter] = useState("all");
  const [installResource, setInstallResource] = useState<CatalogResource | null>(null);
  const [installScope, setInstallScope] = useState("project");
  const [installTool, setInstallTool] = useState("copilot");
  const [installFocus, setInstallFocus] = useState(0);
  const [confirmation, setConfirmation] = useState<PendingDashboardAction | null>(null);
  const [confirmationChoice, setConfirmationChoice] = useState(0);
  const [confirmationStage, setConfirmationStage] = useState(1);
  const [actionMessage, setActionMessage] = useState("");
  const [actionFailure, setActionFailure] = useState<{ action: string; message: string } | null>(null);
  const [inspection, setInspection] = useState<{
    resource: CatalogResource;
    content: string;
    page: number;
    focus: "source" | "audit" | "tree";
    auditPage: number;
    treePage: number;
    localFiles?: Array<{ path: string; content: string }>;
    localTreeLines?: string[];
    localAuditLines?: string[];
  } | null>(null);
  const [sourceVersionPicker, setSourceVersionPicker] = useState<{
    resource: CatalogResource;
    versions: SourceVersionOption[];
    selectedIndex: number;
    action: "install" | "update";
  } | null>(null);
  const [installRef, setInstallRef] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [loadingFrame, setLoadingFrame] = useState(0);
  const [versionLoading, setVersionLoading] = useState(false);
  const loadingFrames = ["|", "/", "-", "\\"];
  const loading = actionPending || versionLoading || versionLabel === "Checking version update";
  useEffect(() => {
    if (!loading) return;
    const timer = setInterval(() => setLoadingFrame((frame) => (frame + 1) % loadingFrames.length), 100);
    return () => clearInterval(timer);
  }, [loading]);
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
  const checkCatalogFreshness = (
    catalogs = userCatalogs,
    names = catalogs.map(({ name }) => name),
  ) => updateCatalogFreshness(
    catalogs, names, freshnessRequest.current, setCatalogFreshness, actions.checkCatalogFreshness,
  );


  const inventoryLabels = inventoryCatalogLabels(installedResources, userCatalogs);
  const visibleInventory = filterInventory(
    installedResources, query, inventoryCatalogFilter, inventoryKindFilter, userCatalogs, inventoryLabels,
    inventoryLicenseFilter,
  );
  const activeInventoryIndex = Math.min(selectedIndex, Math.max(0, visibleInventory.length - 1));
  const selectedResource = visibleInventory[activeInventoryIndex];
  const candidates = catalogCandidates;
  const catalogFilters = { catalog: catalogSourceFilter, kind: catalogKindFilter, license: catalogLicenseFilter };
  const resetCatalogLicenseFilter = () => setCatalogLicenseFilter("all");
  const visibleCatalog = filterCatalogResources(
    candidates, catalogQuery, catalogSourceFilter, catalogKindFilter, userCatalogs, {
      license: catalogLicenseFilter === "all" ? undefined : catalogLicenseFilter,
    },
  );
  const activeCatalogIndex = Math.min(catalogIndex, Math.max(0, visibleCatalog.length - 1));
  const controlSection: DashboardSection = screenMode === "catalog-management" ? "catalogs"
    : screenMode === "catalog" || screenMode === "install-options" ? "browse" : "inventory";
  const selectedCandidate = visibleCatalog[activeCatalogIndex];
  const candidateInstalledScopes = selectedCandidate
    ? installedResources.filter((resource) => resource.managed !== false && resource.catalog === selectedCandidate.catalog &&
      resource.kind === selectedCandidate.kind && resource.id === selectedCandidate.id).map((resource) => resource.scope)
    : [];
  const inventoryControlsFilters: DashboardControlFilter[] = [
    { id: "kind", value: inventoryKindFilter, options: inventoryFilterOptions(installedResources, "kind", inventoryCatalogFilter, inventoryKindFilter, inventoryLicenseFilter, userCatalogs) },
    { id: "catalog", value: inventoryCatalogFilter, options: inventoryFilterOptions(installedResources, "catalog", inventoryCatalogFilter, inventoryKindFilter, inventoryLicenseFilter, userCatalogs) },
    { id: "license", value: inventoryLicenseFilter, options: inventoryFilterOptions(installedResources, "license", inventoryCatalogFilter, inventoryKindFilter, inventoryLicenseFilter, userCatalogs) },
  ];
  const browseControlsFilters: DashboardControlFilter[] = [
    { id: "kind", value: catalogKindFilter, options: catalogFilterOptions(candidates, "kind", catalogFilters, userCatalogs) },
    { id: "catalog", value: catalogSourceFilter, options: catalogFilterOptions(candidates, "catalog", catalogFilters, userCatalogs) },
    { id: "license", value: catalogLicenseFilter, options: catalogFilterOptions(candidates, "license", catalogFilters, userCatalogs) },
  ];
  const controlActions: DashboardControlButton[] = controlSection === "inventory"
    ? [
      ...(selectedResource && selectedResource.managed !== false && actions.execute ? [{ id: "update", label: "Update resource" }] : []),
      ...(selectedResource && actions.execute ? [{ id: "remove", label: selectedResource.managed === false ? "Remove" : "Uninstall" }] : []),
      ...(actions.execute && selectedResource?.scope && (selectedResource.managed === false
        ? Boolean(selectedResource.paths?.length)
        : Boolean(selectedResource.source_repository && selectedResource.source_path)) ? [{ id: "preview", label: "Preview / audit" }] : []),
      ...(selectedResource?.managed !== false && selectedResource?.source_repository && selectedResource?.source_path && actions.listSourceVersions && actions.execute
        ? [{ id: "revision", label: "Revisions" }] : []),
      ...(candidates.length && actions.execute ? [{ id: "install", label: "Install resource" }] : []),
    ]
    : controlSection === "browse"
      ? [
        ...(selectedCandidate && actions.execute ? [{ id: "install", label: "Install resource" }] : []),
        ...(selectedCandidate && actions.execute ? [{ id: "preview", label: "Preview / audit" }] : []),
        ...(selectedCandidate?.source_repository && selectedCandidate?.source_path && actions.listSourceVersions && actions.execute
          ? [{ id: "revision", label: "Revisions" }] : []),
        ...(candidateInstalledScopes.length && actions.listSourceVersions && actions.execute ? [{ id: "update", label: "Update resource" }] : []),
      ]
      : [
        ...(actions.addCatalog ? [{ id: "add-catalog", label: "Add catalog" }, { id: "presets", label: "Presets" }] : []),
        ...(userCatalogs.length && actions.updateCatalog ? [{ id: "edit-catalog", label: "Edit" }] : []),
        ...(userCatalogs.length && actions.refreshCatalog ? [{ id: "refresh-catalog", label: "Refresh" }] : []),
        ...(userCatalogs.length && actions.removeCatalog ? [{ id: "remove-catalog", label: "Remove" }] : []),
        ...(actions.transferCatalogs ? [{ id: "import-catalogs", label: "Import" }, { id: "export-catalogs", label: "Export" }] : []),
      ];
  const controlsBase: Omit<DashboardControlsProps, "modalActive"> = {
    columns,
    rows,
    section: controlSection,
    sectionCounts: {
      inventory: installedResources.length,
      browse: candidates.length,
      catalogs: userCatalogs.length,
    },
    focus: controlFocus,
    query: controlSection === "browse" ? catalogQuery : query,
    searchActive: controlSection === "browse" ? catalogFilterMode : controlSection === "inventory" ? filterMode : false,
    showSearch: controlSection !== "catalogs",
    actionsInToolbar: !showDetails,
    ...(controlSection === "inventory" ? { filters: inventoryControlsFilters }
      : controlSection === "browse" ? { filters: browseControlsFilters } : {}),
    menuFilter: filterMenu,
    menuOptions: filterMenu
      ? (controlSection === "inventory" ? inventoryControlsFilters : browseControlsFilters)
        .find(({ id }) => id === filterMenu)?.options || []
      : [],
    menuIndex: filterMenuIndex,
    actions: controlActions,
    actionIndex: controlActionIndex,
    mouse,
  };
  const headerVersionLabel = loading
    ? `${loadingFrames[loadingFrame]} ${actionPending ? actionMessage || "Loading" : versionLabel}`
    : versionLabel;

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

  const queueForceRetry = (
    requested: PendingDashboardAction,
    failure: {
      code?: string;
      category?: string;
      paths?: string[];
      recoverable?: boolean;
      userMessage?: string;
      agent?: string;
    },
  ): boolean => {
    const prompt = createForceRetryPrompt(requested, failure);
    if (!prompt) return false;
    setConfirmation(prompt.confirmation);
    setConfirmationChoice(0);
    setActionMessage(prompt.message);
    return true;
  };

  const openSourceVersions = async (
    resource: CatalogResource,
    action: "install" | "update" = "install",
  ) => {
    if (!actions.listSourceVersions || versionLoading) return;
    setVersionLoading(true);
    setActionPending(true);
    setActionMessage(`Loading commit history for ${resource.id}...`);
    setActionFailure(null);
    try {
      const versions = await actions.listSourceVersions(resource);
      if (!versions.length) {
        setActionFailure({
          action: "versions",
          message: `No commits found for ${resource.catalog}:${resource.kind}:${resource.id}.`,
        });
        return;
      }
      setSourceVersionPicker({ resource, versions, selectedIndex: 0, action });
    } catch (error) {
      setActionFailure({
        action: "versions",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setVersionLoading(false);
      setActionPending(false);
      setActionMessage("");
    }
  };
  const runConfirmedAction = async (requested: PendingDashboardAction) => {
    setActionPending(true);
    setLastActionFailed(false);
    setActionFailure(null);
    const inspectionAction = requested.action === "preview";
    const progressLabel = requested.action === "install" ? "Installing"
      : requested.action === "update" ? "Updating"
        : requested.action === "remove-unmanaged" ? "Removing"
          : requested.action === "uninstall" ? "Uninstalling" : "Previewing";
    const completedLabel = requested.action === "install" ? "Installed"
      : requested.action === "update" ? "Updated"
        : requested.action === "remove-unmanaged" ? "Removed"
          : requested.action === "uninstall" ? "Uninstalled" : "Previewed";
    setActionMessage(`${progressLabel} ${requested.resource.kind}:${requested.resource.id}...`);
    await yieldToRenderer();
    try {
      if (!actions.execute) throw new Error("Dashboard action handler is unavailable.");
      const result = await actions.execute(requested.action, requested.resource, {
        scope: requested.scope,
        tool: requested.tool,
        ...(requested.ref ? { ref: requested.ref } : {}),
        ...(requested.forceRetry && !requested.ghForceRetry ? { force: true } : {}),
        ...(requested.ghForceRetry
          ? { ghForce: true, ghForceAgent: requested.ghForceAgent }
          : {}),
        onProgress: (message) => setActionMessage(message),
      });
      if (Array.isArray(result.resources)) setInstalledResources([...result.resources]);
      if (Array.isArray(result.errors)) setScanErrors([...result.errors]);
      const outcome = result.messages?.filter(Boolean).join("\n");
      const failed = result.code !== 0;
      setLastActionFailed(failed);
      if (failed) {
        const failure = result.failure;
        if (!failure || !queueForceRetry(requested, failure)) {
          const errorText = failure?.userMessage ||
            (requested.action === "update"
              ? `Update failed (exit ${result.code}); no safe cause details were provided by the action handler.`
              : `Action failed (exit ${result.code}).`);
          setActionFailure({ action: requested.action, message: errorText });
          setActionMessage(`Action failed${result.code ? ` (exit ${result.code})` : ""}: ${errorText}`);
        }
      } else if (inspectionAction) {
        setInspection({
          resource: requested.resource,
          content: outcome || "Source content unavailable; no preview was returned.",
          page: 0,
          focus: "source",
          auditPage: 0,
          treePage: 0,
          ...(result.previewFiles ? {
            localFiles: result.previewFiles,
            localTreeLines: result.previewTree,
            localAuditLines: result.previewAuditLines,
          } : {}),
        });
      } else {
        setActionMessage(outcome || `${completedLabel} ${requested.resource.kind}:${requested.resource.id}.`);
      }
    } catch (error) {
      const typed = error as Error & {
        code?: string;
        category?: string;
        paths?: string[];
        recoverable?: boolean;
        userMessage?: string;
        agent?: string;
      };
      setLastActionFailed(true);
      if (!queueForceRetry(requested, typed)) {
        const message = typed.userMessage || (error instanceof Error ? error.message : String(error));
        setActionFailure({ action: requested.action, message });
        setActionMessage(`Action failed: ${message}`);
      }
    } finally {
      setActionPending(false);
    }
  };

  const navigateToSection = (section: DashboardSection) => {
    setFilterMenu(null);
    setFilterMode(false);
    setCatalogFilterMode(false);
    setControlFocus("list");
    const destination = section === "inventory" ? "inventory" : section === "browse" ? "catalog" : "catalog-management";
    setScreenMode(destination);
    if (section === "catalogs" && screenMode !== destination) void checkCatalogFreshness();
  };
  const currentFilterValue = (filter: DashboardFilter) => controlSection === "inventory"
    ? filter === "catalog" ? inventoryCatalogFilter : filter === "kind" ? inventoryKindFilter : inventoryLicenseFilter
    : filter === "catalog" ? catalogSourceFilter : filter === "kind" ? catalogKindFilter : catalogLicenseFilter;
  const openFilterMenu = (filter: DashboardFilter) => {
    const options = (controlSection === "inventory" ? inventoryControlsFilters : browseControlsFilters)
      .find(({ id }) => id === filter)?.options || ["all"];
    setFilterMenu(filter);
    setFilterMenuIndex(Math.max(0, options.indexOf(currentFilterValue(filter))));
    setControlFocus(filter);
    setFilterMode(false);
    setCatalogFilterMode(false);
  };
  const chooseFilterValue = (filter: DashboardFilter, value: string) => {
    if (controlSection === "inventory") {
      if (filter === "catalog") setInventoryCatalogFilter(value);
      else if (filter === "kind") setInventoryKindFilter(value);
      else setInventoryLicenseFilter(value);
      setSelectedIndex(0);
    } else if (filter === "catalog") {
      setCatalogSourceFilter(value);
      resetCatalogLicenseFilter();
      setCatalogIndex(0);
    } else if (filter === "kind") {
      setCatalogKindFilter(value);
      resetCatalogLicenseFilter();
      setCatalogIndex(0);
    } else {
      setCatalogLicenseFilter(value);
      setCatalogIndex(0);
    }
    setFilterMenu(null);
    setControlFocus(filter);
  };
  const openInstallOptions = (resource: CatalogResource) => {
    setInstallResource(resource);
    setInstallRef(null);
    setInstallScope("project");
    setInstallTool("copilot");
    setInstallFocus(resource.kind === "instruction" ? 1 : 0);
    setScreenMode("install-options");
    setActionMessage("");
  };
  const chooseConfirmation = (choice: number) => {
    if (!confirmation) return;
    if (choice === 0) {
      if (confirmation.action === "install") setScreenMode("install-options");
      setConfirmation(null);
      setConfirmationStage(1);
      setConfirmationChoice(0);
      return;
    }
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
  };
  const activateControlAction = (action: string) => {
    if (controlSection === "inventory") {
      if (action === "install" && candidates.length && actions.execute) {
        setCatalogQuery("");
        resetCatalogLicenseFilter();
        setCatalogIndex(0);
        setActionMessage("");
        navigateToSection("browse");
      }
      else if (action === "preview" && selectedResource) void runConfirmedAction({ action: "preview", resource: selectedResource });
      else if (action === "revision" && selectedResource) void openSourceVersions(selectedResource, "update");
      else if (action === "update" && selectedResource) {
        setConfirmation({ action: "update", resource: selectedResource });
        setConfirmationChoice(1);
        setActionMessage("");
      } else if (action === "remove" && selectedResource) {
        setConfirmation({ action: selectedResource.managed === false ? "remove-unmanaged" : "uninstall", resource: selectedResource });
        setConfirmationStage(1);
        setConfirmationChoice(0);
        setActionMessage("");
      }
      return;
    }
    if (controlSection === "browse" && selectedCandidate) {
      if (action === "install") openInstallOptions(selectedCandidate);
      else if (action === "preview") void runConfirmedAction({ action: "preview", resource: selectedCandidate });
      else if (action === "revision" || action === "update") {
        const replacementScope = candidateInstalledScopes.length === 1 ? candidateInstalledScopes[0] : null;
        void openSourceVersions(
          replacementScope ? { ...selectedCandidate, scope: replacementScope } : selectedCandidate,
          replacementScope ? "update" : "install",
        );
      }
      return;
    }
    if (controlSection !== "catalogs") return;
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
  const handleMouseTarget = (target: DashboardMouseTarget) => {
    if (target.type === "modal-choice") {
      if (confirmation) chooseConfirmation(target.index);
      return;
    }
    if (target.type === "modal-option") {
      if (screenMode === "install-options" && installResource) {
        if (target.group === "scope") {
          const choices = installResource.kind === "instruction" ? ["project"] : ["project", "user"];
          setInstallScope(choices[Math.min(target.index, choices.length - 1)]);
          setInstallFocus(0);
        } else {
          setInstallTool(["copilot", "claude", "both"][Math.min(target.index, 2)]);
          setInstallFocus(1);
        }
      }
      return;
    }
    if (actionPending || versionLoading || inspection || actionFailure || confirmation || catalogWizard || catalogRemoval ||
        catalogRefresh || catalogTransfer || catalogPreset || sourceVersionPicker || versionNotice || tourStep !== null || migrationScopes.length ||
        screenMode === "install-options") return;
    if (target.type === "section") navigateToSection(target.section);
    else if (target.type === "focus") {
      setControlFocus(target.focus);
      setFilterMenu(null);
      setFilterMode(target.focus === "search" && controlSection === "inventory");
      setCatalogFilterMode(target.focus === "search" && controlSection === "browse");
    } else if (target.type === "filter-open") openFilterMenu(target.filter);
    else if (target.type === "filter-option") chooseFilterValue(target.filter, target.value);
    else if (target.type === "row") {
      if (target.screen === "inventory") setSelectedIndex(target.index);
      else if (target.screen === "browse") setCatalogIndex(target.index);
      else setCatalogManagementIndex(target.index);
      setFilterMenu(null);
      setFilterMode(false);
      setCatalogFilterMode(false);
      setControlFocus("list");
    } else if (target.type === "action") activateControlAction(target.action);
  };
  mouse?.setHandler(handleMouseTarget);
  const controlFocusOrder: DashboardControlFocus[] = [
    "tabs",
    ...(controlsBase.showSearch ? ["search" as const] : []),
    ...(controlsBase.filters || []).map(({ id }) => id),
    ...(controlActions.length ? ["actions" as const] : []),
    "list",
  ];
  const moveControlFocus = (backwards = false) => {
    const index = controlFocusOrder.indexOf(controlFocus);
    const offset = backwards ? -1 : 1;
    const next = controlFocusOrder[(index + offset + controlFocusOrder.length) % controlFocusOrder.length];
    setControlFocus(next);
    setFilterMenu(null);
    setFilterMode(next === "search" && controlSection === "inventory");
    setCatalogFilterMode(next === "search" && controlSection === "browse");
    if (next === "actions") setControlActionIndex((current) => Math.min(current, Math.max(0, controlActions.length - 1)));
  };

  useInput((input, key) => {
    const character = input.toLocaleLowerCase();
    if (actionPending || versionLoading) return;
    if (sourceVersionPicker) {
      if (key.escape) setSourceVersionPicker(null);
      else if (key.upArrow || key.downArrow) {
        setSourceVersionPicker((current) => current ? {
          ...current,
          selectedIndex: cycleIndex(current.versions.length, current.selectedIndex, key.upArrow ? -1 : 1),
        } : current);
      } else if (key.return) {
        const { resource, versions, selectedIndex, action } = sourceVersionPicker;
        const ref = versions[selectedIndex].sha;
        setSourceVersionPicker(null);
        if (action === "update") {
          setConfirmation({ action, resource, ref });
          setConfirmationChoice(1);
          setConfirmationStage(1);
          setActionMessage("");
        } else {
          const installedScopes = ["project", "user"].filter((scope) =>
            installedResources.some((installed) =>
              installed.scope === scope && installed.catalog === resource.catalog &&
              installed.kind === resource.kind && installed.id === resource.id));
          if (installedScopes.length === 1) {
            const scope = installedScopes[0];
            setConfirmation({ action: "update", resource: { ...resource, scope }, scope, ref });
            setConfirmationChoice(1);
            setConfirmationStage(1);
            setActionMessage("");
          } else {
            setInstallResource(resource);
            setInstallRef(ref);
            setInstallScope("project");
            setInstallTool("copilot");
            setInstallFocus(0);
            setScreenMode("install-options");
            setActionMessage("");
          }
        }
      }
      return;
    }
    if (inspection) {
      if (key.tab || character === "s" || character === "a" || character === "t") {
        setInspection((current) => {
          if (!current) return current;
          const panels = ["source", "audit", "tree"] as const;
          const focus = key.tab
            ? panels[(panels.indexOf(current.focus) + (key.shift ? 2 : 1)) % panels.length]
            : character === "a" ? "audit" : character === "t" ? "tree" : "source";
          return { ...current, focus };
        });
      } else if (key.leftArrow || key.pageUp || key.rightArrow || key.pageDown) {
        setInspection((current) => {
          if (!current) return current;
          const field = current.focus === "audit" ? "auditPage" : current.focus === "tree" ? "treePage" : "page";
          const pageCount = inspectionPageCount({ ...current, columns, rows });
          const delta = key.leftArrow || key.pageUp ? -1 : 1;
          return { ...current, [field]: Math.max(0, Math.min(pageCount - 1, current[field] + delta)) };
        });
      } else if (key.return || key.escape || input === " ") {
        setInspection(null);
      }
      return;
    }
    if (actionFailure) {
      if (key.return || key.escape || input === " ") setActionFailure(null);
      return;
    }
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
    if (!catalogWizard && !catalogRemoval && !catalogRefresh && !catalogTransfer &&
        !catalogPreset && !actionPending && character === "p" &&
        screenMode === "catalog-management" && actions.addCatalog) {
      setCatalogPreset({ index: 0 });
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
    if (!catalogWizard && !catalogRemoval && !catalogRefresh && !catalogTransfer &&
        !actionPending && screenMode === "catalog-management" && character === "i" && actions.transferCatalogs) {
      setCatalogTransfer({ action: "import", step: "paste", content: "", message: "", working: false });
      return;
    }
    if (!catalogWizard && !catalogRemoval && !catalogRefresh && !catalogTransfer &&
        !actionPending && screenMode === "catalog-management" && character === "x" && actions.transferCatalogs) {
      setCatalogTransfer({ action: "export", step: "paste", content: "", message: "", working: false });
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

    if (confirmation) {
      if ((key.ctrl && character === "c") || key.escape || character === "n") chooseConfirmation(0);
      else if (key.leftArrow || key.rightArrow || key.upArrow || key.downArrow) {
        setConfirmationChoice(confirmationChoice === 0 ? 1 : 0);
      } else if (character === "y") chooseConfirmation(1);
      else if (key.return) chooseConfirmation(confirmationChoice);
      return;
    }
    if (actionPending) return;
    if (filterMenu) {
      const options = controlsBase.filters?.find(({ id }) => id === filterMenu)?.options || [];
      if (key.tab || input === "\t") moveControlFocus(key.shift);
      else if (key.escape) setFilterMenu(null);
      else if ((key.upArrow || key.downArrow) && options.length) {
        setFilterMenuIndex(cycleIndex(options.length, filterMenuIndex, key.downArrow ? 1 : -1));
      } else if ((key.return || input === " ") && options.length) {
        chooseFilterValue(filterMenu, options[Math.min(filterMenuIndex, options.length - 1)]);
      }
      return;
    }
    if ((key.tab || input === "\t") && screenMode !== "install-options") {
      moveControlFocus(key.shift);
      return;
    }
    if (controlFocus === "tabs" && (key.leftArrow || key.rightArrow)) {
      const index = ["inventory", "browse", "catalogs"].indexOf(controlSection);
      const next = ["inventory", "browse", "catalogs"][(index + (key.rightArrow ? 1 : 2)) % 3] as DashboardSection;
      navigateToSection(next);
      return;
    }
    if ((controlFocus === "catalog" || controlFocus === "kind" || controlFocus === "license") &&
        controlsBase.filters?.some(({ id }) => id === controlFocus) && (key.return || input === " ")) {
      openFilterMenu(controlFocus);
      return;
    }
    if (controlFocus === "actions" && controlActions.length) {
      if (key.leftArrow || key.rightArrow) {
        setControlActionIndex(cycleIndex(controlActions.length, controlActionIndex, key.rightArrow ? 1 : -1));
        return;
      }
      if (key.return || input === " ") {
        const action = controlActions[controlActionIndex];
        if (action) activateControlAction(action.id);
        return;
      }
    }
    const activeFilter = screenMode === "catalog"
      ? catalogFilterMode
      : screenMode === "inventory" && filterMode;
    if ((key.ctrl && character === "c") || (character === "q" && !activeFilter)) {
      onFinish(!lastActionFailed);
      return;
    }

    const destination = !activeFilter && screenMode !== "install-options"
      ? sectionScreens[character]
      : undefined;
    if (destination) {
      navigateToSection(destination === "inventory" ? "inventory" : destination === "catalog" ? "browse" : "catalogs");
      return;
    }

    if (screenMode === "catalog") {
      if (catalogFilterMode) {
        if (key.return) {
          setCatalogFilterMode(false);
          setControlFocus("list");
        } else if (key.escape) {
          setCatalogFilterMode(false);
          setCatalogQuery("");
          resetCatalogLicenseFilter();
          setCatalogIndex(0);
          setControlFocus("list");
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
        navigateToSection("inventory");
      } else if (character === "d") {
        setShowDetails((value) => !value);
      } else if (character === "f") {
        setCatalogFilterMode(true);
        setControlFocus("search");
      } else if (character === "c") {
        setCatalogSourceFilter(cycleCatalogFilter(
          catalogSourceFilter, candidates, "catalog", catalogFilters, userCatalogs,
        ));
        resetCatalogLicenseFilter();
        setCatalogIndex(0);
      } else if (character === "k") {
        setCatalogKindFilter(cycleCatalogFilter(
          catalogKindFilter, candidates, "kind", catalogFilters, userCatalogs,
        ));
        setCatalogLicenseFilter("all");
        setCatalogIndex(0);
      } else if (character === "l") {
        setCatalogLicenseFilter(cycleCatalogFilter(catalogLicenseFilter, candidates, "license", catalogFilters, userCatalogs));
        setCatalogIndex(0);
      } else if (character === "v") {
        const resource = visibleCatalog[activeCatalogIndex];
        if (resource?.source_repository && resource.source_path) {
          const installedScopes = ["project", "user"].filter((scope) =>
            installedResources.some((installed) =>
              installed.scope === scope && installed.catalog === resource.catalog &&
              installed.kind === resource.kind && installed.id === resource.id));
          const replacementScope = installedScopes.length === 1 ? installedScopes[0] : null;
          openSourceVersions(
            replacementScope ? { ...resource, scope: replacementScope } : resource,
            replacementScope ? "update" : "install",
          );
        }
      } else if (character === "p") {
        const resource = visibleCatalog[activeCatalogIndex];
        if (resource) void runConfirmedAction({ action: "preview", resource });
      } else if (key.upArrow) setCatalogIndex(cycleIndex(visibleCatalog.length, activeCatalogIndex, -1));
      else if (key.downArrow) setCatalogIndex(cycleIndex(visibleCatalog.length, activeCatalogIndex, 1));
      else if (key.return && visibleCatalog[activeCatalogIndex]) {
        const resource = visibleCatalog[activeCatalogIndex];
        setInstallResource(resource);
        setInstallRef(null);
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
        if ((!alreadyInstalled || installRef) && !scopeError) {
          const replacement = alreadyInstalled && Boolean(installRef);
          setConfirmation({
            action: replacement ? "update" : "install",
            resource: { ...installResource, scope: installScope },
            scope: installScope,
            tool: installTool,
            ...(installRef ? { ref: installRef } : {}),
          });
          setConfirmationChoice(replacement ? 1 : 0);
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
      if (key.return) {
        setFilterMode(false);
        setControlFocus("list");
      }
      else if (key.escape) {
        setFilterMode(false);
        setQuery("");
        setSelectedIndex(0);
        setControlFocus("list");
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
    else if (character === "f") {
      setFilterMode(true);
      setControlFocus("search");
    }
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
    } else if (character === "l") {
      setInventoryLicenseFilter(cycleInventoryLicense(
        inventoryLicenseFilter, installedResources, inventoryCatalogFilter, inventoryKindFilter, userCatalogs,
      ));
      setSelectedIndex(0);
    } else if (character === "p" && selectedResource && selectedResource.scope &&
        (selectedResource.managed === false
          ? Boolean(selectedResource.paths?.length)
          : Boolean(selectedResource.source_repository && selectedResource.source_path))) {
      void runConfirmedAction({ action: "preview", resource: selectedResource });
    } else if (character === "v" && selectedResource &&
        selectedResource.managed !== false && selectedResource.source_repository &&
        selectedResource.source_path &&
        typeof actions.listSourceVersions === "function") {
      openSourceVersions(selectedResource, "update");
    } else if (character === "a" && candidates.length) {
      setScreenMode("catalog");
      setCatalogQuery("");
      resetCatalogLicenseFilter();
      setCatalogIndex(0);
      setCatalogFilterMode(false);
      setActionMessage("");
    } else if (character === "u" && selectedResource && selectedResource.managed !== false &&
        typeof actions.execute === "function") {
      setConfirmation({ action: "update", resource: selectedResource });
      setConfirmationChoice(1);
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
  } else if (catalogPreset) {
    modal = catalogPresetModal({
      presets: CATALOG_PRESETS,
      index: catalogPreset.index,
      columns,
    });
  } else if (catalogTransfer) {
    modal = catalogTransferModal({ ...catalogTransfer, columns });
  } else if (sourceVersionPicker) {
    modal = sourceVersionsModal({ ...sourceVersionPicker, columns, rows });
  } else if (actionFailure) {
    modal = actionFailureModal({ ...actionFailure, columns });
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
      ref: installRef,
      focus: installFocus,
      resources: installedResources,
      errors: scanErrors,
      columns,
    });
  }
  const screenModalActive = Boolean(modal || versionNotice || tourStep !== null || actionPending || inspection);
  mouse?.beginFrame();
  if (inspection) {
    baseScreen = h(InspectionScreen, {
      ...inspection,
      versionLabel: headerVersionLabel,
      columns,
      rows,
    });
  } else if (screenMode === "catalog-management") {
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
      canTransfer: typeof actions.transferCatalogs === "function",
      versionLabel: headerVersionLabel,
      showDetails,
      columns,
      rows,
      controls: { ...controlsBase, modalActive: screenModalActive },
      modalActive: screenModalActive,
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
      licenseFilter: catalogLicenseFilter,
      selectedIndex: activeCatalogIndex,
      versionLabel: headerVersionLabel,
      screenName: screenMode === "install-options" ? "INSTALL OPTIONS" : "INSTALL FROM CATALOG",
      showDetails,
      columns,
      rows,
      controls: { ...controlsBase, modalActive: screenModalActive },
      modalActive: screenModalActive,
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
      licenseFilter: inventoryLicenseFilter,
      selectedIndex: activeInventoryIndex,
      versionLabel: headerVersionLabel,
      actionMessage,
      catalogAvailable: candidates.length > 0,
      showDetails,
      canExecute: typeof actions.execute === "function" && Boolean(selectedResource),
      columns,
      rows,
      controls: { ...controlsBase, modalActive: screenModalActive },
      modalActive: screenModalActive,
      userCatalogs,
      tourStep,
      inventoryLabels,
    });
  }
  if (actionPending) {
    modal = loadingModal({
      message: actionMessage || "Loading...",
      frame: loadingFrames[loadingFrame],
      columns,
    });
  } else if (versionNotice && !migrationScopes.length && !actionFailure) {
    modal = versionAvailableModal(
      versionNotice.installed,
      versionNotice.available,
      versionNotice.changelogUrl,
      columns,
    );
  } else if (tourStep !== null && !actionFailure) {
    modal = onboardingModal(tourStep);
  }
  const overlay = modal && h(ModalOverlay, { modal, columns, rows, mouse });
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
      options: {
        scope?: string;
        tool?: string;
        force?: boolean;
        ref?: string;
        ghForce?: boolean;
        ghForceAgent?: string;
        onProgress?: (message: string) => void;
      },
    ) => Promise<DashboardActionResult>;
    listSourceVersions?: (resource: CatalogResource) => SourceVersionOption[] | Promise<SourceVersionOption[]>;
    addCatalog?: (request: AddCatalogRequest) => Promise<CatalogMutationResult>;
    updateCatalog?: (originalName: string, request: AddCatalogRequest) => Promise<CatalogMutationResult>;
    userCatalogs?: UserCatalog[];
    removeCatalog?: (name: string) => Promise<CatalogActionResult>;
    refreshCatalog?: (name?: string) => Promise<CatalogActionResult>;
    checkCatalogFreshness?: (names?: string[]) => Promise<CatalogFreshnessResult[]>;
    showOnboarding?: boolean;
  } = {},
): Promise<boolean> {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") return false;

  return new Promise((resolve, reject) => {
    const transport = createDashboardInputTransport(input, output);
    let app;
    let finished = false;
    const onFinish = (success) => {
      if (finished) return;
      finished = true;
      input.removeListener("close", onInputClose);
      try {
        app?.unmount();
      } finally {
        transport.dispose();
        resolve(success);
      }
    };
    const onInputClose = () => onFinish(false);
    input.once("close", onInputClose);
    try {
      app = render(h(Dashboard, { resources, errors, actions, onFinish, mouse: transport.mouse }), {
        stdin: transport.stdin,
        stdout: output,
        exitOnCtrlC: false,
        alternateScreen: true,
        interactive: true,
      });
      transport.enableMouse();
    } catch (error) {
      input.removeListener("close", onInputClose);
      finished = true;
      transport.dispose();
      reject(error);
      return;
    }
    app.waitUntilExit().catch((error) => {
      if (!finished) {
        input.removeListener("close", onInputClose);
        finished = true;
        try { app.unmount(); } finally {
          transport.dispose();
          reject(error);
        }
      }
    });
  });
}
