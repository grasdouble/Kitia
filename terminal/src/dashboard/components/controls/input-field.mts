"use strict";

import React from "react";
import { Text } from "ink";

const h = React.createElement;

function clipped(value: string, width: number) {
  if (width <= 0) return "";
  const chars = Array.from(value);
  return chars.length > width ? `${chars.slice(0, Math.max(0, width - 1)).join("")}…` : value;
}

function fieldBorder(width: number, side: "top" | "middle" | "bottom", value = "", color: string, labelColor: string) {
  const fieldWidth = Math.max(1, width);
  if (fieldWidth === 1) return side === "middle" ? clipped(value, 1) : side === "top" ? "╭" : "╰";
  const inner = fieldWidth - 2;
  if (side === "top") return `╭${"─".repeat(Math.max(0, inner))}╮`;
  if (side === "bottom") return `╰${"─".repeat(Math.max(0, inner))}╯`;
  if (fieldWidth < 4) return `│${clipped(value, Math.max(0, fieldWidth - 2)).padEnd(Math.max(0, fieldWidth - 2))}│`;
  return h(React.Fragment, null,
    h(Text, { color }, "│"),
    h(Text, { color: labelColor }, ` ${clipped(value, Math.max(0, inner - 2)).padEnd(Math.max(0, inner - 2))} `),
    h(Text, { color }, "│"));
}

// renderInputField, used by TextInput and SelectInput:
// non-compact fields are top rule → value row → bottom rule; compact shows value row only.
export function renderInputField({ value, width, side, compact, color, labelColor }: {
  value: string;
  width: number;
  side?: "top" | "middle" | "bottom";
  compact: boolean;
  color: string;
  labelColor: string;
}) {
  const fieldWidth = Math.max(1, width);
  const visibleSide = compact ? "middle" : side || "middle";
  if (visibleSide === "middle") return fieldBorder(fieldWidth, "middle", value, color, labelColor);
  return h(Text, { color }, fieldBorder(fieldWidth, visibleSide, "", color, labelColor));
}
