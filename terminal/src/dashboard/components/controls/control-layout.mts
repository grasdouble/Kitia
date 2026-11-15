"use strict";

import React from "react";
import { Box, Text } from "ink";
import { DASHBOARD_THEME } from "../../colors.js";
import type { ControlsProps, ControlsLayout, LayoutItem } from "./control-layout-plan.mjs";
import { clipped } from "./control-rendering.mjs";
import { SectionTabs } from "./section-tabs.mjs";
import { TextInput } from "./text-input.mjs";
import { SelectInput } from "./select-input.mjs";
import { ControlActionRow } from "./action-rows.mjs";
import { FilterMenu } from "./filter-menu.mjs";

const h = React.createElement;
type AddControlRegion = (item: LayoutItem, x: number, top: number, bottom: number) => void;

// ControlLayout: planned tabs/labels/fields/actions in order; an overlay-only
// filter menu is appended when active. menuOverlayOnly hides the underlying controls.
export function ControlLayout({ controls, layout, onRegion }: {
  controls: ControlsProps;
  layout: ControlsLayout;
  onRegion: AddControlRegion;
}): React.ReactNode[] {
  const children: React.ReactNode[] = [];
  if (!controls.menuOverlayOnly) {
    for (const line of layout.lines) {
      if (line.kind === "tab-top" || line.kind === "tabs" || line.kind === "tab-underline") {
        children.push(SectionTabs({
          line,
          width: layout.width,
          section: controls.section,
          focus: controls.focus,
          onRegion,
        }));
        continue;
      }
      if (line.kind === "labels") {
        const rowChildren: React.ReactNode[] = [];
        for (const [index, item] of line.items.entries()) {
          if (index) rowChildren.push(h(Text, { key: `label-gap-${line.row}-${index}` }, " "));
          const label = `${controls.focus === item.id ? "› " : ""}${item.label}`;
          rowChildren.push(h(Text, {
            key: `label-${line.row}-${item.id}`,
            color: controls.focus === item.id ? DASHBOARD_THEME.semantic.accents.primary : DASHBOARD_THEME.semantic.accents.label,
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
        const compactFields = Boolean(controls.rows && controls.rows < 40);
        const fieldRows: React.ReactNode[][] = Array.from({ length: compactFields ? 1 : 3 }, () => []);
        let x = 2;
        for (const [index, item] of line.items.entries()) {
          if (index) {
            for (const childrenForRow of fieldRows) childrenForRow.push(h(Text, { key: `field-gap-${line.row}-${index}` }, " "));
            x += 1;
          }
          const focused = controls.focus === item.id;
          const searchField = item.id === "search";
          const query = controls.query || (controls.searchActive ? "" : "Search resources…");
          const innerWidth = Math.max(0, item.width - 4);
          const inputValue = searchField
            ? Array.from(query).length > innerWidth
              ? `…${Array.from(query).slice(-(Math.max(0, innerWidth - 1))).join("")}`
              : query
            : `${clipped(item.text, Math.max(0, innerWidth - 1))}▾`;
          const value = searchField && controls.searchActive ? `${inputValue}▏` : inputValue;
          const Input = searchField ? TextInput : SelectInput;
          const inputProps = {
            value,
            width: item.width,
            focused,
            compact: compactFields,
            focusedColor: DASHBOARD_THEME.semantic.accents.primary,
            unfocusedColor: DASHBOARD_THEME.semantic.accents.muted,
            labelColor: DASHBOARD_THEME.semantic.accents.label,
          };
          if (compactFields) {
            fieldRows[0].push(h(Input, {
              key: `field-${line.row}-${item.id}`,
              ...inputProps,
              side: "middle",
            }));
          } else {
            fieldRows[0].push(h(Input, { key: `field-top-${line.row}-${item.id}`, ...inputProps, side: "top" }));
            fieldRows[1].push(h(Input, { key: `field-middle-${line.row}-${item.id}`, ...inputProps, side: "middle" }));
            fieldRows[2].push(h(Input, { key: `field-bottom-${line.row}-${item.id}`, ...inputProps, side: "bottom" }));
          }
          onRegion(item, x, line.row - 1, line.row + (compactFields ? 0 : 2));
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
        let x = 2;
        for (const [index, item] of line.items.entries()) {
          if (index) x += 1;
          onRegion(item, x, line.row, line.row + 2);
          x += item.width;
        }
        children.push(ControlActionRow({ line, controls, width: layout.width, toolbar: true }));
      }
    }
  }
  if (layout.menu && controls.menuFilter && controls.menuOverlayOnly) {
    children.push(FilterMenu({
      menu: layout.menu,
      filter: controls.menuFilter,
      options: controls.menuOptions || [],
      menuIndex: controls.menuIndex || 0,
      onRegion,
    }));
  }
  return children;
}
