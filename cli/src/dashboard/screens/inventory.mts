"use strict";

import React from "react";
import { Box, Text } from "ink";
import type { CatalogResource } from "../../catalog/entries.js";
import type { ScanError } from "../../catalog/lifecycle.js";
import { adaptiveColumnWidths } from "../../table-layout.js";
import { DASHBOARD_THEME, resolveRowColor } from "../colors.js";
import type { InventoryCatalogConfiguration } from "../helpers.mjs";
import {
  colorForStatus, dashboardStatus, filterInventory, inventoryCatalogLabels, issueLine, tableLine, fitText, wrapText,
} from "../helpers.mjs";
import {
  categorizedShortcutLines, DashboardHeader, DASHBOARD_HEADER_ROWS, InventorySummaryCards, JoinedWorkspace, ShortcutFooter,
  detailLocations, joinedWorkspaceLayout, shortcutFooterLines, useDashboardDetailPaging,
} from "./shared.mjs";
import { DashboardActionButtons, dashboardActionButtonRows, DashboardControls, dashboardControlsLayout,
  type DashboardControlsProps } from "../controls.mjs";
const h = React.createElement;
export function InventoryScreen({
  resources,
  errors,
  query,
  filterMode,
  catalogFilter,
  kindFilter,
  licenseFilter = "all",
  selectedIndex,
  versionLabel,
  actionMessage,
  catalogAvailable,
  canExecute,
  showDetails,
  columns,
  rows,
  controls,
  modalActive = false,
  userCatalogs = [],
  inventoryLabels: suppliedInventoryLabels,
  tourStep,
}: {
  resources: CatalogResource[];
  errors: ScanError[];
  query: string;
  filterMode: boolean;
  catalogFilter: string;
  kindFilter: string;
  licenseFilter: string;
  selectedIndex: number;
  versionLabel: string;
  actionMessage: string;
  catalogAvailable: boolean;
  canExecute: boolean;
  showDetails: boolean;
  columns: number;
  rows: number;
  controls: DashboardControlsProps;
  modalActive?: boolean;
  userCatalogs?: InventoryCatalogConfiguration[];
  inventoryLabels?: Map<CatalogResource, string>;
  tourStep?: number | null;
}) {
  const inventoryLabels = suppliedInventoryLabels || inventoryCatalogLabels(resources, userCatalogs);
  const visible = filterInventory(resources, query, catalogFilter, kindFilter, userCatalogs, inventoryLabels, licenseFilter);
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
  const shortcutLines = modalActive ? [] : filterMode
    ? categorizedShortcutLines({
      Filters: ["TYPE to search", "BACKSPACE edit", "ENTER apply", "ESC clear"],
      Navigation: ["↑↓ navigate"],
    })
    : categorizedShortcutLines({
      Actions: [
        ...(catalogAvailable ? ["A install"] : []),
        ...(canExecute && selected && selected.scope && (
          selected.managed === false
            ? Boolean(selected.paths?.length)
            : Boolean(selected.source_repository && selected.source_path)
        ) ? ["P preview"] : []),
        ...(canExecute && selected && selected.managed !== false &&
            selected.source_repository && selected.source_path ? ["V revision"] : []),
        ...(canExecute && selected
          ? [selected.managed === false ? "Delete remove" : "U update · Delete uninstall"]
          : []),
      ],
      Filters: ["F filter", ...(resources.length ? ["C catalog", "K kind", "L license"] : [])],
      Display: ["D details"],
      Navigation: ["1/2/3 sections · M catalogs", "↑↓ navigate",
        ...(showDetails && selected && detailPagingFocus ? ["PgUp/PgDn details"] : []), "? guide", "Q quit"],
    });
  const footerRows = shortcutFooterLines(shortcutLines, columns - 2).length + Number(Boolean(shortcutLines.length));
  const warningLines = errors.flatMap((error) => wrapText(
    `${error.scope.toUpperCase()} · ${error.code}: ${error.message}`,
    Math.max(1, columns - 2),
  ));
  const warningBlockRows = warningLines.length ? warningLines.length + 1 : 0;
  const workspaceGap = 1;
  const workspaceHeight = Math.max(1, rows - (
    DASHBOARD_HEADER_ROWS + tabsLayout.height + summaryBlockRows + filterLayout.height + warningBlockRows +
    workspaceGap + footerRows
  ));
  const stackedWorkspace = columns < 94;
  const outerWorkspaceWidth = columns - 2;
  const initialWorkspaceLayout = joinedWorkspaceLayout(
    outerWorkspaceWidth, workspaceHeight, stackedWorkspace, showDetails, 0, 0.76,
  );
  const initialDetailsWidth = initialWorkspaceLayout.detailsWidth
    ? initialWorkspaceLayout.detailsWidth - 1
    : initialWorkspaceLayout.innerWidth - 1;
  const actionRows = dashboardActionButtonRows(controlsState, Math.max(1, initialDetailsWidth));
  const workspaceLayout = joinedWorkspaceLayout(
    outerWorkspaceWidth, workspaceHeight, stackedWorkspace, showDetails, actionRows, 0.76,
  );
  const listContentWidth = workspaceLayout.listWidth;
  const detailsContentWidth = Math.max(1, workspaceLayout.detailsWidth
    ? workspaceLayout.detailsWidth - 1
    : workspaceLayout.innerWidth - 1);
  const footer = !modalActive ? h(ShortcutFooter, { lines: shortcutLines, width: columns - 2 }) : null;
  const warnings = warningLines.length
    ? h(Box, { width: columns - 2, marginTop: 1, flexDirection: "column" },
      ...warningLines.map((line, index) => h(Text, {
        key: `inventory-warning-${index}`,
        color: DASHBOARD_THEME.semantic.inventoryStatus.attention,
      }, line)))
    : null;
  const visibleIds = visible.reduce((longest, resource) => Math.max(longest, String(resource.id || "").length), 8);
  const ultraCompactTable = listContentWidth < 28;
  const compactTable = listContentWidth < 58;
  const widths = ultraCompactTable
    ? [0, listContentWidth, 0, 0, 0]
    : adaptiveColumnWidths(listContentWidth, [
      { contentWidth: 2, minWidth: compactTable ? 1 : 2, maxWidth: 2, shrinkWeight: 0 },
      { contentWidth: Math.max(12, visibleIds), minWidth: compactTable ? 4 : 8, growWeight: 4 },
      { contentWidth: compactTable ? 5 : 11, minWidth: compactTable ? 3 : 5, growWeight: 1 },
      { contentWidth: compactTable ? 5 : 7, minWidth: compactTable ? 3 : 5, growWeight: 1 },
      { contentWidth: compactTable ? 8 : 17, minWidth: compactTable ? 4 : 6, growWeight: 2 },
    ]);
  const [markerWidth, resourceWidth, kindWidth, scopeWidth, statusWidth] = widths;
  const tableHeader = ultraCompactTable
    ? fitText("RESOURCE", listContentWidth)
    : tableLine([
      ["", markerWidth],
      ["RESOURCE", resourceWidth],
      ["KIND", kindWidth],
      ["SCOPE", scopeWidth],
      ["STATUS", statusWidth],
    ]);
  const first = Math.max(0, Math.min(activeIndex - workspaceLayout.listRows + 1, visible.length - workspaceLayout.listRows));
  const page = visible.slice(first, first + workspaceLayout.listRows);
  const tableRows = page.map((resource, index) => {
    const selectedRow = first + index === activeIndex;
    const status = dashboardStatus(resource);
    const row = ultraCompactTable
      ? fitText(`${selectedRow ? "› " : ""}${resource.id}`, listContentWidth)
      : tableLine([
        [selectedRow ? "›" : "", markerWidth],
        [resource.id, resourceWidth],
        [resource.kind, kindWidth],
        [resource.scope || "-", scopeWidth],
        [status ? status === "update" ? "Update available" : `${status[0].toUpperCase()}${status.slice(1)}` : "Current", statusWidth],
      ]);
    return h(Text, {
      key: `${resource.managed === false ? "unmanaged" : resource.catalog}:${resource.scope}:${resource.kind}:${resource.id}`,
      color: selectedRow ? DASHBOARD_THEME.semantic.selectedForeground : resolveRowColor(resource.kind, false, colorForStatus(status)),
      backgroundColor: selectedRow ? DASHBOARD_THEME.semantic.selected : undefined,
      bold: selectedRow,
    }, row);
  });
  if (!tableRows.length) tableRows.push(h(Text, { key: "inventory-empty", dimColor: true }, "No matching resources."));

  const detailFieldLines = (key: string, label: string, value: unknown, maxLines = 1,
    color: string = DASHBOARD_THEME.semantic.accents.muted) => {
    const labelText = `${label} `;
    const valueWidth = Math.max(1, detailsContentWidth - labelText.length);
    return wrapText(value, valueWidth, maxLines).map((line, index) => h(Text, {
      key: `${key}-${index}`,
    },
    h(Text, {
      color: DASHBOARD_THEME.semantic.accents.label,
      bold: true,
    }, index ? " ".repeat(labelText.length) : labelText),
    h(Text, { color }, fitText(line, valueWidth))));
  };
  const description = selected?.description || "No description available.";
  const selectedStatus = selected ? dashboardStatus(selected) || "current" : "";
  const statusLabel = selected?.managed === false ? "Unmanaged"
    : selectedStatus === "update" ? "Update available"
      : selectedStatus === "attention" ? "Warning" : "Current";
  const displayVersion = selected?.source_ref || (selected?.version ? selected.version.slice(0, 7) : "-");
  const installedPath = selected?.paths?.join(" · ") || selected?.source_path || "-";
  const sourceLocation = selected?.source_repository ? `https://github.com/${selected.source_repository}` : "";
  const selectedIssues = selected?.managed === false
    ? "Not managed by Kitia; removal requires two confirmations."
    : selected?.issues?.length
      ? selected.issues.map(issueLine).join(" · ")
      : "Healthy · no recorded issues";
  const detailRows = selected
    ? [
      h(Text, { key: "inventory-resource-title", bold: true }, `${selected.kind} · ${selected.id}`),
      ...detailFieldLines("inventory-description", "DESCRIPTION", description, Infinity),
      ...detailFieldLines("inventory-catalog", "CATALOG", inventoryLabels.get(selected) || selected.catalog || "-", Infinity),
      ...detailFieldLines("inventory-license", "LICENSE", selected.license_status || selected.license_spdx || "-", Infinity),
      ...detailFieldLines("inventory-status", "STATUS", statusLabel, Infinity, colorForStatus(selectedStatus)),
      ...(selectedIssues ? detailFieldLines("inventory-issues", "ISSUES", selectedIssues, Infinity) : []),
      ...detailFieldLines("inventory-revision", "REVISION", displayVersion, Infinity),
      ...detailFieldLines("inventory-path", "PATH", installedPath, Infinity),
      ...(sourceLocation ? [
        ...detailFieldLines("inventory-source-label", "SOURCE", selected.source_repository || "", Infinity),
        ...detailLocations("inventory-source", [{ text: sourceLocation, href: sourceLocation }], detailsContentWidth),
      ] : []),
      ...(selected.category ? detailFieldLines("inventory-category", "CATEGORY", selected.category, Infinity) : []),
      ...(selected.tags?.length ? detailFieldLines("inventory-tags", "TAGS", selected.tags.join(" · "), Infinity) : []),
      ...(selected.use_when ? detailFieldLines("inventory-use-when", "USE WHEN", selected.use_when, Infinity) : []),
      ...(selected.example ? detailFieldLines("inventory-example", "EXAMPLE", selected.example, Infinity) : []),
      ...(selected.prerequisites?.length
        ? detailFieldLines("inventory-prerequisites", "PREREQUISITES", selected.prerequisites.join(" · "), Infinity)
        : []),
      ...(selected.owner ? detailFieldLines("inventory-owner", "OWNER", selected.owner, Infinity) : []),
      ...(selected.expected_output
        ? detailFieldLines("inventory-expected-output", "EXPECTED OUTPUT", selected.expected_output, Infinity)
        : []),
      ...(selected.limitations?.length
        ? detailFieldLines("inventory-limitations", "LIMITATIONS", selected.limitations.join(" · "), Infinity)
        : []),
      ...(selected.deprecation_reason
        ? detailFieldLines("inventory-deprecation", "DEPRECATION", selected.deprecation_reason, Infinity)
        : []),
      ...(selected.replacement
        ? detailFieldLines("inventory-replacement", "REPLACEMENT", selected.replacement, Infinity)
        : []),
      ...((selected.apply_to || selected.applyTo)?.length
        ? detailFieldLines("inventory-apply-to", "APPLIES TO", (selected.apply_to || selected.applyTo)!.join(" · "), Infinity)
        : []),
      ...(actionMessage ? detailFieldLines("inventory-action", "MESSAGE", actionMessage, Infinity) : []),
    ]
    : [h(Text, {
      key: "inventory-empty-detail",
      color: DASHBOARD_THEME.semantic.accents.muted,
    }, errors.length
      ? "No resource selected; see scan warnings above."
      : resources.length ? "No matching resource selected." : "No resources found.")];
  const detailPaging = useDashboardDetailPaging({
    lines: detailRows,
    viewport: workspaceLayout.detailsContentRows,
    enabled: showDetails && !modalActive,
    filterMode,
    focus: controls.focus,
    menuFilter: controls.menuFilter,
    resetKey: [selected?.id, selected?.kind, selected?.scope, query, catalogFilter, kindFilter, licenseFilter, columns, rows, showDetails],
  });
  const actionButtons = actionRows
    ? DashboardActionButtons({ controls: controlsState, width: detailsContentWidth })
    : null;
  const workspaceTop = DASHBOARD_HEADER_ROWS + tabsLayout.height + summaryBlockRows + filterLayout.height +
    warningBlockRows + workspaceGap + 1;
  const firstResourceRow = workspaceTop + workspaceLayout.firstResourceRowOffset;
  controls.mouse?.replace("inventory-rows", modalActive ? [] : page.map((_, index) => ({
    left: 3,
    right: workspaceLayout.listWidth + 2,
    top: firstResourceRow + index,
    bottom: firstResourceRow + index,
    target: { type: "row" as const, screen: "inventory" as const, index: first + index },
  })));
  return h(Box, { width: columns, height: rows, flexDirection: "column", paddingX: 1, position: "relative" },
    h(DashboardHeader, {
      versionLabel,
      screenName: "INVENTORY",
      metadata: `RESOURCES ${visible.length}/${resources.length} · CATALOG ${catalogFilter.toUpperCase()} · KIND ${kindFilter.toUpperCase()} · LICENSE ${licenseFilter.toUpperCase()}`,
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
    warnings,
    h(Box, { width: columns - 2, marginTop: workspaceGap },
      h(JoinedWorkspace, {
        width: outerWorkspaceWidth,
        height: workspaceHeight,
        layout: workspaceLayout,
        showDetails,
        listTitle: "INSTALLED RESOURCES",
        listMeta: `${visible.length} results`,
        listHeader: tableHeader,
        listRows: tableRows,
        detailsTitle: "SELECTION DETAILS",
        details: detailPaging.visibleLines,
        detailsFooter: actionButtons,
        detailsHint: detailPaging.canPage ? "PgUp/PgDn" : undefined,
        color: tourStep === 0
          ? DASHBOARD_THEME.semantic.inventoryStatus.attention
          : DASHBOARD_THEME.semantic.accents.detailPanel,
      })),
    footer,
  );
}
