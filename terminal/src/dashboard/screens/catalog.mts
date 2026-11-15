"use strict";

import React from "react";
import { Box, Text } from "ink";
import type { CatalogResource } from "../../catalog/entries.js";
import { adaptiveColumnWidths } from "../../table-layout.js";
import { DASHBOARD_THEME, resolveRowColor } from "../colors.js";
import type { InventoryCatalogConfiguration } from "../helpers.mjs";
import { filterCatalogResources, fitText, inventoryCatalogLabels, tableLine } from "../helpers.mjs";
import { detailField } from "../components/detail-fields.mjs";
import { DASHBOARD_HEADER_ROWS } from "../components/dashboard-header.mjs";
import { categorizedShortcutLines, shortcutFooterLines } from "../components/shortcuts/shortcut-lines.mjs";
import { DashboardHeader } from "../components/dashboard-header.mjs";
import { JoinedWorkspace } from "../components/joined-workspace.mjs";
import { ResourceBrowserChrome, resourceBrowserPlan } from "../components/resource-browser.mjs";
import { resourceTableRows, resourceTableWindow } from "../components/resource-table.mjs";
import { SelectionDetails, useDashboardDetailPaging } from "../components/selection-details.mjs";
import { ShortcutFooter } from "../components/shortcuts/shortcut-footer.mjs";
import { Controls } from "../controls.mjs";
import type { ControlsProps } from "../components/controls/control-layout-plan.mjs";
import { ActionButtons } from "../components/controls/action-rows.mjs";
const h = React.createElement;
export function CatalogScreen({
  candidates,
  resources,
  catalogs,
  query,
  filterMode,
  catalogFilter,
  kindFilter,
  licenseFilter,
  selectedIndex,
  versionLabel,
  screenName,
  showDetails,
  columns,
  rows,
  controls,
  modalActive = false,
  tourStep,
}: {
  candidates: CatalogResource[];
  resources: CatalogResource[];
  catalogs: InventoryCatalogConfiguration[];
  query: string;
  filterMode: boolean;
  catalogFilter: string;
  kindFilter: string;
  licenseFilter: string;
  selectedIndex: number;
  versionLabel: string;
  screenName: string;
  showDetails: boolean;
  columns: number;
  rows: number;
  controls: ControlsProps;
  modalActive?: boolean;
  tourStep?: number | null;
}) {
  const candidateLabels = inventoryCatalogLabels(candidates, catalogs);
  const candidateLabel = (resource: CatalogResource) =>
    resource.managed === false || !resource.source_repository
      ? resource.catalog || "-"
      : candidateLabels.get(resource) || resource.catalog || "-";
  const visible = filterCatalogResources(candidates, query, catalogFilter, kindFilter, catalogs, {
    license: licenseFilter === "all" ? undefined : licenseFilter,
  });
  const activeIndex = Math.min(selectedIndex, Math.max(0, visible.length - 1));
  const selected = visible[activeIndex];
  const detailPagingFocus = !modalActive && !filterMode && !controls.menuFilter &&
    (controls.focus === "list" || controls.focus === "actions");
  const catalogShortcutLines = modalActive || screenName === "INSTALL OPTIONS"
    ? []
    : filterMode
      ? categorizedShortcutLines({
        Filters: ["TYPE to search", "BACKSPACE edit", "ENTER apply", "ESC clear"],
        Navigation: ["↑↓ navigate"],
      })
      : categorizedShortcutLines({
        Actions: ["ENTER install", "V revisions", "P preview/audit"],
        Filters: ["F filter", "C catalog", "K kind", "L license"],
        Display: ["D details"],
        Navigation: ["1/2/3 sections · ESC back", "↑↓ navigate",
          ...(showDetails && selected && detailPagingFocus ? ["PgUp/PgDn details"] : []), "? guide", "Q quit"],
      });
  const footerRows = shortcutFooterLines(catalogShortcutLines, columns - 2).length +
    Number(Boolean(catalogShortcutLines.length));
  const browserPlan = resourceBrowserPlan({
    controls, modalActive, columns, rows, warningRows: 0, footerRows, showDetails,
  });
  const {
    controlsState, workspaceGap, workspaceHeight, outerWorkspaceWidth, actionRows, workspaceLayout,
    listContentWidth, detailsContentWidth,
  } = browserPlan;
  const footer = catalogShortcutLines.length
    ? h(ShortcutFooter, { lines: catalogShortcutLines, width: columns - 2 })
    : null;
  const visibleSourceWidth = visible.reduce((width, resource) => Math.max(width, candidateLabel(resource).length), 8);
  const visibleIdWidth = visible.reduce((width, resource) => Math.max(width, resource.id.length), 8);
  const compactTable = listContentWidth < 58;
  const ultraCompactTable = listContentWidth < 28;
  const widths = ultraCompactTable
    ? [0, listContentWidth, 0, 0, 0]
    : adaptiveColumnWidths(listContentWidth, [
      { contentWidth: 2, minWidth: compactTable ? 1 : 2, maxWidth: 2, shrinkWeight: 0 },
      { contentWidth: Math.max(12, visibleIdWidth), minWidth: compactTable ? 4 : 8, growWeight: 4 },
      { contentWidth: compactTable ? 5 : 11, minWidth: compactTable ? 3 : 5, growWeight: 1 },
      { contentWidth: Math.max(8, visibleSourceWidth), minWidth: compactTable ? 5 : 8, growWeight: 2 },
      { contentWidth: compactTable ? 8 : 10, minWidth: compactTable ? 4 : 6, growWeight: 1 },
    ]);
  const tableWindow = resourceTableWindow<CatalogResource>(visible, activeIndex, workspaceLayout.listRows);
  const [markerWidth, resourceWidth, kindWidth, catalogWidth, installedWidth] = widths;
  const tableHeader = ultraCompactTable
    ? fitText("RESOURCE", listContentWidth)
    : tableLine([
      ["", markerWidth],
      ["RESOURCE", resourceWidth],
      ["KIND", kindWidth],
      ["CATALOG", catalogWidth],
      ["INSTALLED", installedWidth],
    ]);
  const installedScopesFor = (resource: CatalogResource) => resources.filter((entry) =>
    entry.catalog === resource.catalog && entry.kind === resource.kind && entry.id === resource.id,
  ).map((entry) => entry.scope);
  const tableRows = resourceTableRows({
    window: tableWindow,
    selectedIndex: activeIndex,
    emptyMessage: "No matching catalog resources.",
    renderRow: (resource: CatalogResource, selectedRow: boolean) => {
      const scopes = installedScopesFor(resource);
      const installed = scopes.includes("project") && scopes.includes("user")
        ? "both"
        : scopes[0] || "no";
      const row = ultraCompactTable
        ? fitText(`${selectedRow ? "› " : ""}${resource.id}`, listContentWidth)
        : tableLine([
          [selectedRow ? "›" : "", markerWidth],
          [resource.id, resourceWidth],
          [resource.kind, kindWidth],
          [candidateLabel(resource), catalogWidth],
          [installed, installedWidth],
        ]);
      return {
        key: `${resource.catalog}:${resource.kind}:${resource.id}`,
        color: resolveRowColor(
          resource.kind, false, resource.license_status === "Proprietary"
            ? DASHBOARD_THEME.semantic.inventoryStatus.attention : undefined,
        ),
        text: row,
      };
    },
  });
  const installedScopes = selected ? installedScopesFor(selected) : [];
  const installedIn = installedScopes.includes("project") && installedScopes.includes("user")
    ? "both"
    : installedScopes[0] || "none";
  const description = selected?.description || "No description available.";
  const source = selected?.source_repository
    ? `${selected.source_repository}/${selected.source_path || "unknown"}@${selected.source_ref || "unknown"}`
    : undefined;
  const entryContent = selected
    ? SelectionDetails({
      kind: selected.kind,
      id: selected.id,
      description,
      width: detailsContentWidth,
      kindColor: resolveRowColor(selected.kind, false, selected.license_status === "Proprietary"
        ? DASHBOARD_THEME.semantic.inventoryStatus.attention : undefined),
      metadata: [
        ...detailField("catalog-entry-catalog", "CATALOG", candidateLabel(selected), detailsContentWidth, Infinity),
        h(Text, { key: "catalog-entry-license-gap" }, " "),
        ...detailField("catalog-entry-license", "LICENSE", selected.license_status || "not declared", detailsContentWidth, Infinity),
        h(Text, { key: "catalog-entry-installed-gap" }, " "),
        ...detailField("catalog-entry-installed", "INSTALLED IN", installedIn, detailsContentWidth, Infinity),
        ...(source ? [
          h(Text, { key: "catalog-entry-source-gap" }, " "),
          ...detailField("catalog-entry-source", "PINNED SOURCE", source, detailsContentWidth, Infinity),
        ] : []),
      ],
    })
    : [h(Text, {
      key: "catalog-entry-empty",
      color: DASHBOARD_THEME.semantic.accents.muted,
    }, "No matching catalog resources.")];
  const detailPaging = useDashboardDetailPaging({
    lines: entryContent,
    viewport: workspaceLayout.detailsContentRows,
    enabled: showDetails && !modalActive,
    filterMode,
    focus: controls.focus,
    menuFilter: controls.menuFilter,
    resetKey: [selected?.id, selected?.kind, query, catalogFilter, kindFilter, licenseFilter, columns, rows, showDetails],
  });
  const actionButtons = actionRows
    ? ActionButtons({ controls: controlsState, width: detailsContentWidth })
    : null;
  const workspaceTop = DASHBOARD_HEADER_ROWS + browserPlan.tabsHeight + browserPlan.summaryRows +
    browserPlan.filterHeight + workspaceGap + 1;
  const firstResourceRow = workspaceTop + workspaceLayout.firstResourceRowOffset;
  controls.mouse?.replace("browse-rows", modalActive ? [] : tableWindow.items.map((_, index) => ({
    left: 3,
    right: workspaceLayout.listWidth + 2,
    top: firstResourceRow + index,
    bottom: firstResourceRow + index,
    target: { type: "row" as const, screen: "browse" as const, index: tableWindow.first + index },
  })));
  return h(Box, { width: columns, height: rows, flexDirection: "column", paddingX: 1, position: "relative" },
    h(DashboardHeader, {
      versionLabel,
      screenName,
      metadata: `AVAILABLE ${visible.length}/${candidates.length} · CATALOG ${catalogFilter.toUpperCase()} · KIND ${kindFilter.toUpperCase()} · LICENSE ${licenseFilter.toUpperCase()}`,
      columns,
    }),
    h(ResourceBrowserChrome, { plan: browserPlan, resources, columns }),
    h(Box, { width: columns - 2, marginTop: workspaceGap },
      h(JoinedWorkspace, {
        width: outerWorkspaceWidth,
        height: workspaceHeight,
        layout: workspaceLayout,
        showDetails,
        listTitle: "CATALOG RESOURCES",
        listMeta: `${visible.length} results`,
        listHeader: tableHeader,
        listRows: tableRows,
        detailsTitle: "SELECTION DETAILS",
        details: detailPaging.visibleLines,
        detailsFooter: actionButtons,
        detailsHint: detailPaging.canPage ? "PgUp/PgDn" : undefined,
        color: tourStep === 1
          ? DASHBOARD_THEME.semantic.inventoryStatus.attention
          : DASHBOARD_THEME.semantic.accents.detailPanel,
      })),
    footer,
    controls.menuFilter ? h(Controls, { ...browserPlan.filterProps, menuOverlayOnly: true }) : null,
  );
}
