"use strict";

import React from "react";
import { Text } from "ink";

const h = React.createElement;

function clipped(value: string, width: number) {
  if (width <= 0) return "";
  const chars = Array.from(value);
  return chars.length > width ? `${chars.slice(0, Math.max(0, width - 1)).join("")}…` : value;
}

export interface ActionButtonProps {
  id: string;
  label: string;
  width: number;
  active: boolean;
  color: string;
  activeColor: string;
  selectedForeground: string;
  selectedSurface?: boolean;
}

// ActionButton
// ╭──────╮
// │ label│
// ╰──────╯
// Active label: bold and underlined.
export function ActionButton({
  id, label, width, active, color, activeColor, selectedForeground, selectedSurface = false,
}: ActionButtonProps) {
  const buttonWidth = Math.max(1, width);
  const innerWidth = Math.max(0, buttonWidth - 4);
  const textWidth = Math.max(0, buttonWidth - 2);
  const borderColor = active ? activeColor : color;
  const top = buttonWidth > 1 ? `╭${"─".repeat(Math.max(0, buttonWidth - 2))}╮` : "╭";
  const bottom = buttonWidth > 1 ? `╰${"─".repeat(Math.max(0, buttonWidth - 2))}╯` : "╰";
  const buttonLabel = clipped(label, innerWidth).padEnd(innerWidth);
  const content = buttonWidth >= 4
    ? `│ ${buttonLabel} │`
    : buttonWidth > 1 ? `│${clipped(label, textWidth).padEnd(textWidth)}│` : "│";
  return h(React.Fragment, null,
    h(Text, { key: `${id}-top`, color: borderColor, wrap: "truncate-end" }, clipped(top, buttonWidth)),
    h(Text, {
      key: `${id}-content`,
      color: selectedSurface && !active ? selectedForeground : color,
      bold: active,
      underline: active,
    }, clipped(content, buttonWidth)),
    h(Text, { key: `${id}-bottom`, color: borderColor, wrap: "truncate-end" }, clipped(bottom, buttonWidth)));
}
