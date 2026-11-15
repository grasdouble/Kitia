"use strict";

import React from "react";
import { Box, Text } from "ink";
import type { DOMElement } from "ink";
import { DASHBOARD_THEME } from "../../colors.js";
import type { ControlLine, ControlsProps } from "./control-layout-plan.mjs";
import { ActionButton } from "./action-button.mjs";

const h = React.createElement;

function actionColor(id: string) {
  const { accents } = DASHBOARD_THEME.semantic;
  if (id === "remove" || id === "remove-catalog") return accents.danger;
  if (id === "install" || id === "update" || id === "add-catalog" || id === "refresh-catalog") return accents.primary;
  return accents.neutral;
}

// ActionButtonRow: one horizontal row of three-line ActionButtons.
export function ActionButtonRow({
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
