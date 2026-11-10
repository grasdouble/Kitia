"use strict";

import React from "react";
import { Box, Text } from "ink";
import type { CatalogResource } from "../../catalog/entries.js";
import type { ScanError } from "../../catalog/lifecycle.js";
import type { InventoryCatalogConfiguration } from "../helpers.mjs";
import {
  colorForStatus, dashboardStatus, detailPanelLayout, filterInventory, inventoryCatalogLabels,
  issueLine, tableColumns, tableLine, fitText,
} from "../helpers.mjs";
import {
  DashboardHeader, DetailsPanel, Panel, ShortcutsPanel, detailField, detailLocations, detailValue, wrappedShortcutLines,
} from "./shared.mjs";

const h = React.createElement;
export function InventoryScreen({
  resources,
  errors,
  query,
  filterMode,
  catalogFilter,
  kindFilter,
  selectedIndex,
  versionLabel,
  actionMessage,
  catalogAvailable,
  canExecute,
  showDetails,
  columns,
  rows,
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
  selectedIndex: number;
  versionLabel: string;
  actionMessage: string;
  catalogAvailable: boolean;
  canExecute: boolean;
  showDetails: boolean;
  columns: number;
  rows: number;
  modalActive?: boolean;
  userCatalogs?: InventoryCatalogConfiguration[];
  inventoryLabels?: Map<CatalogResource, string>;
  tourStep?: number | null;
}) {
  const inventoryLabels = suppliedInventoryLabels || inventoryCatalogLabels(resources, userCatalogs);
  const visible = filterInventory(resources, query, catalogFilter, kindFilter, userCatalogs, inventoryLabels);
  const activeIndex = Math.min(selectedIndex, Math.max(0, visible.length - 1));
  const selected = visible[activeIndex];
  const managedResources = resources.filter((resource) => resource.managed !== false);
  const unmanaged = resources.length - managedResources.length;
  const current = managedResources.filter((resource) => dashboardStatus(resource) === "current").length;
  const updates = managedResources.filter((resource) => dashboardStatus(resource) === "update").length;
  const attention = managedResources.filter((resource) => dashboardStatus(resource) === "attention").length;
  const kinds = Object.fromEntries(["skill", "agent", "instruction"].map((kind) => [
    kind, resources.filter((resource) => resource.kind === kind).length,
  ]));
  const catalogCount = new Set(resources.filter((resource) => resource.managed !== false && resource.source_repository)
    .map((resource) => resource.catalog)).size;
  const needsReview = updates + attention;
  const sideBySide = columns >= 76;
  const contentWidth = Math.max(1, columns - 6);
  const inventoryLayout = detailPanelLayout(columns);
  const inventorySideBySide = showDetails && inventoryLayout.sideBySide;
  const inventoryListWidth = inventorySideBySide ? inventoryLayout.listWidth! : columns;
  const inventoryDetailsWidth = inventorySideBySide ? inventoryLayout.detailsWidth! : columns;
  const listContentWidth = Math.max(1, inventorySideBySide ? inventoryListWidth - 4 : contentWidth);
  const detailsContentWidth = Math.max(1, inventorySideBySide ? inventoryDetailsWidth - 4 : contentWidth);
  const cardGap = 1;
  const cardWidth = Math.floor((columns - 2 - cardGap * 2) / 3);
  const summaryCards = [
    { title: "RESOURCES", value: resources.length, note: `${catalogCount} catalog(s) connected`, color: "cyan" },
    { title: "MANAGED", value: managedResources.length, note: `${current} current · ${unmanaged} unmanaged`, color: "green" },
    { title: "NEEDS REVIEW", value: needsReview, note: `${updates} update(s) · ${attention} warning(s)`, color: needsReview ? "yellow" : "green" },
  ];
  const summaryPanels = h(Box, {
    flexDirection: sideBySide ? "row" : "column",
    alignItems: "stretch",
  }, ...summaryCards.map((card, index) => h(Panel, {
    key: card.title,
    title: card.title,
    color: card.color,
    width: sideBySide ? cardWidth : undefined,
    marginTop: sideBySide ? 0 : index ? 1 : 0,
    marginLeft: sideBySide && index ? cardGap : 0,
  },
  h(Text, { bold: true, color: card.color }, String(card.value).padStart(2, "0")),
  h(Text, { dimColor: true }, fitText(card.note, sideBySide ? cardWidth - 4 : contentWidth)))));
  const warnings = errors.length
    ? h(Panel, { title: "SCAN WARNINGS", marginTop: 1 },
      ...errors.map((error, index) => h(Text, {
        key: `warning-${index}`,
        color: "yellow",
      }, fitText(
        `${error.scope.toUpperCase()} · ${error.code}: ${error.message}`,
        contentWidth,
      ))))
    : null;
  const columnsByField = tableColumns(inventorySideBySide ? inventoryListWidth : columns);
  const tableHeader = tableLine([
    ["", columnsByField.marker],
    ["STATUS", columnsByField.status],
    ["SCOPE", columnsByField.scope],
    ["KIND", columnsByField.kind],
    ["ID", columnsByField.id],
    ["CATALOG", columnsByField.catalog],
  ]);
  const description = selected?.description || "No description available.";
  const sourceLocation = selected?.source_repository
    ? `https://github.com/${selected.source_repository}`
    : "";
  const locationValues = [
    ...(selected?.managed === false && Array.isArray(selected.paths)
      ? selected.paths.map((text) => ({ text }))
      : []),
    ...(sourceLocation ? [{ text: sourceLocation, href: sourceLocation }] : []),
  ];
  const locations = locationValues.map(({ text }) => text).join(" · ") || "-";
  const issues = selected?.managed === false
    ? "Not managed by Kitia; removal requires two confirmations."
    : selected?.issues?.length
      ? selected.issues.map(issueLine).join(" · ")
      : "Healthy · no recorded issues";
  const selectedStatus = selected ? dashboardStatus(selected) || "current" : "";
  const displayVersion = selected?.source_ref || (selected?.version ? selected.version.slice(0, 7) : "-");
  const compactDetails = rows < 40;
  const detailRows = selected
    ? [
      ...(!compactDetails ? [
        { label: "CATALOG", value: inventoryLabels.get(selected) || "-", maxLines: 1 },
        { label: "SCOPE", value: selected.scope?.toUpperCase() || "-", maxLines: 1 },
      ] : []),
      { label: "STATUS", value: `[ ${selectedStatus.toUpperCase()} ]`, maxLines: 1 },
      { label: "", value: issues, maxLines: Infinity },
      ...(!compactDetails ? [
        { label: "VERSION", value: displayVersion, maxLines: Infinity },
        { label: "LOCATIONS", value: locations, maxLines: Infinity },
        { label: "DESCRIPTION", value: description, maxLines: Infinity },
      ] : []),
      ...(actionMessage
        ? [{ label: "", value: actionMessage, maxLines: Infinity }]
        : []),
    ]
    : [{
      label: "",
      value: errors.length
        ? "No resource selected; see scan warnings above."
        : resources.length ? "No matching resource selected." : "No resources found.",
      maxLines: 1,
    }];
  const selectionContent = detailRows.flatMap((row, index) =>
    row.label === "LOCATIONS"
      ? [
        h(Text, { key: "inventory-locations-label", color: "white", bold: true },
          fitText(row.label, detailsContentWidth)),
        ...detailLocations("inventory-locations", locationValues, detailsContentWidth),
      ]
      : row.label
        ? detailField(
          `inventory-${index}`,
          row.label,
          row.value,
          detailsContentWidth,
          row.maxLines,
          row.label === "STATUS" ? colorForStatus(selectedStatus) : "gray",
        )
        : detailValue(`inventory-${index}`, row.value, detailsContentWidth, row.maxLines));
  const shortcutLines = modalActive ? [] : filterMode
    ? ["TYPE to search", "ENTER apply", "BACKSPACE edit", "ESC clear", "↑↓ navigate"]
    : [
      ...(catalogAvailable ? ["A install"] : []),
      ...(canExecute && selected && selected.managed !== false &&
          selected.source_repository && selected.source_path ? ["V revision"] : []),
      ...(canExecute && selected
        ? [selected.managed === false ? "Delete remove" : "U update · Delete uninstall"]
        : []),
      "M catalogs",
      ["F filter", ...(resources.length ? ["C catalog", "K kind"] : [])].join(" · "),
      "D details",
      "↑↓ navigate · ? guide · Q quit",
    ];
  const inventoryShortcutWidth = inventorySideBySide ? inventoryDetailsWidth : columns - 2;
  const fullSummaryPanelRows = sideBySide ? 5 : 17;
  const warningPanelRows = errors.length ? errors.length + 4 : 0;
  const detailsPanelRows = showDetails ? selectionContent.length + 4 : 0;
  const shortcutsPanelRows = modalActive ? 0 : wrappedShortcutLines(shortcutLines, inventoryShortcutWidth).length + 4;
  const detailsVerticalOverhead = inventorySideBySide
    ? 0
    : detailsPanelRows + shortcutsPanelRows;
  const requiredRowsForSummary = 6 + fullSummaryPanelRows + warningPanelRows +
    6 + detailsVerticalOverhead + 2;
  const summaryCompactPanel = h(Panel, { title: "SUMMARY" },
    h(Text, { dimColor: true }, fitText(
      `RES ${resources.length} · MAN ${managedResources.length} · REVIEW ${needsReview}`,
      contentWidth,
    )));
  const showFullSummaryPanels = rows >= requiredRowsForSummary;
  const summaryPanelRows = showFullSummaryPanels ? fullSummaryPanelRows : 4;
  const panels = showFullSummaryPanels ? summaryPanels : summaryCompactPanel;
  const viewport = Math.max(
    1,
    rows - (6 + summaryPanelRows + warningPanelRows + 6 + detailsVerticalOverhead),
  );
  const first = Math.max(0, Math.min(activeIndex - viewport + 1, visible.length - viewport));
  const page = visible.slice(first, first + viewport);
  const pageRange = visible.length ? `${first + 1}-${first + page.length}` : "0-0";
  const tableRows = page.length
    ? page.map((resource, index) => {
      const selectedRow = first + index === activeIndex;
      const status = dashboardStatus(resource);
      const row = tableLine([
        [selectedRow ? ">" : "", columnsByField.marker],
        [status.toUpperCase(), columnsByField.status],
        [resource.scope.toUpperCase(), columnsByField.scope],
        [resource.kind === "instruction" ? "instr" : resource.kind, columnsByField.kind],
        [resource.id, columnsByField.id],
        [inventoryLabels.get(resource) || "-", columnsByField.catalog],
      ]);
      return h(Text, {
        key: `${resource.managed === false ? "unmanaged" : resource.catalog}:${resource.scope}:${resource.kind}:${resource.id}`,
        color: selectedRow ? "cyan" : colorForStatus(status),
        bold: selectedRow,
      }, row);
    })
    : [h(Text, { key: "empty", dimColor: true }, fitText("No matching resources.", listContentWidth))];
  while (tableRows.length < viewport) {
    tableRows.push(h(Text, { key: `empty-${tableRows.length}` }, " "));
  }
  const resourcePanel = h(Panel, {
    title: "INVENTORY",
    width: inventorySideBySide ? inventoryListWidth : undefined,
    color: tourStep === 0 ? "yellow" : "cyan",
    marginTop: 1,
  },
  h(Text, { bold: true }, fitText(`RESOURCES ${visible.length}/${resources.length} · ${pageRange}`, listContentWidth)),
  h(Text, {
    color: filterMode || query || catalogFilter !== "all" || kindFilter !== "all" ? "cyan" : "gray",
  }, fitText(
    `Filter ${filterMode ? `${query}▏` : query || "(F to filter)"} · Catalog ${catalogFilter.toUpperCase()} · Kind ${kindFilter.toUpperCase()}`,
    listContentWidth,
  )),
  h(Text, { bold: true }, tableHeader),
  ...tableRows);
  const selectionPanel = showDetails ? h(DetailsPanel, {
    title: selected ? `${selected.kind.toUpperCase()} - ${fitText(selected.id, Math.max(1, detailsContentWidth - selected.kind.length - 3))}` : "SELECTION",
    width: inventorySideBySide ? inventoryDetailsWidth : undefined,
    marginTop: inventorySideBySide ? 0 : 1,
    flexGrow: inventorySideBySide ? 1 : 0,
    flexShrink: inventorySideBySide ? 1 : 0,
  }, selectionContent) : null;
  const shortcutsPanel = modalActive ? null : ShortcutsPanel({
    lines: shortcutLines,
    width: inventoryShortcutWidth,
    marginTop: 1,
  });
  const detailsColumn = h(Box, {
    flexDirection: "column",
    alignItems: "stretch",
    width: inventorySideBySide ? inventoryDetailsWidth : undefined,
    height: inventorySideBySide ? viewport + 6 : undefined,
    marginTop: inventorySideBySide ? 1 : 0,
    marginLeft: inventorySideBySide ? 1 : 0,
  }, ...(showDetails
    ? [selectionPanel, shortcutsPanel]
    : inventorySideBySide ? [h(Box, { key: "shortcuts-spacer", flexGrow: 1 }), shortcutsPanel] : [shortcutsPanel]));
  const inventoryPanels = h(Box, {
    flexDirection: inventorySideBySide ? "row" : "column",
    alignItems: "stretch",
    width: columns - 2,
  }, resourcePanel, detailsColumn);


  return h(Box, { flexDirection: "column", paddingX: 1 },
    h(DashboardHeader, {
      versionLabel,
      screenName: "INVENTORY",
      metadata: `RESOURCES ${visible.length}/${resources.length} · ${pageRange} · CATALOG ${catalogFilter.toUpperCase()} · KIND ${kindFilter.toUpperCase()}`,
      columns,
    }),
    panels,
    warnings,
    inventoryPanels,
  );

}
