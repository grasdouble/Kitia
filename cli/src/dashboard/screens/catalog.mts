"use strict";

import React from "react";
import { Box, Text } from "ink";
import type { CatalogResource } from "../../catalog/entries.js";
import { adaptiveColumnWidths } from "../../table-layout.js";
import { DASHBOARD_THEME, resolveRowColor } from "../colors.js";
import type { InventoryCatalogConfiguration } from "../helpers.mjs";
import { filterCatalogResources, fitText, inventoryCatalogLabels, tableLine, wrapText } from "../helpers.mjs";
import {
  categorizedShortcutLines, DashboardHeader, DASHBOARD_HEADER_ROWS, InventorySummaryCards, JoinedWorkspace, ShortcutFooter,
  joinedWorkspaceLayout, shortcutFooterLines, useDashboardDetailPaging,
} from "./shared.mjs";
import { DashboardActionButtons, dashboardActionButtonRows, DashboardControls, dashboardControlsLayout,
  type DashboardControlsProps } from "../controls.mjs";
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
  controls: DashboardControlsProps;
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
  const controlsState = { ...controls, modalActive };
  const tabsProps = { ...controlsState, part: "tabs" as const, showSearch: false };
  const tabsLayout = dashboardControlsLayout(tabsProps);
  const ultraCompactSummary = rows < 40;
  const compactSummary = rows < 50 || columns < 76;
  const summaryBlockRows = ultraCompactSummary ? 1 : 1 + (compactSummary ? 3 : 4);
  const filterRowOffset = tabsLayout.height + summaryBlockRows;
  const filterProps = {
    ...controlsState,
    part: "filters" as const,
    layout: "toolbar" as const,
    rowOffset: filterRowOffset,
  };
  const filterLayout = dashboardControlsLayout(filterProps);
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
  const workspaceGap = 1;
  const workspaceHeight = Math.max(1, rows - (
    DASHBOARD_HEADER_ROWS + tabsLayout.height + summaryBlockRows + filterLayout.height + workspaceGap + footerRows
  ));
  const stackedWorkspace = columns < 94;
  const outerWorkspaceWidth = columns - 2;
  const initialWorkspaceLayout = joinedWorkspaceLayout(
    outerWorkspaceWidth, workspaceHeight, stackedWorkspace, showDetails, 0, 0.76,
  );
  const initialDetailsWidth = initialWorkspaceLayout.detailsWidth
    ? initialWorkspaceLayout.detailsWidth - 1
    : initialWorkspaceLayout.innerWidth - 1;
  const actionRows = showDetails ? dashboardActionButtonRows(controlsState, Math.max(1, initialDetailsWidth)) : 0;
  const workspaceLayout = joinedWorkspaceLayout(
    outerWorkspaceWidth, workspaceHeight, stackedWorkspace, showDetails, actionRows, 0.76,
  );
  const listContentWidth = workspaceLayout.listWidth;
  const detailsContentWidth = Math.max(1, workspaceLayout.detailsWidth
    ? workspaceLayout.detailsWidth - 1
    : workspaceLayout.innerWidth - 1);
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
  const first = Math.max(0, Math.min(activeIndex - workspaceLayout.listRows + 1, visible.length - workspaceLayout.listRows));
  const page = visible.slice(first, first + workspaceLayout.listRows);
  const installedScopesFor = (resource: CatalogResource) => resources.filter((entry) =>
    entry.catalog === resource.catalog && entry.kind === resource.kind && entry.id === resource.id,
  ).map((entry) => entry.scope);
  const tableRows = page.map((resource, index) => {
    const selectedRow = first + index === activeIndex;
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
    return h(Text, {
      key: `${resource.catalog}:${resource.kind}:${resource.id}`,
      color: selectedRow ? DASHBOARD_THEME.semantic.selectedForeground : resolveRowColor(
        resource.kind, false, resource.license_status === "Proprietary" ? DASHBOARD_THEME.semantic.inventoryStatus.attention : undefined,
      ),
      backgroundColor: selectedRow ? DASHBOARD_THEME.semantic.selected : undefined,
      bold: selectedRow,
    }, row);
  });
  if (!tableRows.length) tableRows.push(h(Text, { key: "catalog-empty", dimColor: true }, "No matching catalog resources."));

  const detailFieldLines = (key: string, label: string, value: unknown, maxLines = 1) => {
    const labelText = `${label} `;
    const valueWidth = Math.max(1, detailsContentWidth - labelText.length);
    return wrapText(value, valueWidth, maxLines).map((line, index) => h(Text, {
      key: `${key}-${index}`,
    },
    h(Text, { color: DASHBOARD_THEME.semantic.accents.label, bold: true },
      index ? " ".repeat(labelText.length) : labelText),
    h(Text, { color: DASHBOARD_THEME.semantic.accents.muted }, fitText(line, valueWidth))));
  };
  const installedScopes = selected ? installedScopesFor(selected).join(", ") || "none" : "none";
  const entryContent = selected
    ? [
      h(Text, { key: "catalog-entry-title", bold: true }, `${selected.kind} · ${selected.id}`),
      ...detailFieldLines("catalog-entry-description", "DESCRIPTION", selected.description || "No description available.", Infinity),
      ...detailFieldLines("catalog-entry-catalog", "CATALOG", candidateLabel(selected), Infinity),
      ...detailFieldLines("catalog-entry-license", "LICENSE", selected.license_status || "not declared", Infinity),
      ...detailFieldLines("catalog-entry-installed", "INSTALLED IN", installedScopes, Infinity),
      ...(selected.source_repository ? detailFieldLines(
        "catalog-entry-source",
        "PINNED SOURCE",
        `${selected.source_repository}/${selected.source_path || "unknown"}@${selected.source_ref || "unknown"}`,
        Infinity,
      ) : []),
    ]
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
    ? DashboardActionButtons({ controls: controlsState, width: detailsContentWidth })
    : null;
  const workspaceTop = DASHBOARD_HEADER_ROWS + tabsLayout.height + summaryBlockRows + filterLayout.height + workspaceGap + 1;
  const firstResourceRow = workspaceTop + workspaceLayout.firstResourceRowOffset;
  controls.mouse?.replace("browse-rows", modalActive ? [] : page.map((_, index) => ({
    left: 3,
    right: workspaceLayout.listWidth + 2,
    top: firstResourceRow + index,
    bottom: firstResourceRow + index,
    target: { type: "row" as const, screen: "browse" as const, index: first + index },
  })));
  return h(Box, { width: columns, height: rows, flexDirection: "column", paddingX: 1, position: "relative" },
    h(DashboardHeader, {
      versionLabel,
      screenName,
      metadata: `AVAILABLE ${visible.length}/${candidates.length} · CATALOG ${catalogFilter.toUpperCase()} · KIND ${kindFilter.toUpperCase()} · LICENSE ${licenseFilter.toUpperCase()}`,
      columns,
    }),
    h(DashboardControls, tabsProps),
    h(InventorySummaryCards, {
      resources,
      width: columns - 2,
      compact: compactSummary,
      ultraCompact: ultraCompactSummary,
      marginTop: ultraCompactSummary ? 0 : 1,
    }),
    h(DashboardControls, filterProps),
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
  );
}
