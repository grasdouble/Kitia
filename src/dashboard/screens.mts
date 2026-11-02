"use strict";

import React, { type ReactNode } from "react";
import { Box, Text } from "ink";
import type { CatalogResource, ScanError } from "../types.js";
import {
  catalogTableColumns, colorForStatus, dashboardStatus, filterCatalogResources,
  filterInventory, fitColumn, fitText, inventoryPanelLayout, issueLine, tableColumns, tableLine, wrapText,
} from "./helpers.mjs";

const h = React.createElement;

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

export function InventoryScreen({
  resources,
  errors,
  query,
  filterMode,
  catalogFilter,
  kindFilter,
  selectedIndex,
  actionMessage,
  catalogAvailable,
  canAddCatalog,
  canRemoveCatalog,
  canRefreshCatalog,
  canExecute,
  columns,
  rows,
}: {
  resources: CatalogResource[];
  errors: ScanError[];
  query: string;
  filterMode: boolean;
  catalogFilter: string;
  kindFilter: string;
  selectedIndex: number;
  actionMessage: string;
  catalogAvailable: boolean;
  canAddCatalog: boolean;
  canRemoveCatalog: boolean;
  canRefreshCatalog: boolean;
  canExecute: boolean;
  columns: number;
  rows: number;
}) {
  const visible = filterInventory(resources, query, catalogFilter, kindFilter);
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
  const scopeCount = (scope: string) => resources.filter((resource) => resource.scope === scope).length;
  const scopeError = (scope: string) => errors.find((error) => error.scope === scope);
  const scopeRows: Array<{ text: string; color?: string; bold?: boolean }> = ["project", "user"].map((scope) => {
    const error = scopeError(scope);
    return {
      text: error
        ? `${scope.toUpperCase().padEnd(8)} UNAVAILABLE · ${error.code}`
        : `${scope.toUpperCase().padEnd(8)} ${scopeCount(scope)} resource(s)`,
      color: error ? "yellow" : scope === "user" ? "cyan" : "blue",
    };
  });
  scopeRows.push({ text: `TOTAL    ${managedResources.length} managed · ${unmanaged} unmanaged`, bold: true });
  scopeRows.push({
    text: errors.length ? `${errors.length} scope scan warning(s)` : "Both inventories scanned",
    color: errors.length ? "yellow" : "gray",
  });
  const healthBarWidth = 16;
  const healthyBlocks = managedResources.length
    ? Math.round((current / managedResources.length) * healthBarWidth)
    : 0;
  const healthRows: Array<{ text: string; color?: string; bold?: boolean }> = [
    { text: `MANAGED ${managedResources.length}     UNMANAGED ${unmanaged}`, color: unmanaged ? "gray" : "green" },
    {
      text: `CURRENT ${current}     UPDATES ${updates}     ATTENTION ${attention}`,
      color: attention ? "yellow" : updates ? "cyan" : "gray",
    },
    {
      text: managedResources.length
        ? `HEALTH [${"█".repeat(healthyBlocks)}${"░".repeat(healthBarWidth - healthyBlocks)}]`
        : "HEALTH [no managed resources]",
      color: attention ? "yellow" : updates ? "cyan" : "green",
    },
    { text: `SKILLS ${kinds.skill}  AGENTS ${kinds.agent}  INSTRUCTIONS ${kinds.instruction}` },
  ];
  const sideBySide = columns >= 76;
  const contentWidth = Math.max(1, columns - 6);
  const panelWidth = Math.floor((columns - 3) / 2);
  const inventoryLayout = inventoryPanelLayout(columns);
  const inventorySideBySide = inventoryLayout.sideBySide;
  const inventoryListWidth = inventoryLayout.listWidth || columns;
  const inventoryDetailsWidth = inventoryLayout.detailsWidth || columns;
  const listContentWidth = Math.max(1, inventorySideBySide ? inventoryListWidth - 4 : contentWidth);
  const detailsContentWidth = Math.max(1, inventorySideBySide ? inventoryDetailsWidth - 4 : contentWidth);
  const panels = h(Box, {
    flexDirection: sideBySide ? "row" : "column",
  },
  h(Panel, {
    title: "SCOPES",
    width: sideBySide ? panelWidth : undefined,
    marginTop: 0,
  }, ...scopeRows.map((row, index) => h(Text, {
    key: `scope-${index}`,
    color: row.color,
    bold: row.bold,
  }, fitText(row.text, sideBySide ? panelWidth - 4 : contentWidth)))),
  h(Panel, {
    title: "RESOURCE HEALTH",
    width: sideBySide ? columns - 3 - panelWidth : undefined,
    marginTop: sideBySide ? 0 : undefined,
    marginLeft: sideBySide ? 1 : 0,
  }, ...healthRows.map((row, index) => h(Text, {
    key: `health-${index}`,
    color: row.color,
  }, fitText(row.text, sideBySide ? columns - panelWidth - 7 : contentWidth)))));
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
    ["SCOPE", columnsByField.scope],
    ["KIND", columnsByField.kind],
    ["ID", columnsByField.id],
    ["CATALOG", columnsByField.catalog],
    ["STATUS", columnsByField.status],
    ["DESC", columnsByField.description],
  ]);
  const description = selected?.description || "No description available.";
  const issues = selected?.managed === false
    ? "Not managed by Kiti; removal requires two confirmations."
    : selected?.issues?.length
      ? selected.issues.map(issueLine).join(" · ")
      : "Healthy · no recorded issues";
  const selectedStatus = selected ? dashboardStatus(selected) || "current" : "";
  const detailVersion = selected?.version || selected?.source_ref || selected?.commit;
  const displayVersion = typeof detailVersion === "string" && detailVersion
    ? detailVersion.slice(0, 7)
    : "-";
  const detailRows = selected
    ? [
      `CATALOG  ${selected.managed === false ? "-" : selected.catalog}`,
      `SCOPE    ${selected.scope?.toUpperCase()}`,
      `VERSION  ${displayVersion}`,
      "LOCATIONS",
      ...wrapText(description, detailsContentWidth, 2),
      "DETAILS",
      `STATUS   [ ${selectedStatus.toUpperCase()} ]`,
      ...wrapText(issues, detailsContentWidth, 2),
      ...(actionMessage ? [fitText(actionMessage, detailsContentWidth)] : []),
    ]
    : [
      errors.length
        ? "No resource selected; see scan warnings above."
        : resources.length ? "No matching resource selected." : "No resources found.",
    ];
  const details = detailRows;
  const selectionContent = selected
    ? h(Box, { flexDirection: "column" },
      h(Text, null,
        h(Text, { dimColor: true, bold: true }, "CATALOG  "),
        selected.managed === false ? "-" : selected.catalog),
      h(Text, null,
        h(Text, { dimColor: true, bold: true }, "SCOPE    "),
        selected.scope?.toUpperCase()),
      h(Text, null,
        h(Text, { dimColor: true, bold: true }, "VERSION  "),
        displayVersion),
      h(Box, { flexDirection: "column", marginTop: 1 },
        h(Text, { dimColor: true, bold: true }, "LOCATIONS"),
        h(Text, null, fitText(description, detailsContentWidth))),
      h(Box, { flexDirection: "column", marginTop: 1 },
        h(Text, { dimColor: true, bold: true }, "DETAILS"),
        h(Text, { color: colorForStatus(selectedStatus), bold: true },
          `STATUS   [ ${selectedStatus.toUpperCase()} ]`),
        h(Text, { color: selected.issues?.length ? "yellow" : undefined },
          fitText(issues, detailsContentWidth)),
        actionMessage ? h(Text, { color: "cyan" }, fitText(actionMessage, detailsContentWidth)) : null))
    : details.map((line, index) => h(Text, { key: `detail-${index}` }, fitText(line, detailsContentWidth)));
  const summaryPanelRows = sideBySide ? 7 : 14;
  const warningPanelRows = errors.length ? errors.length + 4 : 0;
  const detailsVerticalOverhead = inventorySideBySide ? 0 : details.length + 4;
  const viewport = Math.max(
    1,
    rows - (3 + summaryPanelRows + warningPanelRows + 6 + detailsVerticalOverhead + 1),
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
        [resource.scope.toUpperCase(), columnsByField.scope],
        [resource.kind === "instruction" ? "instr" : resource.kind, columnsByField.kind],
        [resource.id, columnsByField.id],
        [resource.managed === false ? "-" : resource.catalog, columnsByField.catalog],
        [status.toUpperCase(), columnsByField.status],
        [resource.description, columnsByField.description],
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
    title: `RESOURCES ${visible.length}/${resources.length}  ·  ${pageRange}`,
    width: inventorySideBySide ? inventoryListWidth : undefined,
    marginTop: 1,
  },
  h(Text, {
    color: filterMode || query || catalogFilter !== "all" || kindFilter !== "all" ? "cyan" : "gray",
  }, fitText(
    `Filter ${filterMode ? `${query}▏` : query || "(F to filter)"} · Catalog ${catalogFilter.toUpperCase()} · Kind ${kindFilter.toUpperCase()}`,
    listContentWidth,
  )),
  h(Text, { bold: true }, tableHeader),
  ...tableRows);
  const selectionPanel = h(Panel, {
    title: selected ? `${selected.kind.toUpperCase()} - ${fitText(selected.id, Math.max(1, detailsContentWidth - selected.kind.length - 3))}` : "SELECTION",
    color: "blue",
    width: inventorySideBySide ? inventoryDetailsWidth : undefined,
    marginTop: 1,
    marginLeft: inventorySideBySide ? 1 : 0,
  }, selectionContent);
  const inventoryPanels = h(Box, {
    flexDirection: inventorySideBySide ? "row" : "column",
    alignItems: "stretch",
    width: columns - 2,
  }, resourcePanel, selectionPanel);
  const shortcuts = [
    ...(catalogAvailable ? ["A install"] : []),
    ...(canAddCatalog ? ["N add catalog"] : []),
    ...(canRefreshCatalog ? ["G refresh catalog(s)"] : []),
    ...(canExecute
      ? [selected?.managed === false ? "Delete remove" : "U update · Delete uninstall"]
      : []),
    ...(resources.length ? ["C catalog", "K kind"] : []),
  ].join(" · ");

  return h(Box, { flexDirection: "column", paddingX: 1 },
    h(Text, { bold: true, color: "cyan" }, fitText(
      `KITI / DASHBOARD  ·  ${managedResources.length} managed  ·  ${unmanaged} unmanaged  ·  ${updates} updates  ·  ${attention} attention`,
      columns - 2,
    )),
    panels,
    warnings,
    inventoryPanels,
    h(Text, { dimColor: true },
      fitText(
        `${filterMode ? "TYPE FILTER · ENTER APPLY · BACKSPACE EDIT · ESC CLEAR" : `${shortcuts ? `${shortcuts} · ` : ""}F filter · ↑↓ navigate · Q quit`}`,
        columns - 2,
      )),
  );
}

export function CatalogScreen({
  candidates,
  resources,
  query,
  filterMode,
  catalogFilter,
  kindFilter,
  selectedIndex,
  columns,
  rows,
}: {
  candidates: CatalogResource[];
  resources: CatalogResource[];
  query: string;
  filterMode: boolean;
  catalogFilter: string;
  kindFilter: string;
  selectedIndex: number;
  columns: number;
  rows: number;
}) {
  const visible = filterCatalogResources(candidates, query, catalogFilter, kindFilter);
  const activeIndex = Math.min(selectedIndex, Math.max(0, visible.length - 1));
  const selected = visible[activeIndex];
  const contentWidth = Math.max(1, columns - 6);
  const columnsByField = catalogTableColumns(columns);
  const installedScopes = selected
    ? resources.filter((entry) =>
      entry.catalog === selected.catalog && entry.kind === selected.kind && entry.id === selected.id,
    ).map((entry) => entry.scope).join(", ") || "none"
    : "none";
  const detailRows = selected
    ? [
      `${selected.catalog.toUpperCase()}  /  ${selected.kind}:${selected.id}`,
      ...wrapText(selected.description || "No description available.", contentWidth, 2),
      `Installed in: ${installedScopes}${selected.license_status ? `  ·  License: ${selected.license_status}` : ""}`,
    ]
    : ["No matching catalog resources.", "", ""];
  const viewport = Math.max(1, rows - (13 + detailRows.length));
  const first = Math.max(0, Math.min(activeIndex - viewport + 1, visible.length - viewport));
  const page = visible.slice(first, first + viewport);
  const pageRange = visible.length ? `${first + 1}-${first + page.length}` : "0-0";
  const tableHeader = tableLine([
    ["", columnsByField.marker],
    ["SOURCE", columnsByField.source],
    ["KIND", columnsByField.kind],
    ["ID", columnsByField.id],
    ["INSTALLED", columnsByField.installed],
    ["DESCRIPTION", columnsByField.description],
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
        [selectedRow ? ">" : "", columnsByField.marker],
        [resource.catalog.toUpperCase(), columnsByField.source],
        [resource.kind, columnsByField.kind],
        [resource.id, columnsByField.id],
        [installed, columnsByField.installed],
        [resource.description, columnsByField.description],
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

  return h(Box, { flexDirection: "column", paddingX: 1 },
    h(Text, { bold: true, color: "cyan" }, "INSTALL FROM CATALOG"),
    h(Text, null, fitText(
      `AVAILABLE  ${visible.length}/${candidates.length}  ·  ${pageRange}  ·  CATALOG ${catalogFilter.toUpperCase()}  ·  KIND ${kindFilter.toUpperCase()}`,
      columns - 2,
    )),
    h(Panel, { title: "CATALOG RESOURCES", marginTop: 1 },
      h(Text, { color: "gray" },
        fitText(`Filter ${filterMode ? `${query}▏` : query || "(F to filter)"}`, contentWidth)),
      h(Text, { bold: true }, tableHeader),
      ...tableRows,
    ),
    h(Panel, {
      title: selected ? `CATALOG ENTRY ${selected.id}` : "CATALOG ENTRY",
      color: "blue",
      marginTop: 1,
    }, ...detailRows.map((line, index) => h(Text, {
      key: `catalog-detail-${index}`,
      dimColor: !selected && index > 0,
    }, fitText(line, contentWidth)))),
    h(Text, { dimColor: true },
      fitText(
        filterMode
          ? "TYPE FILTER · ENTER APPLY · BACKSPACE EDIT · ESC CLEAR"
          : "C catalog · K kind · F filter · ↑↓ navigate · ENTER select · ESC back",
        columns - 2,
      )),
  );
}
