"use strict";

import React from "react";
import { Box, Text } from "ink";
import type { CatalogResource } from "../../catalog/entries.js";
import { DASHBOARD_THEME, resolveRowColor } from "../colors.js";
import type { InventoryCatalogConfiguration } from "../helpers.mjs";
import {
  catalogTableColumns, detailPanelLayout, filterCatalogResources, fitText, inventoryCatalogLabels, tableLine, wrapText,
} from "../helpers.mjs";
import {
  DashboardHeader, DetailsPanel, Panel, ShortcutsPanel, detailField, detailValue, wrappedShortcutLines,
} from "./shared.mjs";

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
  modalActive?: boolean;
  tourStep?: number | null;
}) {
  const candidateLabels = inventoryCatalogLabels(candidates, catalogs);
  const candidateLabel = (resource: CatalogResource) =>
    resource.managed === false || !resource.source_repository
      ? resource.catalog
      : candidateLabels.get(resource) || resource.catalog;
  const visible = filterCatalogResources(candidates, query, catalogFilter, kindFilter, catalogs, {
    license: licenseFilter === "all" ? undefined : licenseFilter,
  });
  const activeIndex = Math.min(selectedIndex, Math.max(0, visible.length - 1));
  const selected = visible[activeIndex];
  const panelLayout = detailPanelLayout(columns);
  const detailsSideBySide = showDetails && panelLayout.sideBySide;
  const listWidth = detailsSideBySide ? panelLayout.listWidth! : columns;
  const detailsWidth = detailsSideBySide ? panelLayout.detailsWidth! : columns;
  const contentWidth = Math.max(1, detailsSideBySide ? listWidth - 4 : columns - 6);
  const detailsContentWidth = Math.max(1, detailsSideBySide ? detailsWidth - 4 : columns - 6);
  const longestSource = visible.reduce((width, resource) =>
    Math.max(width, candidateLabel(resource).length), "SOURCE".length);
  const longestId = visible.reduce((width, resource) =>
    Math.max(width, resource.id.length), "ID".length);
  const longestKind = visible.reduce((width, resource) =>
    Math.max(width, resource.kind.length), "KIND".length);
  const columnsByField = catalogTableColumns(
    contentWidth, longestSource, longestId, longestKind,
  );
  const installedScopes = selected
    ? resources.filter((entry) =>
      entry.catalog === selected.catalog && entry.kind === selected.kind && entry.id === selected.id,
    ).map((entry) => entry.scope).join(", ") || "none"
    : "none";
  const detailRows = selected
    ? [
      { label: "CATALOG", value: candidateLabel(selected), maxLines: 1 },
      { label: "DESCRIPTION", value: selected.description || "No description available.", maxLines: Infinity },
      { label: "INSTALLED IN", value: installedScopes, maxLines: 1 },
      { label: "LICENSE", value: selected.license_status || "not declared", maxLines: 1 },
      ...(selected.source_repository
        ? [{ label: "PINNED SOURCE", value: `${selected.source_repository}/${selected.source_path || "unknown"}@${selected.source_ref || "unknown"}`, maxLines: Infinity }]
        : []),
    ]
    : [];
  const entryContent = selected
    ? detailRows.flatMap((row, index) =>
      detailField(`catalog-entry-${index}`, row.label, row.value, detailsContentWidth, row.maxLines))
    : detailValue("catalog-entry-empty", "No matching catalog resources.", detailsContentWidth);
  const filterLines = wrapText(
    `Filter ${filterMode ? `${query}▏` : query || "(F to filter)"} · Catalog ${catalogFilter.toUpperCase()} · Kind ${kindFilter.toUpperCase()} · License ${licenseFilter.toUpperCase()}`,
    contentWidth,
  );
  const tableOverhead = 13 + filterLines.length;
  const catalogShortcutLines = modalActive ? [] : screenName === "INSTALL OPTIONS"
    ? []
    : filterMode
      ? ["TYPE to search", "ENTER apply", "BACKSPACE edit", "ESC clear", "↑↓ navigate"]
      : [
        "F filter · C catalog · K kind · L license",
        "V revisions · P preview/audit · D details",
        "↑↓ navigate · ENTER install · ESC back",
        "? guide · Q quit",
      ];
  const shortcutLines = catalogShortcutLines;
  const catalogShortcutWidth = detailsSideBySide ? detailsWidth : columns - 2;
  const shortcutsPanelRows = modalActive || !shortcutLines.length
    ? 0
    : wrappedShortcutLines(shortcutLines, catalogShortcutWidth).length + 5;
  const stackedDetailsRows = !detailsSideBySide
    ? (showDetails ? entryContent.length + 5 : 0) + shortcutsPanelRows
    : 0;
  // Preserve metadata and wrapped controls by dropping only optional blank gaps.
  const stackedOverflow = detailsSideBySide ? 0 : Math.max(0, tableOverhead + stackedDetailsRows + 1 - rows);
  const shortcutsMarginTop = stackedOverflow > 0 || (detailsSideBySide &&
    entryContent.length + 4 + shortcutsPanelRows > rows - 7) ? 0 : 1;
  const entryMarginTop = detailsSideBySide || stackedOverflow > Number(Boolean(shortcutsPanelRows)) ? 0 : 1;
  const listMarginTop = stackedOverflow > Number(Boolean(shortcutsPanelRows)) + Number(showDetails) ? 0 : 1;
  const reclaimedRows = detailsSideBySide ? 0 : 1 - listMarginTop +
    (showDetails ? 1 - entryMarginTop : 0) + (shortcutsPanelRows ? 1 - shortcutsMarginTop : 0);
  const viewport = Math.max(1, rows - (tableOverhead + stackedDetailsRows - reclaimedRows));
  const first = Math.max(0, Math.min(activeIndex - viewport + 1, visible.length - viewport));
  const page = visible.slice(first, first + viewport);
  const pageRange = visible.length ? `${first + 1}-${first + page.length}` : "0-0";
  const tableHeader = tableLine([
    ["", columnsByField.marker],
    [columnsByField.compact ? "INST" : "INSTALLED", columnsByField.installed],
    ["SOURCE", columnsByField.source],
    ["KIND", columnsByField.kind],
    ["ID", columnsByField.id],
  ]);
  const tableRows = page.length
    ? page.map((resource, index) => {
      const selectedRow = first + index === activeIndex;
      const scopes = resources.filter((entry) =>
        entry.catalog === resource.catalog && entry.kind === resource.kind && entry.id === resource.id,
      ).map((entry) => entry.scope);
      const installed = scopes.includes("project") && scopes.includes("user")
        ? "both"
        : scopes[0] || "no";
      const row = tableLine([
        [selectedRow ? "›" : "", columnsByField.marker],
        [installed, columnsByField.installed],
        [candidateLabel(resource), columnsByField.source],
        [resource.kind, columnsByField.kind],
        [resource.id, columnsByField.id],
      ]);
      return h(Text, {
        key: `${resource.catalog}:${resource.kind}:${resource.id}`,
        color: resolveRowColor(
          resource.kind, selectedRow, resource.license_status === "Proprietary" ? DASHBOARD_THEME.semantic.inventoryStatus.attention : undefined,
        ),
        bold: selectedRow,
      }, row);
    })
    : [h(Text, { key: "empty", dimColor: true }, fitText("No matching catalog resources.", contentWidth))];
  while (tableRows.length < viewport) {
    tableRows.push(h(Text, { key: `empty-${tableRows.length}` }, " "));
  }

  const resourcePanel = h(Panel, {
    title: "CATALOG RESOURCES",
    separateHeader: true,
    width: detailsSideBySide ? listWidth : undefined,
    color: tourStep === 1 ? DASHBOARD_THEME.semantic.inventoryStatus.attention : DASHBOARD_THEME.semantic.selected,
    marginTop: listMarginTop,
    headerContent: h(React.Fragment, null,
      h(Text, { bold: true }, fitText(`RESOURCES ${visible.length}/${candidates.length} · ${pageRange}`, contentWidth)),
      ...filterLines.map((line, index) => h(Text, {
        key: `catalog-filter-${index}`,
        color: filterMode || query || catalogFilter !== "all" || kindFilter !== "all" || licenseFilter !== "all"
          ? DASHBOARD_THEME.semantic.selected : DASHBOARD_THEME.semantic.accents.muted,
      }, line))),
  },
  h(Text, { bold: true }, tableHeader),
  ...tableRows);
  const entryPanel = showDetails ? h(DetailsPanel, {
    title: selected
      ? `${selected.kind.toUpperCase()} - ${fitText(
        selected.id, Math.max(1, detailsContentWidth - selected.kind.length - 3),
      )}`
      : "CATALOG ENTRY",
    width: detailsSideBySide ? detailsWidth : undefined,
    marginTop: entryMarginTop,
    flexGrow: detailsSideBySide ? 1 : 0,
    flexShrink: detailsSideBySide ? 1 : 0,
  }, entryContent) : null;
  const screenShortcuts = !modalActive && shortcutLines.length
    ? ShortcutsPanel({
      lines: shortcutLines,
      width: catalogShortcutWidth,
      marginTop: shortcutsMarginTop,
    })
    : null;
  const detailColumn = h(Box, {
    flexDirection: "column",
    alignItems: "stretch",
    width: detailsSideBySide ? detailsWidth : undefined,
    height: detailsSideBySide ? viewport + 7 : undefined,
    marginTop: detailsSideBySide ? 1 : 0,
    marginLeft: detailsSideBySide ? 1 : 0,
  }, ...(showDetails
    ? [entryPanel, screenShortcuts]
    : detailsSideBySide
      ? [h(Box, { key: "catalog-shortcuts-spacer", flexGrow: 1 }), screenShortcuts]
      : [screenShortcuts]));
  const catalogPanels = h(Box, {
    flexDirection: detailsSideBySide ? "row" : "column",
    alignItems: "stretch",
    width: columns - 2,
  }, resourcePanel, detailColumn);

  return h(Box, { flexDirection: "column", paddingX: 1 },
    h(DashboardHeader, {
      versionLabel,
      screenName,
      metadata: `AVAILABLE ${visible.length}/${candidates.length} · ${pageRange} · CATALOG ${catalogFilter.toUpperCase()} · KIND ${kindFilter.toUpperCase()}`,
      columns,
    }),
    catalogPanels,
  );
}
