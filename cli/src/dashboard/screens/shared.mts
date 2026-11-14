"use strict";

import React, { type ReactNode, useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { CatalogResource } from "../../catalog/entries.js";
import type { DashboardControlFocus, DashboardFilter } from "../input-transport.mjs";
import { DASHBOARD_THEME } from "../colors.js";
import { dashboardStatus, fitText, wrapText } from "../helpers.mjs";

const h = React.createElement;
const OSC8_OPEN = "\u001b]8;;";
const OSC8_CLOSE = "\u001b]8;;\u001b\\";

function AnimatedTitle({ width, versionLabel, screenName, metadata }: {
  width: number;
  versionLabel: string;
  screenName: string;
  metadata: string;
}) {
  return h(Box, { width, flexDirection: "column" },
    h(Text, { color: DASHBOARD_THEME.semantic.accents.primary, bold: true }, fitText("KITIA", width)),
    h(Text, { color: DASHBOARD_THEME.semantic.accents.primary, bold: true },
      fitText(`${versionLabel} · ${screenName}`, width)),
    h(Text, { dimColor: true }, fitText(metadata, width)));
}

export const DASHBOARD_HEADER_ROWS = 3;
function AnimatedBrand({ art, catWidth, textWidth, versionLabel, screenName, metadata }: {
  art: string[];
  catWidth: number;
  textWidth: number;
  versionLabel: string;
  screenName: string;
  metadata: string;
}) {
  return h(Box, { flexDirection: "row", height: DASHBOARD_HEADER_ROWS, flexShrink: 0 },
    h(Box, { width: catWidth, marginRight: 2, flexDirection: "column" },
      ...art.map((line, row) => h(Text, {
        key: row,
        color: DASHBOARD_THEME.semantic.accents.primary,
        bold: true,
        wrap: "truncate-end",
      }, line))),
    h(AnimatedTitle, { width: textWidth, versionLabel, screenName, metadata }));
}


const shortcutKey = /^(?:Delete|BACKSPACE|ENTER|ESC|PgUp|PgDn|↑↓|[A-Z0-9])$/u;

function shortcutHint(value: string, width: number) {
  const visible = fitText(value, width);
  if (visible === "Actions" || visible === "Filters" || visible === "Display" || visible === "Navigation") {
    return h(Text, {
      color: DASHBOARD_THEME.semantic.accents.shortcutCategory,
      bold: true,
    }, visible);
  }
  const parts = visible.split(/(Delete|BACKSPACE|ENTER|ESC|PgUp|PgDn|↑↓|[A-Z])/g);
  return h(Text, { dimColor: true }, ...parts.map((part, index) =>
    shortcutKey.test(part)
      ? h(Text, { key: `shortcut-${index}`, bold: true, color: DASHBOARD_THEME.semantic.accents.primary }, part)
      : part));
}

export function PanelHeader({
  title, color = DASHBOARD_THEME.semantic.accents.primary, children,
}: { title: string; color?: string; children?: ReactNode }) {
  return h(Box, {
    flexDirection: "column", flexShrink: 0,
    borderStyle: "single", borderTop: false, borderLeft: false, borderRight: false,
    borderColor: color,
  },
  h(Text, { bold: true, color }, title),
  children);
}

export function Panel({
  title,
  children,
  headerContent,
  color = DASHBOARD_THEME.semantic.accents.primary,
  width,
  marginTop = 0,
  marginLeft = 0,
  flexGrow = 0,
  flexShrink = 0,
  separateHeader = false,
  bordered = true,
  backgroundColor,
}: {
  title: string;
  children?: ReactNode;
  headerContent?: ReactNode;
  color?: string;
  width?: number;
  marginTop?: number;
  marginLeft?: number;
  flexGrow?: number;
  flexShrink?: number;
  separateHeader?: boolean;
  bordered?: boolean;
  backgroundColor?: string;
}) {
  return h(Box, {
    flexDirection: "column",
    flexShrink,
    flexGrow,
    borderStyle: bordered ? "single" : undefined,
    borderColor: color,
    backgroundColor,
    paddingX: bordered ? 1 : 2,
    marginTop,
    marginLeft,
    width,
  }, separateHeader
    ? h(PanelHeader, { title, color }, headerContent)
    : h(Text, { bold: true, color }, title), children);
}
export function InventorySummaryCards({ resources, width, stacked = false, compact = false, ultraCompact = false, marginTop = 1 }: {
  resources: CatalogResource[];
  width: number;
  stacked?: boolean;
  compact?: boolean;
  ultraCompact?: boolean;
  marginTop?: number;
}) {
  const managed = resources.filter((resource) => resource.managed !== false);
  const current = managed.filter((resource) => dashboardStatus(resource) === "current").length;
  const updates = managed.filter((resource) => dashboardStatus(resource) === "update").length;
  const warnings = managed.filter((resource) => dashboardStatus(resource) === "attention").length;
  const cards = [
    {
      title: "PROJECT",
      count: resources.filter((resource) => resource.scope === "project").length,
      managed: managed.filter((resource) => resource.scope === "project").length,
      color: DASHBOARD_THEME.semantic.terminalScope.project,
    },
    {
      title: "USER",
      count: resources.filter((resource) => resource.scope === "user").length,
      managed: managed.filter((resource) => resource.scope === "user").length,
      color: DASHBOARD_THEME.semantic.terminalScope.user,
    },
    {
      title: "UPDATES",
      count: updates,
      note: `${current} current · ${warnings} warning(s)`,
      color: updates + warnings
        ? DASHBOARD_THEME.semantic.inventoryStatus.attention
        : DASHBOARD_THEME.semantic.inventoryStatus.current,
    },
  ];
  if (ultraCompact) {
    return h(Box, { flexDirection: "row", width, marginTop, justifyContent: "space-between" },
      ...cards.map((card, index) => h(Text, {
        key: `compact-summary-${card.title}`,
        color: card.color,
        bold: true,
      }, `${card.title} ${card.count}${index < cards.length - 1 ? " ·" : ""}`)));
  }
  const gap = 1;
  const availableCardWidth = width - gap * 2;
  const baseCardWidth = Math.floor(availableCardWidth / 3);
  const cardWidths = cards.map((_, index) => stacked
    ? width
    : baseCardWidth + Number(index < availableCardWidth % 3));
  return h(Box, { flexDirection: stacked ? "column" : "row", width, marginTop, alignItems: "stretch" },
    ...cards.map((card, index) => {
      const managedCount = "managed" in card ? card.managed : 0;
      const note = "managed" in card
        ? `${managedCount} managed · ${card.count - managedCount} unmanaged`
        : card.note;
      const cardNode = compact
        ? h(Box, {
          key: card.title,
          width: cardWidths[index],
          height: 3,
          borderStyle: "single",
          borderColor: card.color,
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        },
        h(Text, { color: DASHBOARD_THEME.semantic.accents.muted }, card.title),
        h(Text, { bold: true, color: card.color }, String(card.count)))
        : h(Panel, {
          key: card.title,
          title: card.title,
          color: card.color,
          width: cardWidths[index],
          marginTop: stacked && index ? 1 : 0,
          marginLeft: !stacked && index ? gap : 0,
        },
        h(Box, { flexDirection: "row", justifyContent: "space-between" },
          h(Text, { dimColor: true }, fitText(note, Math.max(1, cardWidths[index] - 8))),
          h(Text, { bold: true, color: card.color }, String(card.count))));
      return compact && !stacked ? h(Box, {
        key: `compact-gap-${card.title}`,
        marginLeft: index ? gap : 0,
      }, cardNode) : cardNode;
    }));
}
export interface JoinedWorkspaceLayout {
  innerWidth: number;
  listWidth: number;
  detailsWidth: number;
  dividerWidth: number;
  contentHeight: number;
  listRows: number;
  detailsRows: number;
  detailsContentRows: number;
  firstResourceRowOffset: number;
}

export function joinedWorkspaceLayout(
  width: number,
  height: number,
  stacked: boolean,
  showDetails: boolean,
  detailsFooterRows = 0,
  listShare = 0.76,
): JoinedWorkspaceLayout {
  const innerWidth = Math.max(1, width - 2);
  const contentHeight = Math.max(1, height - 2);
  const sideBySide = showDetails && !stacked;
  const dividerWidth = sideBySide ? 1 : 0;
  const listWidth = sideBySide
    ? Math.max(1, Math.floor((innerWidth - dividerWidth) * listShare))
    : innerWidth;
  const detailsWidth = sideBySide ? Math.max(1, innerWidth - dividerWidth - listWidth) : 0;
  const stackedDetails = showDetails && stacked;
  const bodyRows = Math.max(0, contentHeight - (stackedDetails ? 6 : 3));
  const detailsRows = sideBySide
    ? Math.max(1, contentHeight - 2)
    : stackedDetails
      ? Math.min(Math.max(0, bodyRows - 1), Math.max(detailsFooterRows + 4, Math.floor(bodyRows * 0.68)))
      : 0;
  const listRows = stackedDetails ? Math.max(1, bodyRows - detailsRows) : Math.max(1, bodyRows);
  return {
    innerWidth,
    listWidth,
    detailsWidth,
    dividerWidth,
    contentHeight,
    listRows,
    detailsRows,
    detailsContentRows: Math.max(0, detailsRows - detailsFooterRows),
    firstResourceRowOffset: 4,
  };
}

export function JoinedWorkspace({
  width,
  height,
  layout,
  showDetails,
  listTitle,
  listMeta,
  listHeader,
  listRows,
  detailsTitle,
  details,
  detailsFooter,
  detailsHint,
  color = DASHBOARD_THEME.semantic.accents.detailPanel,
}: {
  width: number;
  height: number;
  layout: JoinedWorkspaceLayout;
  showDetails: boolean;
  listTitle: string;
  listMeta: string;
  listHeader: string;
  listRows: ReactNode[];
  detailsTitle: string;
  details: ReactNode[];
  detailsFooter?: ReactNode;
  detailsHint?: string;
  color?: string;
}) {
  const horizontal = (leftWidth: number, rightWidth = 0) => h(Box, {
    flexDirection: "row",
    width: leftWidth + rightWidth + Number(Boolean(rightWidth)),
    height: 1,
  },
  h(Text, { color }, "─".repeat(leftWidth)),
  ...(rightWidth ? [
    h(Text, { key: "junction", color }, "┼"),
    h(Text, { key: "right-rule", color }, "─".repeat(rightWidth)),
  ] : []));
  const fillRows = (items: ReactNode[], count: number, key: string) => [
    ...items.slice(0, count),
    ...Array.from({ length: Math.max(0, count - items.length) }, (_, index) =>
      h(Text, { key: `${key}-empty-${index}` }, " ")),
  ];
  const sideBySide = showDetails && layout.detailsWidth > 0;
  const titleMetaWidth = Math.min(layout.listWidth, Math.max(12, Math.floor(layout.listWidth * 0.32)));
  const titleWidth = Math.max(1, layout.listWidth - titleMetaWidth - 1);
  const listColumnHeight = sideBySide || !showDetails ? layout.contentHeight : 3 + layout.listRows;
  const listColumn = h(Box, {
    key: "workspace-list",
    flexDirection: "column",
    width: layout.listWidth,
    height: listColumnHeight,
    flexShrink: 0,
  },
  h(Box, { flexDirection: "row", height: 1, width: layout.listWidth, justifyContent: "space-between" },
    h(Text, { color: DASHBOARD_THEME.semantic.accents.primary, bold: true }, fitText(listTitle, titleWidth)),
    h(Text, { color: DASHBOARD_THEME.semantic.accents.muted }, fitText(listMeta, titleMetaWidth))),
  horizontal(layout.listWidth),
  h(Text, { color: DASHBOARD_THEME.semantic.accents.muted, bold: true }, listHeader),
  ...fillRows(listRows, layout.listRows, "workspace-row"));
  const divider = sideBySide ? h(Box, {
    key: "workspace-divider",
    flexDirection: "column",
    width: 1,
    height: layout.contentHeight,
    flexShrink: 0,
  }, ...Array.from({ length: layout.contentHeight }, (_, index) => h(Text, {
    key: `workspace-divider-${index}`,
    color,
  }, index === 1 ? "┼" : "│"))) : null;
  const detailsContent = details.slice(0, layout.detailsContentRows);
  const detailsColumnWidth = sideBySide ? layout.detailsWidth : layout.innerWidth;
  const detailsHeaderWidth = Math.max(1, detailsColumnWidth - 1);
  const hintWidth = detailsHint ? Math.min(detailsHeaderWidth, detailsHint.length) : 0;
  const detailsTitleWidth = Math.max(1, detailsHeaderWidth - hintWidth - Number(Boolean(detailsHint)));
  const detailsHeader = h(Box, {
    flexDirection: "row",
    width: detailsHeaderWidth,
    height: 1,
    justifyContent: "space-between",
  },
  h(Text, { color: DASHBOARD_THEME.semantic.accents.primary, bold: true }, fitText(detailsTitle, detailsTitleWidth)),
  ...(detailsHint ? [h(Text, {
    color: DASHBOARD_THEME.semantic.accents.muted,
    bold: true,
  }, fitText(detailsHint, hintWidth))] : []));
  const detailsSection = showDetails ? h(Box, {
    key: "workspace-details",
    flexDirection: "column",
    width: detailsColumnWidth,
    height: sideBySide ? layout.contentHeight : undefined,
    flexShrink: 0,
    paddingLeft: 1,
  },
  detailsHeader,
  horizontal(detailsHeaderWidth),
  ...detailsContent,
  ...(detailsFooter ? [detailsFooter] : [])) : null;
  const content = sideBySide
    ? h(Box, { flexDirection: "row", width: layout.innerWidth, height: layout.contentHeight, alignItems: "stretch" },
      listColumn, divider, detailsSection)
    : h(Box, { flexDirection: "column", width: layout.innerWidth, height: layout.contentHeight, alignItems: "stretch" },
      listColumn,
      ...(showDetails ? [
        h(Text, { key: "workspace-detail-divider", color: DASHBOARD_THEME.semantic.accents.detailPanel },
          "─".repeat(layout.innerWidth)),
        detailsSection,
      ] : []));
  return h(Box, {
    width,
    height,
    borderStyle: "single",
    borderColor: color,
    flexShrink: 0,
    flexDirection: "column",
  }, content);
}

export function useDashboardDetailPaging({ lines, viewport, enabled, filterMode, focus, menuFilter, resetKey }: {
  lines: ReactNode[];
  viewport: number;
  enabled: boolean;
  filterMode: boolean;
  focus: DashboardControlFocus;
  menuFilter?: DashboardFilter | null;
  resetKey: readonly unknown[];
}) {
  const [offset, setOffset] = useState(0);
  const maxOffset = viewport > 0 ? Math.max(0, lines.length - viewport) : 0;
  const visibleOffset = Math.min(offset, maxOffset);
  useEffect(() => setOffset(0), resetKey);
  useEffect(() => {
    if (offset !== visibleOffset) setOffset(visibleOffset);
  }, [offset, visibleOffset]);
  const canPage = enabled && !filterMode && !menuFilter && (focus === "list" || focus === "actions") && maxOffset > 0;
  useInput((input, key) => {
    const step = Math.max(1, viewport - 1);
    if (key.pageUp || input === "\u001b[5~") {
      setOffset((current) => Math.max(0, Math.min(current, maxOffset) - step));
    } else if (key.pageDown || input === "\u001b[6~") {
      setOffset((current) => Math.min(maxOffset, Math.min(current, maxOffset) + step));
    }
  }, { isActive: canPage });
  return {
    visibleLines: lines.slice(visibleOffset, visibleOffset + Math.max(0, viewport)),
    isClipped: maxOffset > 0,
    canPage,
  };
}

export function DetailsPanel({
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
    title, children, color: DASHBOARD_THEME.semantic.accents.detailPanel, width, marginTop, marginLeft, flexGrow, flexShrink,
    separateHeader: true,
  });

}
export type ShortcutCategory = "Actions" | "Filters" | "Display" | "Navigation";
export function categorizedShortcutLines(
  groups: Partial<Record<ShortcutCategory, string[]>>,
): string[] {
  return (["Actions", "Filters", "Display", "Navigation"] as const).flatMap((category) => {
    const shortcuts = groups[category] || [];
    return shortcuts.length ? [category, shortcuts.join(" · ")] : [];
  });
}
export function wrappedShortcutLines(lines: string[], width?: number) {
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

export function ShortcutsPanel({ lines, width, marginTop = 0, color, backgroundColor }: {
  lines: string[];
  width?: number;
  marginTop?: number;
  color?: string;
  backgroundColor?: string;
}) {
  return h(Panel, { title: "SHORTCUTS", width, marginTop, color, backgroundColor, separateHeader: true },
    ...wrappedShortcutLines(lines, width).map((line) => shortcutHint(line, Math.max(1, (width || 80) - 4))));
}
export function shortcutFooterLines(lines: string[], width: number): string[] {
  const headings = new Set(["Actions", "Filters", "Display", "Navigation"]);
  const shortcuts = lines.filter((line) => !headings.has(line)).flatMap((line) => line.split(" · "));
  const lineWidth = Math.max(1, width);
  const rows: string[] = [];
  let current = "";
  for (const shortcut of shortcuts) {
    const next = current ? `${current} · ${shortcut}` : shortcut;
    if (current && next.length > lineWidth) {
      rows.push(current);
      current = shortcut;
    } else {
      current = next;
    }
  }
  if (current) rows.push(current);
  return rows.flatMap((line) => line.length > lineWidth ? wrapText(line, lineWidth) : [line]);
}

export function ShortcutFooter({ lines, width }: { lines: string[]; width: number }) {
  const rows = shortcutFooterLines(lines, width);
  return rows.length
    ? h(Box, {
      position: "absolute",
      bottom: 0,
      left: 0,
      width,
      flexDirection: "column",
    },
    h(Text, { color: DASHBOARD_THEME.semantic.accents.detailPanel }, "─".repeat(width)),
    ...rows.map((line, index) => h(React.Fragment, { key: `shortcut-footer-${index}` },
      shortcutHint(line, width))))
    : null;
}

export function detailValue(
  key: string,
  value: unknown,
  width: number,
  maxLines = 1,
  color: string = DASHBOARD_THEME.semantic.accents.muted,
 ) {
  return wrapText(value, width, maxLines).map((line, index) =>
    h(Text, { key: `${key}-value-${index}`, color }, fitText(line, width)));
}
export function detailLocations(key: string, locations: { text: string; href?: string }[], width: number) {
  if (!locations.length) return detailValue(key, "-", width, Infinity);
  const lines = [];
  for (const [locationIndex, location] of locations.entries()) {
    if (location.href) {
      for (const [lineIndex, line] of wrapText(location.text, width).entries()) {
        lines.push(h(Text, { key: `${key}-${locationIndex}-${lineIndex}`, color: DASHBOARD_THEME.semantic.accents.muted },
          `${OSC8_OPEN}${location.href}\u001b\\${line}${OSC8_CLOSE}`));
      }
    } else {
      lines.push(...detailValue(`${key}-${locationIndex}`, location.text, width, Infinity));
    }
  }
  return lines;
}

export function detailField(
  key: string,
  label: string,
  value: unknown,
  width: number,
  maxLines = 1,
  color: string = DASHBOARD_THEME.semantic.accents.muted,
 ) {
  return [
    h(Text, { key: `${key}-label`, color: DASHBOARD_THEME.semantic.accents.label, bold: true }, fitText(label, width)),
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

export function DashboardHeader({ versionLabel, screenName, metadata, columns }: {
  versionLabel: string;
  screenName: string;
  metadata: string;
  columns: number;
  activeSection?: "inventory" | "browse" | "catalogs";
}) {
  const [grooming, setGrooming] = useState<{ activity: "idle" | "lick" | "scratch" | "wink"; frame: number }>({
    activity: "idle", frame: 0,
  });
  const availableWidth = Math.max(1, columns - 2);
  const catWidth = Math.min(8, Math.max(1, availableWidth - 3));
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
    " /\\_/\\ ",
    grooming.activity === "wink" ? "( -.- )" : "( o.o )",
    " > ^ < ",
  ];
  const lickingFrames = [
    [" /\\_/\\ ", "( -.- )", " > v < "],
    [" /\\_/\\ ", "( -.- )", " > v < "],
  ];
  const scratchingFrames = [
    [" /\\_/\\ ", "( o.- )", " > ^ < "],
    [" /\\_/\\ ", "( o.- )", " > ^ < "],
  ];
  const art = grooming.activity === "lick" ? lickingFrames[grooming.frame]
    : grooming.activity === "scratch" ? scratchingFrames[grooming.frame] : sittingFrame;
  return h(AnimatedBrand, { art, catWidth, textWidth, versionLabel, screenName, metadata });
}

