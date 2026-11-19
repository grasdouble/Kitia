import { render, useInput, useWindowSize } from 'ink';
import React, { useEffect, useRef, useState } from 'react';

import type { ScanError } from '../core/inventory/checks.js';
import type { CatalogResource } from '../core/resources/model.js';
import type {
  DashboardControlButton,
  DashboardControlFilter,
  ControlsProps,
} from './components/controls/control-layout-plan.mjs';
import type { DashboardActions } from './contracts.js';
import { useDashboardActivity } from './features/activity.mjs';
import { useCatalogManagement } from './features/catalog-management/workflow.mjs';
import { useInspection } from './features/inspection/workflow.mjs';
import { inventoryMigrationModal, onboardingModal, versionAvailableModal } from './features/notices/modals.mjs';
import { useResourceWorkflow } from './features/resources/workflow.mjs';
import {
  catalogFilterOptions,
  cycleCatalogFilter,
  cycleFilter,
  cycleIndex,
  cycleInventoryLicense,
  dashboardStatus,
  filterCatalogResources,
  filterInventory,
  inventoryCatalogLabels,
  inventoryFilterOptions,
} from './helpers.mjs';
import {
  DashboardMouseRegions,
  type DashboardControlFocus,
  type DashboardFilter,
  type DashboardMouseTarget,
  type DashboardSection,
} from './input-transport.mjs';
import { createDashboardInputTransport } from './input-transport.mjs';
import { ModalOverlay, loadingModal } from './modals.mjs';
import { CatalogManagementScreen, CatalogScreen, InspectionScreen, InventoryScreen, ScreenFrame } from './screens.mjs';
import { checkInstalledVersion, type VersionNotice } from './version-check.mjs';

const h = React.createElement;
const sectionScreens: Record<string, 'inventory' | 'catalog' | 'catalog-management'> = {
  '1': 'inventory',
  '2': 'catalog',
  '3': 'catalog-management',
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
  actions?: DashboardActions;
  onFinish: (success: boolean) => void;
  mouse?: DashboardMouseRegions;
}) {
  const { columns = 80, rows = 24 } = useWindowSize();
  const installedVersion = process.env.KITIA_INSTALLED_VERSION || 'unknown';
  const [versionLabel, setVersionLabel] = useState('Checking version update');
  const [versionNotice, setVersionNotice] = useState<VersionNotice | null>(null);
  useEffect(() => {
    if (installedVersion === 'unknown') {
      setVersionLabel(installedVersion);
      return;
    }
    let active = true;
    void checkInstalledVersion(installedVersion)
      .then(({ label, notice }) => {
        if (!active) return;
        setVersionLabel(label);
        setVersionNotice(notice);
      })
      .catch(() => {
        if (active) setVersionLabel(installedVersion);
      });
    return () => {
      active = false;
    };
  }, [installedVersion]);
  const [screenMode, setScreenMode] = useState('inventory');
  const [query, setQuery] = useState('');
  const [filterMode, setFilterMode] = useState(false);
  const [showDetails, setShowDetails] = useState(true);
  const [tourStep, setTourStep] = useState<number | null>(actions.showOnboarding ? 0 : null);
  const tourStepRef = useRef<number | null>(actions.showOnboarding ? 0 : null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [controlFocus, setControlFocus] = useState<DashboardControlFocus>('list');
  const [controlActionIndex, setControlActionIndex] = useState(0);
  const [filterMenu, setFilterMenu] = useState<DashboardFilter | null>(null);
  const [filterMenuIndex, setFilterMenuIndex] = useState(0);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogFilterMode, setCatalogFilterMode] = useState(false);
  const [catalogIndex, setCatalogIndex] = useState(0);
  const [inventoryCatalogFilter, setInventoryCatalogFilter] = useState('all');
  const [inventoryKindFilter, setInventoryKindFilter] = useState('all');
  const [inventoryLicenseFilter, setInventoryLicenseFilter] = useState('all');
  const [catalogSourceFilter, setCatalogSourceFilter] = useState('all');
  const [catalogKindFilter, setCatalogKindFilter] = useState('all');
  const [catalogLicenseFilter, setCatalogLicenseFilter] = useState('all');
  const activity = useDashboardActivity();
  const { actionPending, actionMessage, setActionMessage, lastActionFailed } = activity;
  const catalogs = useCatalogManagement(actions, activity);
  const {
    catalogCandidates,
    userCatalogs,
    catalogFreshness,
    catalogManagementIndex,
    setCatalogManagementIndex,
    checkCatalogFreshness,
  } = catalogs;
  const inspector = useInspection();
  const { inspection } = inspector;
  const operations = useResourceWorkflow(actions, resources, errors, activity, setScreenMode, inspector.open);
  const {
    installedResources,
    scanErrors,
    sourceVersionPicker,
    confirmation,
    actionFailure,
    openInstallOptions,
    openSourceVersions,
    runConfirmedAction,
    chooseConfirmation,
  } = operations;
  const [loadingFrame, setLoadingFrame] = useState(0);
  const loadingFrames = ['|', '/', '-', '\\'];
  const loading = actionPending || versionLabel === 'Checking version update';
  useEffect(() => {
    if (!loading) return;
    const timer = setInterval(() => setLoadingFrame((frame) => (frame + 1) % loadingFrames.length), 100);
    return () => clearInterval(timer);
  }, [loading]);
  const migrationScopes = [
    ...new Set(
      scanErrors
        .filter((error) => error.code === 'INVENTORY_MIGRATION_REQUIRED')
        .map((error) => error.scope)
        .filter((scope) => ['project', 'user'].includes(scope)),
    ),
  ];

  const inventoryLabels = inventoryCatalogLabels(installedResources, userCatalogs);
  const visibleInventory = filterInventory(
    installedResources,
    query,
    inventoryCatalogFilter,
    inventoryKindFilter,
    userCatalogs,
    inventoryLabels,
    inventoryLicenseFilter,
  );
  const activeInventoryIndex = Math.min(selectedIndex, Math.max(0, visibleInventory.length - 1));
  const selectedResource = visibleInventory[activeInventoryIndex];
  const candidates = catalogCandidates;
  const catalogFilters = {
    catalog: catalogSourceFilter,
    kind: catalogKindFilter,
    license: catalogLicenseFilter,
  };
  const resetCatalogLicenseFilter = () => setCatalogLicenseFilter('all');
  const visibleCatalog = filterCatalogResources(
    candidates,
    catalogQuery,
    catalogSourceFilter,
    catalogKindFilter,
    userCatalogs,
    {
      license: catalogLicenseFilter === 'all' ? undefined : catalogLicenseFilter,
    },
  );
  const activeCatalogIndex = Math.min(catalogIndex, Math.max(0, visibleCatalog.length - 1));
  const controlSection: DashboardSection =
    screenMode === 'catalog-management'
      ? 'catalogs'
      : screenMode === 'catalog' || screenMode === 'install-options'
        ? 'browse'
        : 'inventory';
  const selectedCandidate = visibleCatalog[activeCatalogIndex];
  const candidateInstalledScopes = selectedCandidate
    ? installedResources
        .filter(
          (resource) =>
            resource.managed !== false &&
            resource.catalog === selectedCandidate.catalog &&
            resource.kind === selectedCandidate.kind &&
            resource.id === selectedCandidate.id,
        )
        .map((resource) => resource.scope)
    : [];
  const inventoryControlsFilters: DashboardControlFilter[] = [
    {
      id: 'kind',
      value: inventoryKindFilter,
      options: inventoryFilterOptions(
        installedResources,
        'kind',
        inventoryCatalogFilter,
        inventoryKindFilter,
        inventoryLicenseFilter,
        userCatalogs,
      ),
    },
    {
      id: 'catalog',
      value: inventoryCatalogFilter,
      options: inventoryFilterOptions(
        installedResources,
        'catalog',
        inventoryCatalogFilter,
        inventoryKindFilter,
        inventoryLicenseFilter,
        userCatalogs,
      ),
    },
    {
      id: 'license',
      value: inventoryLicenseFilter,
      options: inventoryFilterOptions(
        installedResources,
        'license',
        inventoryCatalogFilter,
        inventoryKindFilter,
        inventoryLicenseFilter,
        userCatalogs,
      ),
    },
  ];
  const browseControlsFilters: DashboardControlFilter[] = [
    {
      id: 'kind',
      value: catalogKindFilter,
      options: catalogFilterOptions(candidates, 'kind', catalogFilters, userCatalogs),
    },
    {
      id: 'catalog',
      value: catalogSourceFilter,
      options: catalogFilterOptions(candidates, 'catalog', catalogFilters, userCatalogs),
    },
    {
      id: 'license',
      value: catalogLicenseFilter,
      options: catalogFilterOptions(candidates, 'license', catalogFilters, userCatalogs),
    },
  ];
  const controlActions: DashboardControlButton[] =
    controlSection === 'inventory'
      ? [
          ...(selectedResource &&
          selectedResource.managed !== false &&
          dashboardStatus(selectedResource) === 'update' &&
          actions.execute
            ? [{ id: 'update', label: 'Update resource' }]
            : []),
          ...(selectedResource && actions.execute
            ? [{ id: 'remove', label: selectedResource.managed === false ? 'Remove' : 'Uninstall' }]
            : []),
          ...(actions.execute &&
          selectedResource?.scope &&
          (selectedResource.managed === false
            ? Boolean(selectedResource.paths?.length)
            : Boolean(selectedResource.source_repository && selectedResource.source_path))
            ? [{ id: 'preview', label: 'Preview / audit' }]
            : []),
          ...(selectedResource?.managed !== false &&
          selectedResource?.source_repository &&
          selectedResource?.source_path &&
          actions.listSourceVersions &&
          actions.execute
            ? [{ id: 'revision', label: 'Revisions' }]
            : []),
        ]
      : controlSection === 'browse'
        ? [
            ...(selectedCandidate && actions.execute ? [{ id: 'install', label: 'Install resource' }] : []),
            ...(selectedCandidate && actions.execute ? [{ id: 'preview', label: 'Preview / audit' }] : []),
            ...(selectedCandidate?.source_repository &&
            selectedCandidate?.source_path &&
            actions.listSourceVersions &&
            actions.execute
              ? [{ id: 'revision', label: 'Revisions' }]
              : []),
            ...(candidateInstalledScopes.length && actions.listSourceVersions && actions.execute
              ? [{ id: 'update', label: 'Update resource' }]
              : []),
          ]
        : [
            ...(actions.addCatalog
              ? [
                  { id: 'add-catalog', label: 'Add catalog' },
                  { id: 'presets', label: 'Presets' },
                ]
              : []),
            ...(userCatalogs.length && actions.updateCatalog ? [{ id: 'edit-catalog', label: 'Edit' }] : []),
            ...(userCatalogs.length && actions.refreshCatalog ? [{ id: 'refresh-catalog', label: 'Refresh' }] : []),
            ...(userCatalogs.length && actions.removeCatalog ? [{ id: 'remove-catalog', label: 'Remove' }] : []),
            ...(actions.transferCatalogs
              ? [
                  { id: 'import-catalogs', label: 'Import' },
                  { id: 'export-catalogs', label: 'Export' },
                ]
              : []),
          ];
  const controlsBase: Omit<ControlsProps, 'modalActive'> = {
    columns,
    rows,
    section: controlSection,
    sectionCounts: {
      inventory: installedResources.length,
      browse: candidates.length,
      catalogs: userCatalogs.length,
    },
    focus: controlFocus,
    query: controlSection === 'browse' ? catalogQuery : query,
    searchActive: controlSection === 'browse' ? catalogFilterMode : controlSection === 'inventory' ? filterMode : false,
    showSearch: controlSection !== 'catalogs',
    actionsInToolbar: !showDetails,
    ...(controlSection === 'inventory'
      ? { filters: inventoryControlsFilters }
      : controlSection === 'browse'
        ? { filters: browseControlsFilters }
        : {}),
    menuFilter: filterMenu,
    menuOptions: filterMenu
      ? (controlSection === 'inventory' ? inventoryControlsFilters : browseControlsFilters).find(
          ({ id }) => id === filterMenu,
        )?.options || []
      : [],
    menuIndex: filterMenuIndex,
    actions: controlActions,
    actionIndex: controlActionIndex,
    mouse,
  };
  const headerVersionLabel = loading
    ? `${loadingFrames[loadingFrame]} ${actionPending ? actionMessage || 'Loading' : versionLabel}`
    : versionLabel;

  const navigateToSection = (section: DashboardSection) => {
    setFilterMenu(null);
    setFilterMode(false);
    setCatalogFilterMode(false);
    setControlFocus('list');
    const destination = section === 'inventory' ? 'inventory' : section === 'browse' ? 'catalog' : 'catalog-management';
    setScreenMode(destination);
    if (section === 'catalogs' && screenMode !== destination) void checkCatalogFreshness();
  };
  const currentFilterValue = (filter: DashboardFilter) =>
    controlSection === 'inventory'
      ? filter === 'catalog'
        ? inventoryCatalogFilter
        : filter === 'kind'
          ? inventoryKindFilter
          : inventoryLicenseFilter
      : filter === 'catalog'
        ? catalogSourceFilter
        : filter === 'kind'
          ? catalogKindFilter
          : catalogLicenseFilter;
  const openFilterMenu = (filter: DashboardFilter) => {
    const options = (controlSection === 'inventory' ? inventoryControlsFilters : browseControlsFilters).find(
      ({ id }) => id === filter,
    )?.options || ['all'];
    setFilterMenu(filter);
    setFilterMenuIndex(Math.max(0, options.indexOf(currentFilterValue(filter))));
    setControlFocus(filter);
    setFilterMode(false);
    setCatalogFilterMode(false);
  };
  const chooseFilterValue = (filter: DashboardFilter, value: string) => {
    if (controlSection === 'inventory') {
      if (filter === 'catalog') setInventoryCatalogFilter(value);
      else if (filter === 'kind') setInventoryKindFilter(value);
      else setInventoryLicenseFilter(value);
      setSelectedIndex(0);
    } else if (filter === 'catalog') {
      setCatalogSourceFilter(value);
      resetCatalogLicenseFilter();
      setCatalogIndex(0);
    } else if (filter === 'kind') {
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
  const activateControlAction = (action: string) => {
    if (controlSection === 'inventory') {
      if (action === 'preview' && selectedResource)
        void runConfirmedAction({ action: 'preview', resource: selectedResource });
      else if (action === 'revision' && selectedResource) void openSourceVersions(selectedResource, 'update');
      else if (
        action === 'update' &&
        selectedResource &&
        selectedResource.managed !== false &&
        dashboardStatus(selectedResource) === 'update'
      ) {
        operations.requestConfirmation({ action: 'update', resource: selectedResource }, 1);
      } else if (action === 'remove' && selectedResource) {
        operations.requestConfirmation({
          action: selectedResource.managed === false ? 'remove-unmanaged' : 'uninstall',
          resource: selectedResource,
        });
      }
      return;
    }
    if (controlSection === 'browse' && selectedCandidate) {
      if (action === 'install') openInstallOptions(selectedCandidate);
      else if (action === 'preview') void runConfirmedAction({ action: 'preview', resource: selectedCandidate });
      else if (action === 'revision' || action === 'update') {
        const replacementScope = candidateInstalledScopes.length === 1 ? candidateInstalledScopes[0] : null;
        void openSourceVersions(
          replacementScope ? { ...selectedCandidate, scope: replacementScope } : selectedCandidate,
          replacementScope ? 'update' : 'install',
        );
      }
      return;
    }
    if (controlSection !== 'catalogs') return;
    catalogs.activateAction(action);
  };
  const handleMouseTarget = (target: DashboardMouseTarget) => {
    if (target.type === 'modal-choice') {
      if (confirmation) chooseConfirmation(target.index);
      return;
    }
    if (target.type === 'modal-option') {
      if (screenMode === 'install-options') operations.chooseOption(target.group, target.index);
      return;
    }
    if (
      actionPending ||
      inspection ||
      actionFailure ||
      confirmation ||
      catalogs.active ||
      sourceVersionPicker ||
      versionNotice ||
      tourStep !== null ||
      migrationScopes.length ||
      screenMode === 'install-options'
    )
      return;
    if (target.type === 'section') navigateToSection(target.section);
    else if (target.type === 'focus') {
      setControlFocus(target.focus);
      setFilterMenu(null);
      setFilterMode(target.focus === 'search' && controlSection === 'inventory');
      setCatalogFilterMode(target.focus === 'search' && controlSection === 'browse');
    } else if (target.type === 'filter-open') openFilterMenu(target.filter);
    else if (target.type === 'filter-option') chooseFilterValue(target.filter, target.value);
    else if (target.type === 'filter-dismiss') {
      setFilterMenu(null);
      setControlFocus(target.filter);
    } else if (target.type === 'row') {
      if (target.screen === 'inventory') setSelectedIndex(target.index);
      else if (target.screen === 'browse') setCatalogIndex(target.index);
      else setCatalogManagementIndex(target.index);
      setFilterMenu(null);
      setFilterMode(false);
      setCatalogFilterMode(false);
      setControlFocus('list');
    } else if (target.type === 'action') activateControlAction(target.action);
  };
  mouse?.setHandler(handleMouseTarget);
  const controlFocusOrder: DashboardControlFocus[] = [
    'tabs',
    ...(controlsBase.showSearch ? ['search' as const] : []),
    ...(controlsBase.filters || []).map(({ id }) => id),
    ...(controlActions.length ? ['actions' as const] : []),
    'list',
  ];
  const moveControlFocus = (backwards = false) => {
    const index = controlFocusOrder.indexOf(controlFocus);
    const offset = backwards ? -1 : 1;
    const next = controlFocusOrder[(index + offset + controlFocusOrder.length) % controlFocusOrder.length];
    setControlFocus(next);
    setFilterMenu(null);
    setFilterMode(next === 'search' && controlSection === 'inventory');
    setCatalogFilterMode(next === 'search' && controlSection === 'browse');
    if (next === 'actions')
      setControlActionIndex((current) => Math.min(current, Math.max(0, controlActions.length - 1)));
  };

  useInput((input, key) => {
    const character = input.toLocaleLowerCase();
    if (actionPending) return;
    if (sourceVersionPicker) {
      operations.handleVersionInput(input, key);
      return;
    }
    if (inspection) {
      inspector.handleInput(input, key, columns, rows);
      return;
    }
    if (actionFailure) {
      if (key.return || key.escape || input === ' ') operations.dismissFailure();
      return;
    }
    if (migrationScopes.length) {
      if (key.return || key.escape || (key.ctrl && character === 'c')) onFinish(false);
      return;
    }
    if (versionNotice) {
      if (key.return || key.escape || input === ' ') setVersionNotice(null);
      return;
    }
    const activeTourStep = tourStepRef.current;
    if (activeTourStep !== null) {
      if (key.escape) {
        tourStepRef.current = null;
        setTourStep(null);
        setScreenMode('inventory');
      } else if (key.leftArrow) {
        const previous = Math.max(0, activeTourStep - 1);
        tourStepRef.current = previous;
        setTourStep(previous);
        setScreenMode(previous === 0 ? 'inventory' : previous === 1 ? 'catalog' : 'catalog-management');
      } else if (key.return || key.rightArrow || input === ' ') {
        if (activeTourStep === 2) {
          tourStepRef.current = null;
          setTourStep(null);
          setScreenMode('inventory');
        } else {
          const next = activeTourStep + 1;
          tourStepRef.current = next;
          setTourStep(next);
          setScreenMode(next === 1 ? 'catalog' : 'catalog-management');
        }
      }
      return;
    }
    if (character === '?' && !filterMode && !catalogFilterMode) {
      tourStepRef.current = 0;
      setTourStep(0);
      setScreenMode('inventory');
      return;
    }
    if (!catalogs.active && character === 'm' && screenMode === 'inventory' && !filterMode) {
      navigateToSection('catalogs');
      return;
    }
    if (catalogs.active) {
      catalogs.handleInput(input, key);
      return;
    }
    if (screenMode === 'catalog-management' && catalogs.handleShortcut(input, key)) return;

    if (confirmation) {
      operations.handleConfirmationInput(input, key);
      return;
    }
    if (actionPending) return;
    if (filterMenu) {
      const options = controlsBase.filters?.find(({ id }) => id === filterMenu)?.options || [];
      if (key.tab || input === '\t') moveControlFocus(key.shift);
      else if (key.escape) setFilterMenu(null);
      else if ((key.upArrow || key.downArrow) && options.length) {
        setFilterMenuIndex(cycleIndex(options.length, filterMenuIndex, key.downArrow ? 1 : -1));
      } else if ((key.return || input === ' ') && options.length) {
        chooseFilterValue(filterMenu, options[Math.min(filterMenuIndex, options.length - 1)]);
      }
      return;
    }
    if ((key.tab || input === '\t') && screenMode !== 'install-options') {
      moveControlFocus(key.shift);
      return;
    }
    if (controlFocus === 'tabs' && (key.leftArrow || key.rightArrow)) {
      const index = ['inventory', 'browse', 'catalogs'].indexOf(controlSection);
      const next = ['inventory', 'browse', 'catalogs'][(index + (key.rightArrow ? 1 : 2)) % 3] as DashboardSection;
      navigateToSection(next);
      return;
    }
    if (
      (controlFocus === 'catalog' || controlFocus === 'kind' || controlFocus === 'license') &&
      controlsBase.filters?.some(({ id }) => id === controlFocus) &&
      (key.return || input === ' ')
    ) {
      openFilterMenu(controlFocus);
      return;
    }
    if (controlFocus === 'actions' && controlActions.length) {
      if (key.leftArrow || key.rightArrow) {
        setControlActionIndex(cycleIndex(controlActions.length, controlActionIndex, key.rightArrow ? 1 : -1));
        return;
      }
      if (key.return || input === ' ') {
        const action = controlActions[controlActionIndex];
        if (action) activateControlAction(action.id);
        return;
      }
    }
    const activeFilter = screenMode === 'catalog' ? catalogFilterMode : screenMode === 'inventory' && filterMode;
    if ((key.ctrl && character === 'c') || (character === 'q' && !activeFilter)) {
      onFinish(!lastActionFailed);
      return;
    }

    const destination = !activeFilter && screenMode !== 'install-options' ? sectionScreens[character] : undefined;
    if (destination) {
      navigateToSection(destination === 'inventory' ? 'inventory' : destination === 'catalog' ? 'browse' : 'catalogs');
      return;
    }

    if (screenMode === 'catalog') {
      if (catalogFilterMode) {
        if (key.return) {
          setCatalogFilterMode(false);
          setControlFocus('list');
        } else if (key.escape) {
          setCatalogFilterMode(false);
          setCatalogQuery('');
          resetCatalogLicenseFilter();
          setCatalogIndex(0);
          setControlFocus('list');
        } else if (key.upArrow) setCatalogIndex(cycleIndex(visibleCatalog.length, activeCatalogIndex, -1));
        else if (key.downArrow) setCatalogIndex(cycleIndex(visibleCatalog.length, activeCatalogIndex, 1));
        else if (key.backspace || key.delete) {
          setCatalogQuery((value) => Array.from(value).slice(0, -1).join(''));
          setCatalogIndex(0);
        } else if (input && !key.ctrl && !key.meta && input >= ' ') {
          setCatalogQuery((value) => value + input);
          setCatalogIndex(0);
        }
      } else if (key.escape) {
        navigateToSection('inventory');
      } else if (character === 'd') {
        setShowDetails((value) => !value);
      } else if (character === 'f') {
        setCatalogFilterMode(true);
        setControlFocus('search');
      } else if (character === 'c') {
        setCatalogSourceFilter(
          cycleCatalogFilter(catalogSourceFilter, candidates, 'catalog', catalogFilters, userCatalogs),
        );
        resetCatalogLicenseFilter();
        setCatalogIndex(0);
      } else if (character === 'k') {
        setCatalogKindFilter(cycleCatalogFilter(catalogKindFilter, candidates, 'kind', catalogFilters, userCatalogs));
        setCatalogLicenseFilter('all');
        setCatalogIndex(0);
      } else if (character === 'l') {
        setCatalogLicenseFilter(
          cycleCatalogFilter(catalogLicenseFilter, candidates, 'license', catalogFilters, userCatalogs),
        );
        setCatalogIndex(0);
      } else if (character === 'v') {
        const resource = visibleCatalog[activeCatalogIndex];
        if (resource?.source_repository && resource.source_path) {
          const installedScopes = ['project', 'user'].filter((scope) =>
            installedResources.some(
              (installed) =>
                installed.scope === scope &&
                installed.catalog === resource.catalog &&
                installed.kind === resource.kind &&
                installed.id === resource.id,
            ),
          );
          const replacementScope = installedScopes.length === 1 ? installedScopes[0] : null;
          openSourceVersions(
            replacementScope ? { ...resource, scope: replacementScope } : resource,
            replacementScope ? 'update' : 'install',
          );
        }
      } else if (character === 'p') {
        const resource = visibleCatalog[activeCatalogIndex];
        if (resource) void runConfirmedAction({ action: 'preview', resource });
      } else if (key.upArrow) setCatalogIndex(cycleIndex(visibleCatalog.length, activeCatalogIndex, -1));
      else if (key.downArrow) setCatalogIndex(cycleIndex(visibleCatalog.length, activeCatalogIndex, 1));
      else if (key.return && visibleCatalog[activeCatalogIndex]) {
        const resource = visibleCatalog[activeCatalogIndex];
        openInstallOptions(resource);
      }
      return;
    }

    if (screenMode === 'install-options') {
      operations.handleOptionsInput(input, key);
      return;
    }
    if (screenMode === 'catalog-management') {
      if (key.escape) setScreenMode('inventory');
      else if (character === 'd') setShowDetails((value) => !value);
      else if (key.upArrow || key.downArrow) {
        setCatalogManagementIndex(cycleIndex(userCatalogs.length, catalogManagementIndex, key.downArrow ? 1 : -1));
      }
      return;
    }

    if (filterMode) {
      if (key.return) {
        setFilterMode(false);
        setControlFocus('list');
      } else if (key.escape) {
        setFilterMode(false);
        setQuery('');
        setSelectedIndex(0);
        setControlFocus('list');
      } else if (key.upArrow) setSelectedIndex(cycleIndex(visibleInventory.length, activeInventoryIndex, -1));
      else if (key.downArrow) setSelectedIndex(cycleIndex(visibleInventory.length, activeInventoryIndex, 1));
      else if (key.backspace || key.delete) {
        setQuery((value) => Array.from(value).slice(0, -1).join(''));
        setSelectedIndex(0);
      } else if (input && !key.ctrl && !key.meta && input >= ' ') {
        setQuery((value) => value + input);
        setSelectedIndex(0);
      }
      return;
    }
    if (key.escape) {
      onFinish(!lastActionFailed);
    } else if (key.upArrow) setSelectedIndex(cycleIndex(visibleInventory.length, activeInventoryIndex, -1));
    else if (key.downArrow) setSelectedIndex(cycleIndex(visibleInventory.length, activeInventoryIndex, 1));
    else if (character === 'd') setShowDetails((value) => !value);
    else if (character === 'f') {
      setFilterMode(true);
      setControlFocus('search');
    } else if (character === 'm') {
      setScreenMode('catalog-management');
      setCatalogManagementIndex(0);
    } else if (character === 'c') {
      setInventoryCatalogFilter(
        cycleFilter(inventoryCatalogFilter, installedResources, 'catalog', 'kind', inventoryKindFilter, userCatalogs),
      );
      setSelectedIndex(0);
    } else if (character === 'k') {
      setInventoryKindFilter(
        cycleFilter(inventoryKindFilter, installedResources, 'kind', 'catalog', inventoryCatalogFilter, userCatalogs),
      );
      setSelectedIndex(0);
    } else if (character === 'l') {
      setInventoryLicenseFilter(
        cycleInventoryLicense(
          inventoryLicenseFilter,
          installedResources,
          inventoryCatalogFilter,
          inventoryKindFilter,
          userCatalogs,
        ),
      );
      setSelectedIndex(0);
    } else if (
      character === 'p' &&
      selectedResource &&
      selectedResource.scope &&
      (selectedResource.managed === false
        ? Boolean(selectedResource.paths?.length)
        : Boolean(selectedResource.source_repository && selectedResource.source_path))
    ) {
      void runConfirmedAction({ action: 'preview', resource: selectedResource });
    } else if (
      character === 'v' &&
      selectedResource &&
      selectedResource.managed !== false &&
      selectedResource.source_repository &&
      selectedResource.source_path &&
      typeof actions.listSourceVersions === 'function'
    ) {
      openSourceVersions(selectedResource, 'update');
    } else if (character === 'a' && candidates.length) {
      setScreenMode('catalog');
      setCatalogQuery('');
      resetCatalogLicenseFilter();
      setCatalogIndex(0);
      setCatalogFilterMode(false);
      setActionMessage('');
    } else if (
      character === 'u' &&
      selectedResource &&
      selectedResource.managed !== false &&
      dashboardStatus(selectedResource) === 'update' &&
      typeof actions.execute === 'function'
    ) {
      operations.requestConfirmation({ action: 'update', resource: selectedResource }, 1);
    } else if ((key.delete || (key.backspace && !query)) && selectedResource && typeof actions.execute === 'function') {
      operations.requestConfirmation({
        action: selectedResource.managed === false ? 'remove-unmanaged' : 'uninstall',
        resource: selectedResource,
      });
    } else if (key.backspace && query) {
      setFilterMode(true);
      setQuery((value) => Array.from(value).slice(0, -1).join(''));
      setSelectedIndex(0);
    }
  });

  let baseScreen;
  let modal = null;
  if (migrationScopes.length) {
    modal = inventoryMigrationModal({ scopes: migrationScopes, columns });
  } else if (catalogs.active) {
    modal = catalogs.modal(columns);
  } else {
    modal = operations.modal(columns, rows, screenMode === 'install-options');
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
  } else if (screenMode === 'catalog-management') {
    baseScreen = h(CatalogManagementScreen, {
      catalogs: userCatalogs,
      catalogResources: candidates,
      installedResources,
      selectedIndex: catalogManagementIndex,
      freshness: catalogFreshness,
      canAdd: typeof actions.addCatalog === 'function',
      canRemove: typeof actions.removeCatalog === 'function' && userCatalogs.length > 0,
      canEdit: typeof actions.updateCatalog === 'function' && userCatalogs.length > 0,
      canRefresh: typeof actions.refreshCatalog === 'function' && userCatalogs.length > 0,
      canTransfer: typeof actions.transferCatalogs === 'function',
      versionLabel: headerVersionLabel,
      showDetails,
      columns,
      rows,
      controls: { ...controlsBase, modalActive: screenModalActive },
      modalActive: screenModalActive,
      tourStep,
    });
  } else if (screenMode === 'catalog' || screenMode === 'install-options') {
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
      screenName: screenMode === 'install-options' ? 'INSTALL OPTIONS' : 'INSTALL FROM CATALOG',
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
      canExecute: typeof actions.execute === 'function' && Boolean(selectedResource),
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
      message: actionMessage || 'Loading...',
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
  actions: DashboardActions = {},
): Promise<boolean> {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') return false;

  return new Promise((resolve, reject) => {
    const transport = createDashboardInputTransport(input, output);
    let app: ReturnType<typeof render> | undefined;
    let finished = false;
    const onFinish = (success: boolean) => {
      if (finished) return;
      finished = true;
      input.removeListener('close', onInputClose);
      try {
        app?.unmount();
      } finally {
        transport.dispose();
        resolve(success);
      }
    };
    const onInputClose = () => onFinish(false);
    input.once('close', onInputClose);
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
      input.removeListener('close', onInputClose);
      finished = true;
      transport.dispose();
      reject(error);
      return;
    }
    app.waitUntilExit().catch((error) => {
      if (!finished) {
        input.removeListener('close', onInputClose);
        finished = true;
        try {
          app.unmount();
        } finally {
          transport.dispose();
          reject(error);
        }
      }
    });
  });
}
