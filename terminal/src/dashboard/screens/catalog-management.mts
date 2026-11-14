"use strict";

import React from "react";
import { Box, Text } from "ink";
import type { CatalogResource } from "../../catalog/entries.js";
import { DASHBOARD_THEME } from "../colors.js";
import type { CatalogFreshnessStatus } from "../catalog-freshness.mjs";
import { fitText } from "../helpers.mjs";
import {
  DashboardHeader, DASHBOARD_HEADER_ROWS, InventorySummaryCards, Panel, ShortcutFooter, shortcutFooterLines,
} from "./shared.mjs";
import {
  DashboardActionButtons, dashboardActionButtonRows, DashboardControls, dashboardControlsLayout,
  type DashboardControlsProps,
} from "../controls.mjs";


const h = React.createElement;
const catalogCardActionIds = new Set<string>(["edit-catalog", "refresh-catalog", "remove-catalog"]);
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
  controls,
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
  controls: DashboardControlsProps;
  modalActive?: boolean;
  tourStep?: number | null;
}) {
  const tabControls: DashboardControlsProps = {
    ...controls, part: "tabs", actions: [], actionsInToolbar: false,
  };
  const controlsLayout = dashboardControlsLayout(tabControls);
  const activeIndex = Math.min(selectedIndex, Math.max(0, catalogs.length - 1));
  const selected = catalogs[activeIndex];
  const contentWidth = Math.max(1, columns - 4);
  const freshnessLabels: Record<CatalogFreshnessStatus, string> = {
    checking: "CHECKING", current: "UP TO DATE", outdated: "OUTDATED", unknown: "UNKNOWN",
  };
  const freshnessColors = DASHBOARD_THEME.semantic.catalogFreshness;
  const freshnessOf = (name: string) => freshness[name] || "unknown";
  const catalogCounts = (name: string) => ({
    resources: catalogResources.filter((resource) => resource.catalog === name).length,
    installed: installedResources.filter((resource) => resource.managed !== false && resource.catalog === name).length,
  });
  const detailsContent = selected ? [
    h(Text, { key: "catalog-freshness", color: freshnessColors[freshnessOf(selected.name)] },
      fitText(`FRESHNESS ${freshnessLabels[freshnessOf(selected.name)]}`, contentWidth)),
    ...(rows >= 30 ? [h(Text, { key: "catalog-refresh", color: DASHBOARD_THEME.semantic.accents.muted },
      fitText("Refresh updates metadata only; installed content stays unchanged.", contentWidth))] : []),
  ] : [];

  const makeActionControls = (group: string, ids: string[]): DashboardControlsProps => {
    const actions = (controls.actions || []).filter(({ id }) => ids.includes(id));
    const focusedId = controls.actions?.[controls.actionIndex || 0]?.id;
    const mouse = controls.mouse ? {
      replace: (owner: string, regions: Parameters<NonNullable<DashboardControlsProps["mouse"]>["replace"]>[1]) =>
        controls.mouse?.replace(`catalog-${group}-${owner}`, regions),
    } as unknown as DashboardControlsProps["mouse"] : undefined;
    return {
      ...controls, actions, actionsInToolbar: false, actionIndex: actions.findIndex(({ id }) => id === focusedId), mouse,
      selectedSurface: group === "card",
    };
  };
  const headingActions = makeActionControls("heading", ["add-catalog", "presets", "import-catalogs", "export-catalogs"]);
  const cardActions = makeActionControls("card", ["edit-catalog", "refresh-catalog", "remove-catalog"]);
  const headingActionRows = dashboardActionButtonRows(headingActions, contentWidth);
  const cardActionRows = dashboardActionButtonRows(cardActions, contentWidth);
  const shortcutLine = modalActive ? "" : [
    ...(canAdd ? ["A add", "P presets"] : []),
    ...(canEdit && selected ? ["E edit"] : []),
    ...(canRefresh && selected ? ["R refresh"] : []),
    ...(canRemove && selected ? ["Delete remove"] : []),
    ...(canTransfer ? ["I import", "X export"] : []),
    "D details", "ESC inventory", "1/2/3 sections", "↑↓ navigate", "? guide", "Q quit",
  ].join(" · ");
  const footerLines = shortcutLine ? shortcutFooterLines([shortcutLine], Math.max(1, columns - 2)) : [];
  const footerRows = footerLines.length + Number(Boolean(footerLines.length));
  const ultraCompactSummary = rows < 40;
  const summaryRows = ultraCompactSummary ? 1 : columns < 80 ? 4 : 5;
  const cardBaseRows = 5;
  const selectedExtraRows = selected ? (showDetails ? detailsContent.length : 0) + cardActionRows : 0;
  const fixedRows = DASHBOARD_HEADER_ROWS + controlsLayout.height + summaryRows + 1 + headingActionRows + footerRows + 2;
  const availableCardRows = Math.max(cardBaseRows + 1, rows - fixedRows - selectedExtraRows);
  const viewport = Math.max(1, Math.floor(availableCardRows / (cardBaseRows + 1)));
  const first = Math.max(0, Math.min(activeIndex - viewport + 1, catalogs.length - viewport));
  const page = catalogs.slice(first, first + viewport);
  const rowRegions: NonNullable<Parameters<NonNullable<DashboardControlsProps["mouse"]>["replace"]>[1]> = [];
  let cardTop = DASHBOARD_HEADER_ROWS + controlsLayout.height + summaryRows + 2 + headingActionRows + 1;
  const cardNodes = page.map((catalog, index) => {
    const absoluteIndex = first + index;
    const isSelected = absoluteIndex === activeIndex;
    const counts = catalogCounts(catalog.name);
    const status = freshnessOf(catalog.name);
    const cardHeight = cardBaseRows + (isSelected ? (showDetails ? detailsContent.length : 0) + cardActionRows : 0);
    rowRegions.push({ left: 1, right: columns - 2, top: cardTop, bottom: cardTop + cardHeight - 1,
      target: { type: "row", screen: "catalogs", index: absoluteIndex } });
    const selectedColor = DASHBOARD_THEME.semantic.selectedForeground;
    const selectedBackground = DASHBOARD_THEME.semantic.selected;
    const selectedDetails = isSelected && showDetails ? detailsContent.map((line) => React.isValidElement(line)
      ? React.cloneElement(line as React.ReactElement<{ color?: string; backgroundColor?: string }>, {
        color: selectedColor, backgroundColor: selectedBackground,
      }) : line) : [];
    const card = h(Panel, {
      key: catalog.name, title: fitText(catalog.name, contentWidth), width: columns - 2,
      color: isSelected ? selectedColor
        : tourStep === 2 ? DASHBOARD_THEME.semantic.inventoryStatus.attention : DASHBOARD_THEME.semantic.accents.muted,
      backgroundColor: isSelected ? selectedBackground : undefined,
      marginTop: 1,
    },
    h(Text, {
      key: `${catalog.name}-repository`, color: isSelected ? selectedColor : DASHBOARD_THEME.semantic.accents.muted,
      backgroundColor: isSelected ? selectedBackground : undefined, bold: isSelected,
    }, fitText(`REPOSITORY ${catalog.repository}`, contentWidth)),
    h(Text, {
      key: `${catalog.name}-counts`, color: isSelected ? selectedColor : freshnessColors[status],
      backgroundColor: isSelected ? selectedBackground : undefined, bold: isSelected,
    }, fitText(`RESOURCES ${counts.resources} · INSTALLED ${counts.installed} · ${freshnessLabels[status]}`, contentWidth)),
    ...selectedDetails,
    ...(isSelected ? [DashboardActionButtons({ controls: cardActions, width: contentWidth })] : []));
    cardTop += cardHeight + 1;
    return card;
  });
  React.useLayoutEffect(() => {
    const mouse = controls.mouse;
    if (!mouse) return;
    if (modalActive) {
      mouse.replace("catalog-rows", []);
      return;
    }
    const actionRanges = mouse.getRegions()
      .filter(({ target }) => target.type === "action" && catalogCardActionIds.has(target.action))
      .map(({ top, bottom }) => ({ top, bottom }))
      .sort((left, right) => left.top - right.top || left.bottom - right.bottom)
      .filter((range, index, sorted) => index === 0 || range.top !== sorted[index - 1].top || range.bottom !== sorted[index - 1].bottom);
    const selectableRegions: typeof rowRegions = [];
    for (const region of rowRegions) {
      let available = [{ top: region.top, bottom: region.bottom }];
      for (const actionRange of actionRanges) {
        available = available.flatMap(({ top, bottom }) => {
          if (actionRange.bottom < top || actionRange.top > bottom) return [{ top, bottom }];
          return [
            ...(actionRange.top > top ? [{ top, bottom: actionRange.top - 1 }] : []),
            ...(actionRange.bottom < bottom ? [{ top: actionRange.bottom + 1, bottom }] : []),
          ];
        });
      }
      selectableRegions.push(...available.map((range) => ({ ...region, ...range })));
    }
    mouse.replace("catalog-rows", selectableRegions);
  }, [controls.mouse, modalActive, rowRegions]);
  const heading = h(Box, { flexDirection: "column", width: columns - 2, marginTop: 1 },
    h(Box, { flexDirection: "row", justifyContent: "space-between" },
      h(Text, { bold: true, color: DASHBOARD_THEME.semantic.accents.primary }, `CONNECTED CATALOGS ${catalogs.length}`),
      h(Text, { color: DASHBOARD_THEME.semantic.accents.muted }, catalogs.length ? "" : "Connect a source to browse resources")),
    DashboardActionButtons({ controls: headingActions, width: contentWidth }));
  const empty = catalogs.length ? null : h(Text, { dimColor: true }, "No user catalogs connected.");
  const footer = shortcutLine ? h(ShortcutFooter, { lines: [shortcutLine], width: columns - 2 }) : null;
  return h(Box, { width: columns, height: rows, flexDirection: "column", paddingX: 1, position: "relative", flexShrink: 0 },
    h(DashboardHeader, { versionLabel, screenName: "CATALOG MANAGEMENT", metadata: `USER CATALOGS ${catalogs.length}`, columns }),
    h(DashboardControls, { ...tabControls, modalActive }),
    h(InventorySummaryCards, {
      resources: installedResources,
      width: columns - 2,
      compact: columns < 80 || rows < 50,
      ultraCompact: ultraCompactSummary,
      marginTop: ultraCompactSummary ? 0 : 1,
    }),
    heading,
    ...(page.length ? cardNodes : empty ? [empty] : []),
    footer,
  );
}
