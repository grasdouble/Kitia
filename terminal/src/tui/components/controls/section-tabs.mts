"use strict";

import React from "react";
import { Box, Text } from "ink";
import { DASHBOARD_THEME } from "../../colors.js";
import type { DashboardControlFocus, DashboardSection } from "../../input-transport.mjs";
import { clipped } from "./control-rendering.mjs";
import { sectionTabMetrics, type ControlLine, type LayoutItem } from "./control-layout-plan.mjs";

const h = React.createElement;

// SectionTabs: bordered tab row between top rule and active-tab underline; at widths <3
// renders just the first tab (or a rule for the underline/top line).
export function SectionTabs({ line, width, section, focus, onRegion }: {
  line: ControlLine;
  width: number;
  section: DashboardSection;
  focus: DashboardControlFocus;
  onRegion: (item: LayoutItem, x: number, top: number, bottom: number) => void;
}) {
  if (width < 3) {
    const item = line.items[0];
    const active = item?.target.type === "section" && item.target.section === section;
    const focused = active && focus === "tabs";
    const text = line.kind === "tabs"
      ? clipped(`${focused ? "› " : ""}${item?.text || ""}`, width)
      : "─".repeat(width);
    if (line.kind === "tabs" && item) onRegion(item, 2, line.row, line.row + 1);
    return h(Text, {
      key: `tab-fallback-${line.kind}-${line.row}`,
      color: line.kind === "tabs" && active || line.kind === "tab-underline" && active
        ? DASHBOARD_THEME.semantic.accents.primary
        : DASHBOARD_THEME.semantic.accents.muted,
      bold: focused,
    }, text);
  }
  if (line.kind === "tab-top") {
    const rule = width >= 2 ? `┌${"─".repeat(width - 2)}┐` : "─".repeat(width);
    return h(Text, {
      key: `tab-top-${line.row}`,
      color: DASHBOARD_THEME.semantic.accents.muted,
    }, rule);
  }
  const { inset, itemPadding, gap } = sectionTabMetrics(width);
  const interiorWidth = Math.max(0, width - 2);
  const availableWidth = Math.max(0, interiorWidth - inset * 2);
  const rowChildren: React.ReactNode[] = [];
  if (line.kind === "tabs") {
    rowChildren.push(h(Text, {
      key: `tab-left-${line.row}`,
      color: DASHBOARD_THEME.semantic.accents.muted,
    }, "│"));
    if (inset) rowChildren.push(h(Text, { key: `tab-inset-left-${line.row}` }, " ".repeat(inset)));
    let used = 0;
    let x = 3 + inset;
    for (const [index, item] of line.items.entries()) {
      if (index) {
        rowChildren.push(h(Text, { key: `tab-gap-${line.row}-${index}` }, " ".repeat(gap)));
        used += gap;
        x += gap;
      }
      const active = item.target.type === "section" && item.target.section === section;
      const focused = focus === "tabs" && active;
      const label = `${focused ? "› " : ""}${item.text}`;
      const textWidth = Math.max(0, item.width - itemPadding * 2);
      if (itemPadding) rowChildren.push(h(Text, { key: `tab-padding-left-${item.id}` }, " ".repeat(itemPadding)));
      rowChildren.push(h(Text, {
        key: `tab-${item.id}`,
        color: active ? DASHBOARD_THEME.semantic.accents.primary : DASHBOARD_THEME.semantic.accents.muted,
        bold: focused,
      }, clipped(label, textWidth).padEnd(textWidth)));
      if (itemPadding) rowChildren.push(h(Text, { key: `tab-padding-right-${item.id}` }, " ".repeat(itemPadding)));
      onRegion(item, x, line.row, line.row + 1);
      used += item.width;
      x += item.width;
    }
    rowChildren.push(h(Text, {
      key: `tab-fill-${line.row}`,
      color: DASHBOARD_THEME.semantic.accents.muted,
    }, `${" ".repeat(Math.max(0, availableWidth - used))}${" ".repeat(inset)}`));
    rowChildren.push(h(Text, {
      key: `tab-right-${line.row}`,
      color: DASHBOARD_THEME.semantic.accents.muted,
    }, "│"));
  } else {
    const activeIndex = line.items.findIndex((item) =>
      item.target.type === "section" && item.target.section === section);
    const activeWidth = activeIndex < 0 ? 0 : line.items[activeIndex].width;
    let activeStart = inset;
    for (let index = 0; index < activeIndex; index += 1) activeStart += line.items[index].width + gap;
    const leftWidth = activeIndex < 0 ? 0 : activeStart;
    const rightWidth = Math.max(0, interiorWidth - leftWidth - activeWidth);
    rowChildren.push(h(Text, {
      key: `tab-underline-left-${line.row}`,
      color: DASHBOARD_THEME.semantic.accents.muted,
    }, `└${"─".repeat(leftWidth)}`));
    if (activeWidth) rowChildren.push(h(Text, {
      key: `tab-underline-active-${line.row}`,
      color: DASHBOARD_THEME.semantic.accents.primary,
    }, "─".repeat(activeWidth)));
    rowChildren.push(h(Text, {
      key: `tab-underline-right-${line.row}`,
      color: DASHBOARD_THEME.semantic.accents.muted,
    }, `${"─".repeat(rightWidth)}┘`));
  }
  return h(Box, {
    key: `control-${line.kind}-${line.row}`,
    flexDirection: "row",
    height: 1,
    width,
  }, ...rowChildren);
}
