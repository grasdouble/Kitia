"use strict";

import React, { type ReactNode } from "react";
import { Box, Text } from "ink";
import type { CatalogResource } from "../catalog/entries.js";
import type { ScanError } from "../catalog/lifecycle.js";
import {
  catalogLabel, catalogTableColumns, colorForStatus, dashboardStatus, filterCatalogResources,
  inventoryCatalogLabels, filterInventory, fitColumn, fitText, detailPanelLayout, issueLine,
  tableColumns, tableLine, wrapText,
} from "./helpers.mjs";
import type { InventoryCatalogConfiguration } from "./helpers.mjs";

const h = React.createElement;

const shortcutKey = /^(?:Delete|BACKSPACE|ENTER|ESC|↑↓|[A-Z])$/;

function shortcutHint(value: string, width: number) {
  const visible = fitText(value, width);
  const parts = visible.split(/(Delete|BACKSPACE|ENTER|ESC|↑↓|[A-Z])/g);
  return h(Text, { dimColor: true }, ...parts.map((part, index) =>
    shortcutKey.test(part)
      ? h(Text, { key: `shortcut-${index}`, bold: true, color: "cyan" }, part)
      : part));
}

function Panel({
  title,
  children,
  color = "cyan",
  width,
  marginTop = 0,
  marginLeft = 0,
}: {
  title: string;
  children?: ReactNode;
  color?: string;
  width?: number;
  marginTop?: number;
  marginLeft?: number;
}) {
  return h(Box, {
    flexDirection: "column",
    borderStyle: "single",
    borderColor: color,
    paddingX: 1,
    marginTop,
    marginLeft,
    width,
  }, h(Text, { bold: true, color }, title), children);
}

function DetailsPanel({
  title,
  children,
  width,
  marginTop = 1,
  marginLeft = 0,
}: {
  title: string;
  children?: ReactNode;
  width?: number;
  marginTop?: number;
  marginLeft?: number;
}) {
  return h(Panel, { title, children, color: "blue", width, marginTop, marginLeft });
}

function detailValue(key: string, value: unknown, width: number, maxLines = 1, color = "gray") {
  return wrapText(value, width, maxLines).map((line, index) =>
    h(Text, { key: `${key}-value-${index}`, color }, fitText(line, width)));
}

function detailField(
  key: string,
  label: string,
  value: unknown,
  width: number,
  maxLines = 1,
  color = "gray",
) {
  return [
    h(Text, { key: `${key}-label`, color: "white", bold: true }, fitText(label, width)),
    ...detailValue(key, value, width, maxLines, color),
  ];
}

export function ScreenFrame({ columns, rows, children }: {
  columns: number;
  rows: number;
  children?: ReactNode;
}) {
  return h(Box, {
    width: columns,
    height: rows,
    flexDirection: "column",
    alignItems: "stretch",
    position: "relative",
  }, children);
}

function DashboardHeader({ versionLabel, screenName, metadata, columns }: {
  versionLabel: string;
  screenName: string;
  metadata: string;
  columns: number;
}) {
  return h(Box, { flexDirection: "column" },
    h(Text, { dimColor: true, bold: true }, fitText(`Kitia - ${versionLabel}`, columns - 2)),
    h(Text, { bold: true, color: "cyan" }, fitText(screenName, columns - 2)),
    h(Text, { dimColor: true }, fitText(metadata, columns - 2)));
}

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
    { title: "NEEDS REVIEW", value: needsReview, note: `${updates} update(s) · ${attention} attention`, color: needsReview ? "yellow" : "green" },
  ];
  const panels = h(Box, {
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
  const locations = [
    ...(selected?.managed === false && Array.isArray(selected.paths) ? selected.paths : []),
    ...(sourceLocation ? [sourceLocation] : []),
  ].join(" · ") || "-";
  const issues = selected?.managed === false
    ? "Not managed by Kitia; removal requires two confirmations."
    : selected?.issues?.length
      ? selected.issues.map(issueLine).join(" · ")
      : "Healthy · no recorded issues";
  const selectedStatus = selected ? dashboardStatus(selected) || "current" : "";
  const detailVersion = selected?.version || selected?.source_ref;
  const displayVersion = typeof detailVersion === "string" && detailVersion
    ? detailVersion.slice(0, 7)
    : "-";
  const detailRows = selected
    ? [
      { label: "CATALOG", value: inventoryLabels.get(selected) || "-", maxLines: 1 },
      { label: "SCOPE", value: selected.scope?.toUpperCase() || "-", maxLines: 1 },
      { label: "STATUS", value: `[ ${selectedStatus.toUpperCase()} ]`, maxLines: 1 },
      { label: "", value: issues, maxLines: 2 },
      { label: "VERSION", value: displayVersion, maxLines: 1 },
      { label: "LOCATIONS", value: locations, maxLines: 2 },
      { label: "DESCRIPTION", value: description, maxLines: 3 },
      ...(actionMessage
        ? [{ label: "", value: fitText(actionMessage, detailsContentWidth), maxLines: 1 }]
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
    row.label
      ? detailField(
        `inventory-${index}`,
        row.label,
        row.value,
        detailsContentWidth,
        row.maxLines,
        row.label === "STATUS" ? colorForStatus(selectedStatus) : "gray",
      )
      : detailValue(`inventory-${index}`, row.value, detailsContentWidth, row.maxLines));
  const summaryPanelRows = sideBySide ? 5 : 15;
  const warningPanelRows = errors.length ? errors.length + 4 : 0;
  const detailsVerticalOverhead = showDetails && !inventorySideBySide ? selectionContent.length + 4 : 0;
  const viewport = Math.max(
    1,
    rows - (4 + summaryPanelRows + warningPanelRows + 6 + detailsVerticalOverhead + 1),
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
  const selectionPanel = h(DetailsPanel, {
    title: selected ? `${selected.kind.toUpperCase()} - ${fitText(selected.id, Math.max(1, detailsContentWidth - selected.kind.length - 3))}` : "SELECTION",
    width: inventorySideBySide ? inventoryDetailsWidth : undefined,
    marginTop: 1,
    marginLeft: inventorySideBySide ? 1 : 0,
  }, selectionContent);
  const inventoryPanels = h(Box, {
    flexDirection: inventorySideBySide ? "row" : "column",
    alignItems: "stretch",
    width: columns - 2,
  }, resourcePanel, showDetails ? selectionPanel : null);
  const shortcuts = [
    [
      ...(catalogAvailable ? ["A install"] : []),
      ...(canExecute
        ? [selected?.managed === false ? "Delete remove" : "U update - Delete uninstall"]
        : []),
    ].filter(Boolean).join(" - "),
    "M catalogs",
    ["F filter", ...(resources.length ? ["C catalog", "K kind"] : []), "D details"].join(" - "),
    "↑↓ navigate - ? guide - Q quit",
  ].filter(Boolean).join("|");

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
    shortcutHint(
      filterMode ? "TYPE FILTER · ENTER APPLY · BACKSPACE EDIT · ESC CLEAR" : shortcuts,
      columns - 2,
    ),
  );
}

export function CatalogScreen({
  candidates,
  resources,
  catalogs,
  query,
  filterMode,
  catalogFilter,
  kindFilter,
  selectedIndex,
  versionLabel,
  screenName,
  showDetails,
  columns,
  rows,
  tourStep,
}: {
  candidates: CatalogResource[];
  resources: CatalogResource[];
  catalogs: InventoryCatalogConfiguration[];
  query: string;
  filterMode: boolean;
  catalogFilter: string;
  kindFilter: string;
  selectedIndex: number;
  versionLabel: string;
  screenName: string;
  showDetails: boolean;
  columns: number;
  rows: number;
  tourStep?: number | null;
}) {
  const candidateLabels = inventoryCatalogLabels(candidates, catalogs);
  const candidateLabel = (resource: CatalogResource) =>
    resource.managed === false || !resource.source_repository
      ? resource.catalog
      : candidateLabels.get(resource) || resource.catalog;
  const visible = filterCatalogResources(candidates, query, catalogFilter, kindFilter, catalogs);
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
      { label: "DESCRIPTION", value: selected.description || "No description available.", maxLines: 2 },
      { label: "INSTALLED IN", value: installedScopes, maxLines: 1 },
      { label: "LICENSE", value: selected.license_status || "not declared", maxLines: 1 },
    ]
    : [];
  const entryContent = selected
    ? detailRows.flatMap((row, index) =>
      detailField(`catalog-entry-${index}`, row.label, row.value, detailsContentWidth, row.maxLines))
    : detailValue("catalog-entry-empty", "No matching catalog resources.", detailsContentWidth);
  const viewport = Math.max(
    1,
    rows - (10 + (showDetails && !detailsSideBySide ? entryContent.length + 4 : 0)),
  );
  const first = Math.max(0, Math.min(activeIndex - viewport + 1, visible.length - viewport));
  const page = visible.slice(first, first + viewport);
  const pageRange = visible.length ? `${first + 1}-${first + page.length}` : "0-0";
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
  h(Text, { bold: true }, tableHeader),
  ...tableRows);
  const entryPanel = showDetails ? h(DetailsPanel, {
    title: selected
      ? `${selected.kind.toUpperCase()} - ${fitText(
        selected.id, Math.max(1, detailsContentWidth - selected.kind.length - 3),
      )}`
      : "CATALOG ENTRY",
    width: detailsSideBySide ? detailsWidth : undefined,
    marginTop: 1,
    marginLeft: detailsSideBySide ? 1 : 0,
  }, entryContent) : null;
  const catalogPanels = h(Box, {
    flexDirection: detailsSideBySide ? "row" : "column",
    alignItems: "stretch",
    width: columns - 2,
  }, resourcePanel, entryPanel);

  return h(Box, { flexDirection: "column", paddingX: 1 },
    h(DashboardHeader, {
      versionLabel,
      screenName,
      metadata: `AVAILABLE ${visible.length}/${candidates.length} · ${pageRange} · CATALOG ${catalogFilter.toUpperCase()} · KIND ${kindFilter.toUpperCase()}`,
      columns,
    }),
    catalogPanels,
    shortcutHint(
      filterMode
        ? "TYPE FILTER · ENTER APPLY · BACKSPACE EDIT · ESC CLEAR"
        : "C catalog - K kind - F filter - D details | ↑↓ navigate - ENTER select - ? guide - ESC back",
      columns - 2,
    ),
  );
}
export type CatalogFreshnessStatus = "checking" | "current" | "outdated" | "unknown";

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
  versionLabel,
  showDetails,
  columns,
  rows,
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
  versionLabel: string;
  showDetails: boolean;
  columns: number;
  rows: number;
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
  const nameWidth = Math.min(compact ? 12 : 20, Math.max(8, Math.floor(contentWidth * 0.22)));
  const resourceWidth = compact ? 4 : 9;
  const installedWidth = compact ? 5 : 9;
  const freshnessWidth = 10;
  const repositoryWidth = Math.max(8,
    contentWidth - nameWidth - resourceWidth - installedWidth - freshnessWidth - 7);
  const freshnessLabels: Record<CatalogFreshnessStatus, string> = {
    checking: "CHECKING",
    current: "UP TO DATE",
    outdated: "OUTDATED",
    unknown: "UNKNOWN",
  };
  const freshnessColors: Record<CatalogFreshnessStatus, string> = {
    checking: "cyan",
    current: "green",
    outdated: "yellow",
    unknown: "gray",
  };
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
    [compact ? "RES" : "RESOURCES", resourceWidth],
    [compact ? "INST" : "INSTALLED", installedWidth],
    ["FRESHNESS", freshnessWidth],
  ]);
  const selectedCounts = selected ? catalogCounts(selected.name) : null;
  const detailsContent = selected
    ? [
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
  const viewport = Math.max(
    1,
    rows - (detailsSideBySide || !showDetails ? 11 : detailsContent.length + 13),
  );
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
      color: selectedRow ? "cyan" : undefined,
      bold: selectedRow,
    }, `${tableLine([
      [selectedRow ? ">" : "", 2],
      [catalog.name, nameWidth],
      [catalog.repository, repositoryWidth],
      [String(counts.resources), resourceWidth],
      [String(counts.installed), installedWidth],
    ])} `),
    h(Text, {
      color: freshnessColors[status],
      bold: true,
    }, fitColumn(freshnessLabels[status], freshnessWidth)));
  });
  while (rowsContent.length < viewport) {
    rowsContent.push(h(Text, { key: `empty-${rowsContent.length}` }, " "));
  }
  const shortcuts = [
    [
      ...(canAdd ? ["A add catalog"] : []),
      ...(canRemove && selected ? ["Delete remove selected"] : []),
      ...(canEdit && selected ? ["E edit selected"] : []),
      ...(canRefresh && selected ? ["R refresh"] : []),
    ].join(" - "),
    "D details - ↑↓ navigate - ? guide - ESC inventory - Q quit",
  ].filter(Boolean).join(" | ");

  const catalogPanel = h(Panel, {
    title: `CONNECTED CATALOGS ${catalogs.length}`,
    width: detailsSideBySide ? listWidth : undefined,
    color: tourStep === 2 ? "yellow" : "cyan",
    marginTop: 1,
  },
  h(Text, { bold: true }, tableHeader),
  ...(page.length
    ? rowsContent
    : [h(Text, { key: "empty-catalogs", dimColor: true }, "No user catalogs connected.")]));
  const detailsPanel = showDetails ? h(DetailsPanel, {
    title: selected ? `CATALOG - ${selected.name}` : "CATALOG DETAILS",
    width: detailsSideBySide ? detailsWidth : undefined,
    marginTop: 1,
    marginLeft: detailsSideBySide ? 1 : 0,
  }, detailsContent) : null;
  const catalogPanels = h(Box, {
    flexDirection: detailsSideBySide ? "row" : "column",
    alignItems: "stretch",
    width: columns - 2,
  }, catalogPanel, detailsPanel);

  return h(Box, { flexDirection: "column", paddingX: 1 },
    h(DashboardHeader, {
      versionLabel,
      screenName: "CATALOG MANAGEMENT",
      metadata: `USER CATALOGS ${catalogs.length}`,
      columns,
    }),
    catalogPanels,
    shortcutHint(shortcuts, columns - 2),
  );
}
