"use strict";

import React from "react";
import { Box, Text } from "ink";
import type { CatalogResource } from "../../catalog/entries.js";
import type { InventoryCatalogConfiguration } from "../helpers.mjs";
import {
  catalogTableColumns, detailPanelLayout, filterCatalogResources, fitText, inventoryCatalogLabels, tableLine,
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
  tagFilter,
  statusFilter,
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
  tagFilter: string;
  statusFilter: string;
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
    tag: tagFilter === "all" ? undefined : tagFilter,
    status: statusFilter === "all" ? undefined : statusFilter,
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
  const columnsByField = catalogTableColumns(listWidth);
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
  const catalogShortcutLines = modalActive ? [] : screenName === "INSTALL OPTIONS"
    ? []
    : filterMode
      ? ["TYPE to search", "ENTER apply", "BACKSPACE edit", "ESC clear", "↑↓ navigate"]
      : [
        "C catalog · K kind · T tag",
        "S status · L license · F search",
        "V revisions · P preview · A audit · D details",
        "↑↓ navigate · ENTER install · ESC back",
        "? guide · Q quit",
      ];
  const shortcutLines = catalogShortcutLines;
  const catalogShortcutWidth = detailsSideBySide ? detailsWidth : columns - 2;
  const shortcutsPanelRows = modalActive ? 0 : wrappedShortcutLines(shortcutLines, catalogShortcutWidth).length + 4;
  const stackedDetailsRows = !detailsSideBySide
    ? (showDetails ? entryContent.length + 4 : 0) + shortcutsPanelRows
    : 0;
  const viewport = Math.max(1, rows - (13 + stackedDetailsRows));
  const first = Math.max(0, Math.min(activeIndex - viewport + 1, visible.length - viewport));
  const page = visible.slice(first, first + viewport);
  const pageRange = visible.length ? `${first + 1}-${first + page.length}` : "0-0";
  const activeFilters = [
    tagFilter !== "all" && `TAG ${tagFilter}`,
    statusFilter !== "all" && `STATUS ${statusFilter}`,
    licenseFilter !== "all" && `LICENSE ${licenseFilter}`,
  ].filter(Boolean);
  const filterSummary = activeFilters.join(" · ") || "No tag/status/license filters";
  const tableHeader = tableLine([
    ["", columnsByField.marker],
    ["INSTALLED", columnsByField.installed],
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
        [installed, columnsByField.installed],
        [candidateLabel(resource), columnsByField.source],
        [resource.kind, columnsByField.kind],
        [resource.id, columnsByField.id],
      ]);
      return h(Text, {
        key: `${resource.catalog}:${resource.kind}:${resource.id}`,
        color: selectedRow ? "cyan" : resource.license_status === "Proprietary" ? "yellow" : undefined,
        bold: selectedRow,
      }, row);
    })
    : [h(Text, { key: "empty", dimColor: true }, fitText("No matching catalog resources.", contentWidth))];
  while (tableRows.length < viewport) {
    tableRows.push(h(Text, { key: `empty-${tableRows.length}` }, " "));
  }

  const resourcePanel = h(Panel, {
    title: "CATALOG RESOURCES",
    width: detailsSideBySide ? listWidth : undefined,
    color: tourStep === 1 ? "yellow" : "cyan",
    marginTop: 1,
  },
  h(Text, { color: "gray" },
    fitText(`Filter ${filterMode ? `${query}▏` : query || "(F to filter)"}`, contentWidth)),
  h(Text, { color: "gray" }, fitText(filterSummary, contentWidth)),
  h(Text, { bold: true }, tableHeader),
  ...tableRows);
  const entryPanel = showDetails ? h(DetailsPanel, {
    title: selected
      ? `${selected.kind.toUpperCase()} - ${fitText(
        selected.id, Math.max(1, detailsContentWidth - selected.kind.length - 3),
      )}`
      : "CATALOG ENTRY",
    width: detailsSideBySide ? detailsWidth : undefined,
    marginTop: detailsSideBySide ? 0 : 1,
    flexGrow: detailsSideBySide ? 1 : 0,
    flexShrink: detailsSideBySide ? 1 : 0,
  }, entryContent) : null;
  const screenShortcuts = !modalActive && shortcutLines.length
    ? ShortcutsPanel({
      lines: shortcutLines,
      width: catalogShortcutWidth,
      marginTop: 1,
    })
    : null;
  const detailColumn = h(Box, {
    flexDirection: "column",
    alignItems: "stretch",
    width: detailsSideBySide ? detailsWidth : undefined,
    height: detailsSideBySide ? viewport + 6 : undefined,
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
