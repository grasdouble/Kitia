"use strict";

import React, { type ReactNode, useEffect, useState } from "react";
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
const OSC8_OPEN = "\u001b]8;;";
const OSC8_CLOSE = "\u001b]8;;\u001b\\";

const kitiaWordmark = [
  "█  ▄▀  ▀█▀  ▀▀█▀▀  ▀█▀  ▄▀▀▀▄",
  "█▀▀▄    █     █     █   █▀▀▀█",
  "▀   ▀  ▀▀▀    ▀    ▀▀▀  ▀   ▀",
];

const titleColorStops = [[34, 211, 238], [167, 139, 250], [244, 114, 182]];
const titleColors = Array.from({ length: 96 }, (_, index) => {
  const segment = Math.floor(index / 32);
  const start = titleColorStops[segment];
  const end = titleColorStops[(segment + 1) % titleColorStops.length];
  return `#${start.map((channel, component) =>
    Math.round(channel + (end[component] - channel) * (index % 32) / 32)
      .toString(16).padStart(2, "0")).join("")}`;
});

function AnimatedTitle({ width, versionLabel, screenName, metadata, phase }: {
  width: number;
  phase: number;
  versionLabel: string;
  screenName: string;
  metadata: string;
}) {
  const pixelTitle = width >= kitiaWordmark[0].length;
  return h(Box, { width, flexDirection: "column" },
    ...(pixelTitle
      ? kitiaWordmark.map((line, row) => h(Text, { key: row },
        ...Array.from(line, (character, column) => h(Text, {
          key: column,
          color: titleColors[(phase + column * 2 + row * 3) % titleColors.length],
        }, character))))
      : [h(Text, { key: "compact", color: "cyan", bold: true }, fitText(`KITIA  ${versionLabel}`, width))]),
    h(Text, { color: "cyan", bold: pixelTitle }, fitText(
      pixelTitle ? `${versionLabel} · ${screenName}` : screenName, width,
    )),
    h(Text, { dimColor: true }, fitText(metadata, width)),
    ...(!pixelTitle ? [h(Text, { key: "blank-1" }, " "), h(Text, { key: "blank-2" }, " ")] : []));
}

function AnimatedBrand({ art, catWidth, textWidth, versionLabel, screenName, metadata }: {
  art: string[];
  catWidth: number;
  textWidth: number;
  versionLabel: string;
  screenName: string;
  metadata: string;
}) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setPhase((value) => (value + 1) % titleColors.length), 60);
    return () => clearInterval(timer);
  }, []);
  return h(Box, { flexDirection: "row", height: 5, flexShrink: 0 },
    h(Box, { width: catWidth, marginRight: 2, flexDirection: "column" },
      ...art.map((line, row) => h(Text, { key: row, bold: true, wrap: "truncate-end" },
        ...Array.from(line.slice(0, catWidth), (character, column) => h(Text, {
          key: column,
          color: titleColors[(phase + column * 2 + row * 3) % titleColors.length],
        }, character))))),
    h(AnimatedTitle, { width: textWidth, versionLabel, screenName, metadata, phase }));
}

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
  flexGrow = 0,
  flexShrink = 0,
}: {
  title: string;
  children?: ReactNode;
  color?: string;
  width?: number;
  marginTop?: number;
  marginLeft?: number;
  flexGrow?: number;
  flexShrink?: number;
}) {
  return h(Box, {
    flexDirection: "column",
    flexShrink,
    flexGrow,
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
  flexGrow = 0,
  flexShrink = 0,
}: {
  title: string;
  children?: ReactNode;
  width?: number;
  marginTop?: number;
  marginLeft?: number;
  flexGrow?: number;
  flexShrink?: number;
}) {
  return h(Panel, {
    title, children, color: "blue", width, marginTop, marginLeft, flexGrow, flexShrink,
  });

}
function wrappedShortcutLines(lines: string[], width?: number) {
  const contentWidth = Math.max(1, (width || 80) - 4);
  return lines.flatMap((line) => {
    const wrapped = [];
    let current = "";
    for (const shortcut of line.split(" · ")) {
      const next = current ? `${current} · ${shortcut}` : shortcut;
      if (current && next.length > contentWidth) {
        wrapped.push(current);
        current = shortcut;
      } else {
        current = next;
      }
    }
    if (current) wrapped.push(current);
    return wrapped.flatMap((row) => wrapText(row, contentWidth));
  });
}

function ShortcutsPanel({ lines, width, marginTop = 0 }: {
  lines: string[];
  width?: number;
  marginTop?: number;
}) {
  return h(Panel, { title: "SHORTCUTS", width, marginTop },
    ...wrappedShortcutLines(lines, width).map((line) => shortcutHint(line, Math.max(1, (width || 80) - 4))));
}

function detailValue(key: string, value: unknown, width: number, maxLines = 1, color = "gray") {
  return wrapText(value, width, maxLines).map((line, index) =>
    h(Text, { key: `${key}-value-${index}`, color }, fitText(line, width)));
}
function detailLocations(key: string, locations: { text: string; href?: string }[], width: number) {
  if (!locations.length) return detailValue(key, "-", width, Infinity);
  const lines = [];
  for (const [locationIndex, location] of locations.entries()) {
    if (location.href) {
      for (const [lineIndex, line] of wrapText(location.text, width).entries()) {
        lines.push(h(Text, { key: `${key}-${locationIndex}-${lineIndex}`, color: "gray" },
          `${OSC8_OPEN}${location.href}\u001b\\${line}${OSC8_CLOSE}`));
      }
    } else {
      lines.push(...detailValue(`${key}-${locationIndex}`, location.text, width, Infinity));
    }
  }
  return lines;
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
  const [grooming, setGrooming] = useState<{ activity: "idle" | "lick" | "scratch" | "wink"; frame: number }>({
    activity: "idle", frame: 0,
  });
  const availableWidth = Math.max(1, columns - 2);
  const catWidth = Math.min(18, Math.max(1, availableWidth - 3));
  const textWidth = Math.max(1, availableWidth - catWidth - 2);
  useEffect(() => {
    let activityTimer: ReturnType<typeof setTimeout>;
    let frameTimer: ReturnType<typeof setInterval> | undefined;
    const scheduleAnimation = () => {
      activityTimer = setTimeout(() => {
        const activities = ["lick", "scratch", "wink"] as const;
        const activity = activities[Math.floor(Math.random() * activities.length)];
        setGrooming({ activity, frame: 0 });
        if (activity !== "wink") {
          frameTimer = setInterval(() => {
            setGrooming((current) => ({ activity, frame: (current.frame + 1) % 2 }));
          }, 300);
        }
        activityTimer = setTimeout(() => {
          clearInterval(frameTimer);
          setGrooming({ activity: "idle", frame: 0 });
          scheduleAnimation();
        }, activity === "wink" ? 180 : 2000 + Math.random() * 2000);
      }, 10000 + Math.random() * 10000);
    };
    scheduleAnimation();
    return () => {
      clearTimeout(activityTimer);
      clearInterval(frameTimer);
    };
  }, []);
  const sittingFrame = [
    "       /\\_/\\",
    grooming.activity === "wink" ? "      (=o.-=)" : "      (=o.o=)",
    "      /:>^<:\\    )",
    "     / .| |. \\  /",
    "     \\__|_|__/_/",
  ];
  const lickingFrames = [
    ["       /\\_/\\", "      (=-.-=)", "      /: v( )   )", "     / .| . \\  /", "     \\__|_|__/_/"],
    ["       /\\_/\\", "      (=-.-=)", "      /: -( )   )", "     / .| . \\  /", "     \\__|_|__/_/"],
  ];
  const scratchingFrames = [
    ["       /\\_/\\", "      (=o.-=)()", "      /:>^< /   )", "     / .| ./ \\ /", "     \\__|_|__/_/"],
    ["       /\\_/\\ ()", "      (=o.-=) /", "      /:>^< /   )", "     / .| ./ \\ /", "     \\__|_|__/_/"],
  ];
  const art = grooming.activity === "lick" ? lickingFrames[grooming.frame]
    : grooming.activity === "scratch" ? scratchingFrames[grooming.frame] : sittingFrame;
  return h(AnimatedBrand, { art, catWidth, textWidth, versionLabel, screenName, metadata });
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
      ...(canExecute && selected && selected.kind === "skill" && selected.managed !== false &&
          selected.source_repository && !selected.bundle_id ? ["V revision"] : []),
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
  const compactDetails = rows < 30;
  const detailsContent = selected
    ? compactDetails
      ? [
        h(Text, { key: "catalog-repository", color: "gray" },
          fitText(`REPOSITORY ${selected.repository}`, detailsContentWidth)),
        h(Text, { key: "catalog-freshness", color: freshnessColors[freshnessOf(selected.name)] },
          fitText(`FRESHNESS ${freshnessLabels[freshnessOf(selected.name)]}`, detailsContentWidth)),
        ...wrapText(
          "REFRESH Updates catalog metadata only; installed resources stay unchanged.",
          detailsContentWidth,
          2,
        ).map((line, index) => h(Text, {
          key: `catalog-refresh-${index}`,
          color: "gray",
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
