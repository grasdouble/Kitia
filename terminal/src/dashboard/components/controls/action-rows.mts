"use strict";

import React from "react";
import { Box, measureElement, Text } from "ink";
import type { DOMElement } from "ink";
import { DASHBOARD_THEME } from "../../colors.js";
import type { DashboardMouseRegion } from "../../input-transport.mjs";
import type { ControlLine, ControlsProps } from "./control-layout-plan.mjs";
import { dashboardActionButtonLines } from "./control-layout-plan.mjs";
import { ActionButton } from "./action-button.mjs";

const h = React.createElement;

function actionColor(id: string) {
  const { accents } = DASHBOARD_THEME.semantic;
  if (id === "remove" || id === "remove-catalog") return accents.danger;
  if (id === "install" || id === "update" || id === "add-catalog" || id === "refresh-catalog") return accents.primary;
  return accents.neutral;
}

// ControlActionRow: one horizontal row of three-line ActionButtons.
export function ControlActionRow({
  line, controls, width, selectedSurface = false, rowRef, toolbar = false,
}: {
  line: ControlLine;
  controls: ControlsProps;
  width: number;
  selectedSurface?: boolean;
  rowRef?: React.Ref<DOMElement>;
  toolbar?: boolean;
}) {
  const buttons: React.ReactNode[] = [];
  for (const [index, item] of line.items.entries()) {
    if (toolbar && index) buttons.push(h(Text, { key: `toolbar-action-gap-${line.row}-${index}` }, " "));
    const active = controls.focus === "actions" && controls.actions?.[controls.actionIndex || 0]?.id === item.id;
    buttons.push(h(Box, {
      key: toolbar ? `toolbar-action-${line.row}-${item.id}` : `action-button-${item.id}`,
      flexDirection: "column",
      width: item.width,
      height: 3,
      marginRight: index < line.items.length - 1 ? 1 : 0,
    }, h(ActionButton, {
      id: item.id,
      label: item.label,
      width: item.width,
      active,
      color: actionColor(item.id),
      activeColor: DASHBOARD_THEME.semantic.selected,
      selectedForeground: DASHBOARD_THEME.semantic.selectedForeground,
      selectedSurface,
    })));
  }
  return h(Box, {
    key: toolbar ? `toolbar-actions-${line.row}` : `action-row-${line.row}`,
    ref: rowRef,
    flexDirection: "row",
    height: 3,
    width,
  }, ...buttons);
}
// ActionButtons: optional ACTIONS heading → wrapped rows of action buttons.

export function ActionButtons({ controls, width }: {
  controls: ControlsProps;
  width: number;
}) {
  return h(ActionButtonsLayout, { key: "dashboard-action-buttons", controls, width });
}

function ActionButtonsLayout({ controls, width }: {
  controls: ControlsProps;
  width: number;
}) {
  const lines = dashboardActionButtonLines(controls, width);
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
  if (lines.length && !controls.hideActionHeading) output.push(h(Text, {
    key: "action-heading",
    color: controls.selectedSurface
      ? DASHBOARD_THEME.semantic.selectedForeground : DASHBOARD_THEME.semantic.accents.shortcutCategory,
    bold: true,
  }, "ACTIONS"));
  lines.forEach((line, lineIndex) => output.push(h(ControlActionRow, {
    key: `action-row-${line.row}`,
    line,
    controls,
    width,
    selectedSurface: Boolean(controls.selectedSurface),
    rowRef: rowRefs.current[lineIndex],
  })));
  return output.length ? h(Box, { flexDirection: "column" }, ...output) : null;
}
