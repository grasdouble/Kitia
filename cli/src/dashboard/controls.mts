"use strict";

import React from "react";
import { Box, measureElement, Text } from "ink";
import type { DOMElement } from "ink";
import { DASHBOARD_HEADER_ROWS } from "./screens/shared.mjs";
import { DASHBOARD_THEME } from "./colors.js";
import {
  DashboardMouseRegions,
  type DashboardControlFocus,
  type DashboardFilter,
  type DashboardMouseRegion,
  type DashboardSection,
} from "./input-transport.mjs";

const h = React.createElement;
const MAX_MENU_OPTIONS = 5;

export interface DashboardControlButton {
  id: string;
  label: string;
}

export interface DashboardControlFilter {
  id: DashboardFilter;
  value: string;
  options: string[];
}

export type DashboardControlPart = "all" | "tabs" | "filters";
export type DashboardControlLayoutMode = "stacked" | "toolbar";

export interface DashboardControlsProps {
  columns: number;
  rows?: number;
  section: DashboardSection;
  sectionCounts?: Partial<Record<DashboardSection, number>>;
  focus: DashboardControlFocus;
  query: string;
  searchActive: boolean;
  showSearch?: boolean;
  filters?: DashboardControlFilter[];
  menuFilter?: DashboardFilter | null;
  menuOptions?: string[];
  menuIndex?: number;
  modalActive?: boolean;
  actions?: DashboardControlButton[];
  actionsInToolbar?: boolean;
  actionIndex?: number;
  mouse?: DashboardMouseRegions;
  /** Render the tab strip and filters independently around section content. */
  part?: DashboardControlPart;
  /** Arrange search and filter controls on one row when they fit. */
  layout?: DashboardControlLayoutMode;
  /** Additional rows after the physical brand header, used for mouse hit testing. */
  rowOffset?: number;
  /** Use readable selected-card colors for contextual actions inside a selected surface. */
  selectedSurface?: boolean;
}

interface ControlItem {
  id: string;
  label: string;
  target: DashboardMouseRegion["target"];
  text?: string;
}

type LayoutItem = ControlItem & { text: string; width: number };
type ControlLineKind = "tabs" | "tab-underline" | "labels" | "fields" | "menu" | "menu-heading" | "actions";

interface ControlLine {
  row: number;
  items: LayoutItem[];
  kind: ControlLineKind;
  searchWidth?: number;
  text?: string;
}

export interface DashboardControlsLayout {
  width: number;
  height: number;
  lines: ControlLine[];
  menuFirst: number;
  menuCount: number;
}


function splitControlLines(items: LayoutItem[], maxWidth: number, row: number, kind: ControlLineKind, stride = 1) {
  const lines: ControlLine[] = [];
  let lineItems: LayoutItem[] = [];
  let used = 0;
  const width = Math.max(1, maxWidth);
  for (const item of items) {
    const itemWidth = Math.max(1, Math.min(width, item.width));
    if (lineItems.length && used + 1 + itemWidth > width) {
      lines.push({ row: row + lines.length * stride, kind, items: lineItems });
      lineItems = [];
      used = 0;
    }
    lineItems.push({ ...item, width: itemWidth });
    used += (lineItems.length > 1 ? 1 : 0) + itemWidth;
  }
  if (lineItems.length) lines.push({ row: row + lines.length * stride, kind, items: lineItems });
  return lines;
}

function clipped(value: string, width: number) {
  if (width <= 0) return "";
  const chars = Array.from(value);
  return chars.length > width ? `${chars.slice(0, Math.max(0, width - 1)).join("")}…` : value;
}

function filterLabel(filter: DashboardFilter) {
  return filter === "kind" ? "Kind" : filter === "catalog" ? "Catalog" : "License";
}

function filterValue(filter: DashboardControlFilter) {
  if (filter.value !== "all") return filter.value;
  return filter.id === "kind" ? "All kinds" : filter.id === "catalog" ? "All catalogs" : "All licenses";
}

function filterWidth(filter: DashboardControlFilter, width: number) {
  return Math.min(width, Math.max(8, filterLabel(filter.id).length, Math.min(22, filterValue(filter).length + 5)));
}

export function dashboardControlsLayout(props: DashboardControlsProps): DashboardControlsLayout {
  const width = Math.max(1, props.columns - 2);
  const fieldRows = props.rows && props.rows < 40 ? 2 : 4;
  const lines: ControlLine[] = [];
  if (props.modalActive) return { width, height: 0, lines, menuFirst: 0, menuCount: 0 };
  const part = props.part || "all";
  let row = 0;
  if (part !== "filters") {
    const sectionNames: Record<DashboardSection, string> = {
      inventory: "Inventory",
      browse: "Browse resources",
      catalogs: "Catalogs",
    };
    const tabs: LayoutItem[] = (["inventory", "browse", "catalogs"] as const).map((section) => ({
      id: section,
      label: sectionNames[section],
      text: `${sectionNames[section]} ${props.sectionCounts?.[section] ?? 0}`,
      width: sectionNames[section].length + String(props.sectionCounts?.[section] ?? 0).length + 1 +
        Number(props.focus === "tabs" && props.section === section) * 2,
      target: { type: "section", section },
    }));
    const tabLines = splitControlLines(tabs, width, row, "tabs", 2);
    for (const tabLine of tabLines) {
      lines.push(tabLine, { row: tabLine.row + 1, kind: "tab-underline", items: tabLine.items });
    }
    row += tabLines.length * 2;
  }
  if (part === "tabs") {
    return { width, height: row, lines, menuFirst: 0, menuCount: 0 };
  }

  const filters = ["kind", "catalog", "license"].flatMap((id) =>
    (props.filters || []).filter((filter) => filter.id === id));
  const showSearch = props.showSearch !== false;
  const searchItem = (fieldWidth: number): LayoutItem => ({
    id: "search",
    label: "Search",
    text: props.query || (props.searchActive ? "" : "Search resources…"),
    width: fieldWidth,
    target: { type: "focus", focus: "search" },
  });
  const selectorItems: LayoutItem[] = filters.map((filter) => ({
    id: filter.id,
    label: filterLabel(filter.id),
    text: filterValue(filter),
    width: filterWidth(filter, width),
    target: { type: "filter-open", filter: filter.id },
  }));
  const selectorWidth = selectorItems.reduce((total, item, index) => total + item.width + Number(index > 0), 0);
  const canUseToolbar = props.layout === "toolbar" && showSearch && selectorItems.length > 0 &&
    selectorWidth + 18 + Number(selectorItems.length) <= width;
  if (canUseToolbar) {
    const searchWidth = width - selectorWidth - selectorItems.length;
    const items = [searchItem(searchWidth), ...selectorItems];
    lines.push({ row, kind: "labels", items }, { row: row + 1, kind: "fields", items });
    row += fieldRows;
  } else {
    if (showSearch) {
      const item = searchItem(width);
      lines.push({ row, kind: "labels", items: [item] }, { row: row + 1, kind: "fields", items: [item] });
      row += fieldRows;
    }
    const selectorLines = splitControlLines(selectorItems, width, row, "fields", fieldRows);
    for (const selectorLine of selectorLines) {
      lines.push({ row: selectorLine.row, kind: "labels", items: selectorLine.items }, { ...selectorLine, row: selectorLine.row + 1 });
      row += fieldRows;
    }
  }

  const options = props.menuFilter ? props.menuOptions || [] : [];
  if (options.length) {
    lines.push({ row, kind: "menu-heading", items: [], text: `Choose ${props.menuFilter} · arrows · Enter` });
    row += 1;
    const menuCount = Math.min(MAX_MENU_OPTIONS, options.length);
    const maxFirst = Math.max(0, options.length - menuCount);
    const menuFirst = Math.max(0, Math.min((props.menuIndex || 0) - menuCount + 1, maxFirst));
    for (let index = menuFirst; index < menuFirst + menuCount; index += 1) {
      const value = options[index];
      lines.push({
        row,
        kind: "menu",
        items: [{
          id: `filter-option-${index}`,
          label: value,
          text: value,
          width,
          target: { type: "filter-option", filter: props.menuFilter!, value },
        }],
      });
      row += 1;
    }
    lines.push({ row, kind: "menu-heading", items: [], text: "" });
    row += 1;
  }

  if (props.actionsInToolbar && props.actions?.length) {
    const actionItems = props.actions.map((action): LayoutItem => ({
      id: action.id,
      label: action.label,
      text: action.label,
      width: Math.min(width, action.label.length + 4),
      target: { type: "action", action: action.id },
    }));
    const actionLines = splitControlLines(actionItems, width, row, "actions", 3);
    for (const actionLine of actionLines) {
      lines.push(actionLine);
      row += 3;
    }
  }
  return {
    width,
    height: row,
    lines,
    menuFirst: props.menuFilter && props.menuOptions?.length
      ? Math.max(0, Math.min((props.menuIndex || 0) - MAX_MENU_OPTIONS + 1, props.menuOptions.length - MAX_MENU_OPTIONS))
      : 0,
    menuCount: props.menuFilter && props.menuOptions?.length
      ? Math.min(MAX_MENU_OPTIONS, props.menuOptions.length)
      : 0,
  };
}

function actionColor(id: string) {
  const { accents } = DASHBOARD_THEME.semantic;
  if (id === "remove" || id === "remove-catalog") return accents.danger;
  if (id === "install" || id === "update" || id === "add-catalog" || id === "refresh-catalog") return accents.primary;
  return accents.neutral;
}

function buttonNodes(item: LayoutItem, active: boolean, selectedSurface = false) {
  const width = Math.max(1, item.width);
  const innerWidth = Math.max(0, width - 4);
  const textWidth = Math.max(0, width - 2);
  const color = actionColor(item.id);
  const borderColor = active ? DASHBOARD_THEME.semantic.selected : color;
  const top = width > 1 ? `╭${"─".repeat(Math.max(0, width - 2))}╮` : "╭";
  const bottom = width > 1 ? `╰${"─".repeat(Math.max(0, width - 2))}╯` : "╰";
  const label = clipped(item.label, innerWidth).padEnd(innerWidth);
  const content = width >= 4 ? `│ ${label} │` : width > 1 ? `│${clipped(item.label, textWidth).padEnd(textWidth)}│` : "│";
  const textStyle = {
    color: selectedSurface && !active ? DASHBOARD_THEME.semantic.selectedForeground : color,
    bold: active,
    underline: active,
  };
  return [
    h(Text, { key: `${item.id}-top`, color: borderColor, wrap: "truncate-end" }, clipped(top, width)),
    h(Text, { key: `${item.id}-content`, color: textStyle.color, bold: textStyle.bold, underline: textStyle.underline }, clipped(content, width)),
    h(Text, { key: `${item.id}-bottom`, color: borderColor, wrap: "truncate-end" }, clipped(bottom, width)),
  ];
}

function fieldBorder(width: number, side: "top" | "middle" | "bottom", value = "", color: string) {
  const fieldWidth = Math.max(1, width);
  if (fieldWidth === 1) return side === "middle" ? clipped(value, 1) : side === "top" ? "╭" : "╰";
  const inner = fieldWidth - 2;
  if (side === "top") return `╭${"─".repeat(Math.max(0, inner))}╮`;
  if (side === "bottom") return `╰${"─".repeat(Math.max(0, inner))}╯`;
  if (fieldWidth < 4) return `│${clipped(value, Math.max(0, fieldWidth - 2)).padEnd(Math.max(0, fieldWidth - 2))}│`;
  return h(React.Fragment, null,
    h(Text, { color }, "│"),
    h(Text, { color: DASHBOARD_THEME.semantic.accents.label }, ` ${clipped(value, Math.max(0, inner - 2)).padEnd(Math.max(0, inner - 2))} `),
    h(Text, { color }, "│"));
}

export function DashboardControls(props: DashboardControlsProps) {
  const layout = dashboardControlsLayout(props);
  const regions: DashboardMouseRegion[] = [];
  const children: React.ReactNode[] = [];
  const mouseTop = (row: number) => DASHBOARD_HEADER_ROWS + (props.rowOffset || 0) + row + 1;
  const addControlRegion = (item: LayoutItem, x: number, top: number, bottom: number) => {
    regions.push({
      left: x,
      right: Math.min(props.columns - 1, x + item.width - 1),
      top: mouseTop(top),
      bottom: mouseTop(bottom),
      target: item.target,
    });
  };
  for (const line of layout.lines) {
    if (line.kind === "tabs" || line.kind === "tab-underline") {
      const rowChildren: React.ReactNode[] = [];
      let x = 2;
      for (const [index, item] of line.items.entries()) {
        if (index) {
          rowChildren.push(h(Text, { key: `tab-gap-${line.row}-${index}` }, " "));
          x += 1;
        }
        const active = item.target.type === "section" && item.target.section === props.section;
        const focused = props.focus === "tabs" && active;
        if (line.kind === "tabs") {
          const label = `${focused ? "› " : ""}${item.text}`;
          rowChildren.push(h(Text, {
            key: `tab-${item.id}`,
            color: active ? DASHBOARD_THEME.semantic.accents.primary : DASHBOARD_THEME.semantic.accents.muted,
            bold: focused,
          }, clipped(label, item.width)));
          addControlRegion(item, x, line.row, line.row + 1);
        } else {
          rowChildren.push(h(Text, {
            key: `tab-underline-${item.id}`,
            color: active ? DASHBOARD_THEME.semantic.accents.primary : DASHBOARD_THEME.semantic.accents.muted,
          }, (active ? "─" : " ").repeat(item.width)));
        }
        x += item.width;
      }
      if (line.kind === "tab-underline" && x - 2 < layout.width) {
        rowChildren.push(h(Text, {
          key: `tab-underline-rest-${line.row}`,
          color: DASHBOARD_THEME.semantic.accents.muted,
        }, "─".repeat(Math.max(0, layout.width - (x - 2)))));
      }
      children.push(h(Box, {
        key: `control-${line.kind}-${line.row}`,
        flexDirection: "row",
        height: 1,
        width: layout.width,
      }, ...rowChildren));
      continue;
    }
    if (line.kind === "menu-heading") {
      const title = line.text || "";
      const interior = title ? ` ${clipped(title, Math.max(0, layout.width - 4))} ` : "";
      const rule = "─".repeat(Math.max(0, layout.width - interior.length - 2));
      const border = title ? `╭${interior}${rule}╮` : `╰${"─".repeat(Math.max(0, layout.width - 2))}╯`;
      children.push(h(Text, {
        key: `menu-heading-${line.row}`,
        color: DASHBOARD_THEME.semantic.accents.muted,
        wrap: "truncate-end",
      }, clipped(border, layout.width)));
      continue;
    }
    if (line.kind === "labels") {
      const rowChildren: React.ReactNode[] = [];
      for (const [index, item] of line.items.entries()) {
        if (index) rowChildren.push(h(Text, { key: `label-gap-${line.row}-${index}` }, " "));
        const label = `${props.focus === item.id ? "› " : ""}${item.label}`;
        rowChildren.push(h(Text, {
          key: `label-${line.row}-${item.id}`,
          color: props.focus === item.id ? DASHBOARD_THEME.semantic.accents.primary : DASHBOARD_THEME.semantic.accents.label,
          bold: true,
        }, clipped(label, item.width)));
        if (index < line.items.length - 1) {
          rowChildren.push(h(Text, { key: `label-pad-${line.row}-${index}` }, " ".repeat(Math.max(0, item.width - label.length))));
        }
      }
      children.push(h(Box, {
        key: `control-labels-${line.row}`,
        flexDirection: "row",
        height: 1,
        width: layout.width,
      }, ...rowChildren));
      continue;
    }
    if (line.kind === "fields") {
      const compactFields = Boolean(props.rows && props.rows < 40);
      const fieldRows: React.ReactNode[][] = Array.from({ length: compactFields ? 1 : 3 }, () => []);
      let x = 2;
      for (const [index, item] of line.items.entries()) {
        if (index) {
          for (const childrenForRow of fieldRows) childrenForRow.push(h(Text, { key: `field-gap-${line.row}-${index}` }, " "));
          x += 1;
        }
        const focused = props.focus === item.id;
        const color = focused ? DASHBOARD_THEME.semantic.accents.primary : DASHBOARD_THEME.semantic.accents.muted;
        const searchField = item.id === "search";
        const query = props.query || (props.searchActive ? "" : "Search resources…");
        const innerWidth = Math.max(0, item.width - 4);
        const inputValue = searchField
          ? Array.from(query).length > innerWidth
            ? `…${Array.from(query).slice(-(Math.max(0, innerWidth - 1))).join("")}`
            : query
          : `${clipped(item.text, Math.max(0, innerWidth - 1))}▾`;
        const value = searchField && props.searchActive ? `${inputValue}▏` : inputValue;
        if (compactFields) {
          fieldRows[0].push(h(React.Fragment, { key: `field-${line.row}-${item.id}` },
            fieldBorder(item.width, "middle", value, color)));
        } else {
          fieldRows[0].push(h(Text, { key: `field-top-${line.row}-${item.id}`, color }, fieldBorder(item.width, "top", "", color)));
          fieldRows[1].push(h(React.Fragment, { key: `field-middle-${line.row}-${item.id}` },
            fieldBorder(item.width, "middle", value, color)));
          fieldRows[2].push(h(Text, { key: `field-bottom-${line.row}-${item.id}`, color }, fieldBorder(item.width, "bottom", "", color)));
        }
        addControlRegion(item, x, line.row - 1, line.row + (compactFields ? 0 : 2));
        x += item.width;
      }
      fieldRows.forEach((rowChildren, index) => children.push(h(Box, {
        key: `control-fields-${line.row}-${index}`,
        flexDirection: "row",
        height: 1,
        width: layout.width,
      }, ...rowChildren)));
      continue;
    }
    if (line.kind === "actions") {
      const rowChildren = [];
      let x = 2;
      for (const [index, item] of line.items.entries()) {
        if (index) {
          rowChildren.push(h(Text, { key: `toolbar-action-gap-${line.row}-${index}` }, " "));
          x += 1;
        }
        const active = props.focus === "actions" && props.actions?.[props.actionIndex || 0]?.id === item.id;
        rowChildren.push(h(Box, {
          key: `toolbar-action-${line.row}-${item.id}`,
          flexDirection: "column",
          width: item.width,
          height: 3,
          marginRight: index < line.items.length - 1 ? 1 : 0,
        }, ...buttonNodes(item, active)));
        addControlRegion(item, x, line.row, line.row + 2);
        x += item.width;
      }
      children.push(h(Box, {
        key: `toolbar-actions-${line.row}`,
        flexDirection: "row",
        height: 3,
        width: layout.width,
      }, ...rowChildren));
      continue;
    }

    const rowChildren: React.ReactNode[] = [];
    for (const [index, item] of line.items.entries()) {
      const active = props.menuOptions?.[props.menuIndex || 0] === item.label;
      const contentWidth = Math.max(0, layout.width - 4);
      const content = `│ ${active ? "› " : "  "}${clipped(item.label, Math.max(0, contentWidth - 2)).padEnd(Math.max(0, contentWidth - 2))} │`;
      rowChildren.push(h(Text, {
        key: `menu-option-${line.row}-${index}`,
        color: active ? DASHBOARD_THEME.semantic.accents.primary : DASHBOARD_THEME.semantic.accents.neutral,
        bold: active,
      }, clipped(content, layout.width)));
      addControlRegion(item, 2, line.row, line.row);
    }
    children.push(h(Box, {
      key: `menu-option-row-${line.row}`,
      flexDirection: "row",
      height: 1,
      width: layout.width,
    }, ...rowChildren));
  }
  props.mouse?.replace(props.part ? `controls-${props.part}` : "controls", regions);
  return h(Box, { flexDirection: "column", width: layout.width, flexShrink: 0 }, ...children);
}

function actionButtonLines(props: DashboardControlsProps, width: number) {
  if (props.actionsInToolbar || props.modalActive || !props.actions?.length) return [];
  const safeWidth = Math.max(1, width);
  const items = props.actions.map((action): LayoutItem => ({
    id: action.id,
    label: action.label,
    text: action.label,
    width: Math.min(safeWidth, Math.max(1, action.label.length + 4)),
    target: { type: "action", action: action.id },
  }));
  return splitControlLines(items, safeWidth, 0, "actions", 3);
}

export function dashboardActionButtonRows(props: DashboardControlsProps, width: number) {
  const rows = actionButtonLines(props, width).length;
  return rows ? 1 + rows * 3 : 0;
}

export function DashboardActionButtons({ controls, width }: {
  controls: DashboardControlsProps;
  width: number;
}) {
  return h(DashboardActionButtonsLayout, { key: "dashboard-action-buttons", controls, width });
}

function DashboardActionButtonsLayout({ controls, width }: {
  controls: DashboardControlsProps;
  width: number;
}) {
  const lines = actionButtonLines(controls, width);
  const rowRefs = React.useRef<React.RefObject<DOMElement>[]>([]);
  if (rowRefs.current.length !== lines.length) {
    rowRefs.current = lines.map((_, index) => rowRefs.current[index] || React.createRef<DOMElement>());
  }
  React.useLayoutEffect(() => {
    const regions: DashboardMouseRegion[] = [];
    for (const [lineIndex, line] of lines.entries()) {
      const node = rowRefs.current[lineIndex]?.current;
      if (!node) continue;
      const { x, y, clientWidth, clientHeight } = measureElement(node);
      let offset = 0;
      for (const [index, item] of line.items.entries()) {
        if (index) offset += 1;
        const itemWidth = Math.max(0, Math.min(item.width, clientWidth - offset, controls.columns - x - offset));
        if (itemWidth && clientHeight) regions.push({
          left: x + offset + 1,
          right: x + offset + itemWidth,
          top: y + 1,
          bottom: y + clientHeight,
          target: item.target,
        });
        offset += item.width;
      }
    }
    controls.mouse?.replace("actions", regions);
    return () => controls.mouse?.replace("actions", []);
  });
  const output: React.ReactNode[] = [];
  if (lines.length) output.push(h(Text, {
    key: "action-heading",
    color: controls.selectedSurface
      ? DASHBOARD_THEME.semantic.selectedForeground : DASHBOARD_THEME.semantic.accents.shortcutCategory,
    bold: true,
  }, "ACTIONS"));
  lines.forEach((line, lineIndex) => {
    const buttons = line.items.map((item, index) => {
      const active = controls.focus === "actions" && controls.actions?.[controls.actionIndex || 0]?.id === item.id;
      return h(Box, {
        key: `action-button-${item.id}`,
        flexDirection: "column",
        width: item.width,
        height: 3,
        marginRight: index < line.items.length - 1 ? 1 : 0,
      }, ...buttonNodes(item, active, Boolean(controls.selectedSurface)));
    });
    output.push(h(Box, {
      key: `action-row-${line.row}`,
      ref: rowRefs.current[lineIndex],
      flexDirection: "row",
      height: 3,
      width,
    }, ...buttons));
  });
  return output.length ? h(Box, { flexDirection: "column" }, ...output) : null;
}
