"use strict";

import React from "react";
import { Box, Text } from "ink";
import type { CatalogResource } from "../../catalog/entries.js";
import { DASHBOARD_THEME } from "../colors.js";
import type { CatalogFreshnessStatus } from "../catalog-freshness.mjs";
import { detailPanelLayout, fitColumn, fitText, tableLine, wrapText } from "../helpers.mjs";
import {
  DashboardHeader, DetailsPanel, Panel, ShortcutsPanel, detailField, detailValue, wrappedShortcutLines,
} from "./shared.mjs";
import { adaptiveColumnWidths } from "../../table-layout.js";


const h = React.createElement;
export function CatalogManagementScreen({
  catalogs,
  catalogResources,
  installedResources,
  selectedIndex,
  freshness,
  canAdd,
  canRemove,
  canEdit,
  canRefresh,
  canTransfer,
  versionLabel,
  showDetails,
  columns,
  rows,
  modalActive = false,
  tourStep,
}: {
  catalogs: Array<{ name: string; repository: string }>;
  catalogResources: CatalogResource[];
  installedResources: CatalogResource[];
  selectedIndex: number;
  freshness: Record<string, CatalogFreshnessStatus>;
  canAdd: boolean;
  canRemove: boolean;
  canEdit: boolean;
  canRefresh: boolean;
  canTransfer: boolean;
  versionLabel: string;
  showDetails: boolean;
  columns: number;
  rows: number;
  modalActive?: boolean;
  tourStep?: number | null;
}) {
  const activeIndex = Math.min(selectedIndex, Math.max(0, catalogs.length - 1));
  const selected = catalogs[activeIndex];
  const panelLayout = detailPanelLayout(columns);
  const detailsSideBySide = showDetails && panelLayout.sideBySide;
  const listWidth = detailsSideBySide ? panelLayout.listWidth! : columns;
  const detailsWidth = detailsSideBySide ? panelLayout.detailsWidth! : columns;
  const contentWidth = Math.max(1, detailsSideBySide ? listWidth - 4 : columns - 6);
  const detailsContentWidth = Math.max(1, detailsSideBySide ? detailsWidth - 4 : columns - 6);
  const compact = contentWidth < 64;
  const repositoryVisible = !compact || contentWidth >= 44;
  const resourceWidth = Math.max(compact ? 3 : 9, String(catalogResources.length).length);
  const installedWidth = Math.max(compact ? 4 : 9, String(installedResources.length).length);
  const nameContentWidth = catalogs.reduce((width, catalog) =>
    Math.max(width, catalog.name.length), "CATALOG".length);
  const repositoryContentWidth = catalogs.reduce((width, catalog) =>
    Math.max(width, catalog.repository.length), "REPOSITORY".length);
  const columnWidths = adaptiveColumnWidths(contentWidth, [
    { contentWidth: 2, minWidth: 2, maxWidth: 2, shrinkWeight: 0 },
    { contentWidth: nameContentWidth, minWidth: Math.min(nameContentWidth, 8), growWeight: 2, shrinkWeight: 1 },
    ...(repositoryVisible ? [{
      contentWidth: repositoryContentWidth,
      minWidth: Math.min(repositoryContentWidth, 24),
      growWeight: 2,
      shrinkWeight: 2,
    }] : []),
    { contentWidth: resourceWidth, minWidth: compact ? 3 : 9, maxWidth: resourceWidth + 2, growWeight: 1, shrinkWeight: 1 },
    { contentWidth: installedWidth, minWidth: compact ? 4 : 9, maxWidth: installedWidth + 2, growWeight: 1, shrinkWeight: 1 },
    { contentWidth: 10, minWidth: 9, maxWidth: 12, growWeight: 1, shrinkWeight: 0 },
  ]);
  const [, nameWidth] = columnWidths;
  const repositoryWidth = repositoryVisible ? columnWidths[2] : 0;
  const resourceColumnWidth = columnWidths[repositoryVisible ? 3 : 2];
  const installedColumnWidth = columnWidths[repositoryVisible ? 4 : 3];
  const freshnessWidth = columnWidths[repositoryVisible ? 5 : 4];
  const freshnessLabels: Record<CatalogFreshnessStatus, string> = {
    checking: "CHECKING",
    current: "UP TO DATE",
    outdated: "OUTDATED",
    unknown: "UNKNOWN",
  };
  const freshnessColors = DASHBOARD_THEME.semantic.catalogFreshness;
  const freshnessOf = (name: string) => freshness[name] || "unknown";
  const catalogCounts = (name: string) => ({
    resources: catalogResources.filter((resource) => resource.catalog === name).length,
    installed: installedResources.filter((resource) =>
      resource.managed !== false && resource.catalog === name).length,
  });
  const tableHeader = tableLine([
    ["", 2],
    ["CATALOG", nameWidth],
    ["REPOSITORY", repositoryWidth],
    [compact ? "RES" : "RESOURCES", resourceColumnWidth],
    [compact ? "INST" : "INSTALLED", installedColumnWidth],
    ["FRESHNESS", freshnessWidth],
  ]);
  const selectedCounts = selected ? catalogCounts(selected.name) : null;
  const compactDetails = rows < 30;
  const detailsContent = selected
    ? compactDetails
      ? [
        h(Text, { key: "catalog-repository", color: DASHBOARD_THEME.semantic.accents.muted },
          fitText(`REPOSITORY ${selected.repository}`, detailsContentWidth)),
        h(Text, { key: "catalog-freshness", color: freshnessColors[freshnessOf(selected.name)] },
          fitText(`FRESHNESS ${freshnessLabels[freshnessOf(selected.name)]}`, detailsContentWidth)),
        ...wrapText(
          "REFRESH Updates catalog metadata only; installed resources stay unchanged.",
          detailsContentWidth,
          2,
        ).map((line, index) => h(Text, {
          key: `catalog-refresh-${index}`,
          color: DASHBOARD_THEME.semantic.accents.muted,
        }, line)),
      ]
      : [
        ...detailField("catalog-repository", "REPOSITORY", selected.repository, detailsContentWidth, 2),
        ...detailField("catalog-resources", "RESOURCES", selectedCounts?.resources, detailsContentWidth),
        ...detailField("catalog-installed", "INSTALLED", selectedCounts?.installed, detailsContentWidth),
        ...detailField(
          "catalog-freshness",
          "FRESHNESS",
          freshnessLabels[freshnessOf(selected.name)],
          detailsContentWidth,
          1,
          freshnessColors[freshnessOf(selected.name)],
        ),
        ...detailField(
          "catalog-refresh",
          "REFRESH",
          "Updates catalog metadata only; installed resources stay unchanged.",
          detailsContentWidth,
          2,
        ),
        ...detailField(
          "catalog-update",
          "UPDATE",
          "Use U in the inventory to update an installed resource.",
          detailsContentWidth,
          2,
        ),
      ]
    : detailValue("catalog-empty", "Add a user catalog to browse and install external resources.", detailsContentWidth, 2);
  const managementShortcutLines = modalActive ? [] : [
    [
      ...(canAdd ? ["A add", "P presets"] : []),
      ...(canRemove && selected ? ["Delete remove"] : []),
    ].join(" · "),
    [
      ...(canEdit && selected ? ["E edit"] : []),
      ...(canRefresh && selected ? ["R refresh"] : []),
      ...(canTransfer ? ["I import / X export"] : []),
    ].join(" · "),
    "D details · ↑↓ nav · ? guide",
    "ESC inventory · Q quit",
  ].filter(Boolean);
  const shortcuts = managementShortcutLines;
  const managementShortcutWidth = detailsSideBySide ? detailsWidth : columns - 2;
  const shortcutsPanelRows = modalActive
    ? 0
    : wrappedShortcutLines(shortcuts, managementShortcutWidth).length + 4;
  const detailsPanelRows = showDetails ? detailsContent.length + 4 : 0;
  const stackedOverhead = detailsSideBySide ? 0 : detailsPanelRows + shortcutsPanelRows;
  const viewport = Math.max(1, rows - (11 + stackedOverhead));
  const catalogPanelsWidth = detailsSideBySide ? listWidth + 1 + detailsWidth : columns - 2;
  const first = Math.max(0, Math.min(activeIndex - viewport + 1, catalogs.length - viewport));
  const page = catalogs.slice(first, first + viewport);
  const rowsContent = page.map((catalog, index) => {
    const selectedRow = first + index === activeIndex;
    const counts = catalogCounts(catalog.name);
    const status = freshnessOf(catalog.name);
    return h(Box, {
      key: catalog.name,
      flexDirection: "row",
    },
    h(Text, {
      color: selectedRow ? DASHBOARD_THEME.semantic.selected : undefined,
      bold: selectedRow,
    }, `${tableLine([
      [selectedRow ? "›" : "", 2],
      [catalog.name, nameWidth],
      [catalog.repository, repositoryWidth],
      [String(counts.resources), resourceColumnWidth],
      [String(counts.installed), installedColumnWidth],
    ])} `),
    h(Text, {
      color: freshnessColors[status],
      bold: true,
    }, fitColumn(freshnessLabels[status], freshnessWidth)));
  });
  while (rowsContent.length < viewport) {
    rowsContent.push(h(Text, { key: `empty-${rowsContent.length}` }, " "));
  }
  const catalogPanel = h(Panel, {
    title: `CONNECTED CATALOGS ${catalogs.length}`,
    width: detailsSideBySide ? listWidth : undefined,
    color: tourStep === 2 ? DASHBOARD_THEME.semantic.inventoryStatus.attention : DASHBOARD_THEME.semantic.selected,
    marginTop: 1,
  },
  h(Text, { bold: true }, tableHeader),
  ...(page.length
    ? rowsContent
    : [h(Text, { key: "empty-catalogs", dimColor: true }, "No user catalogs connected.")]));
  const detailsPanel = showDetails ? h(DetailsPanel, {
    title: selected ? `CATALOG - ${selected.name}` : "CATALOG DETAILS",
    width: detailsSideBySide ? detailsWidth : undefined,
    marginTop: detailsSideBySide ? 0 : 1,
    flexGrow: detailsSideBySide ? 1 : 0,
    flexShrink: detailsSideBySide ? 1 : 0,
  }, detailsContent) : null;
  const managementShortcutsPanel = !modalActive
    ? ShortcutsPanel({
      lines: shortcuts,
      width: managementShortcutWidth,
      marginTop: 1,
    })
    : null;
  const detailColumn = h(Box, {
    flexDirection: "column",
    alignItems: "stretch",
    width: detailsSideBySide ? detailsWidth : undefined,
    height: detailsSideBySide ? viewport + 5 : undefined,
    marginTop: detailsSideBySide ? 1 : 0,
    marginLeft: detailsSideBySide ? 1 : 0,
  }, ...(showDetails
    ? [detailsPanel, managementShortcutsPanel]
    : detailsSideBySide
      ? [h(Box, { key: "management-shortcuts-spacer", flexGrow: 1 }), managementShortcutsPanel]
      : [managementShortcutsPanel]));
  const catalogPanels = h(Box, {
    flexDirection: detailsSideBySide ? "row" : "column",
    alignItems: "stretch",
    width: catalogPanelsWidth,
  }, catalogPanel, detailColumn);

  return h(Box, { flexDirection: "column", paddingX: 1 },
    h(DashboardHeader, {
      versionLabel,
      screenName: "CATALOG MANAGEMENT",
      metadata: `USER CATALOGS ${catalogs.length}`,
      columns,
    }),
    catalogPanels,
  );
}
