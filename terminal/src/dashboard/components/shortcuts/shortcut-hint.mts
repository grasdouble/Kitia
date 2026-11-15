"use strict";

import React from "react";
import { Text } from "ink";
import { DASHBOARD_THEME } from "../../colors.js";
import { fitText } from "../../helpers.mjs";

const h = React.createElement;
const shortcutKey = /^(?:Delete|BACKSPACE|ENTER|ESC|PgUp|PgDn|↑↓|[A-Z0-9])$/u;

// ShortcutHint: category labels render bold; other lines dim with recognized keys emphasized.
export function ShortcutHint({ value, width }: { value: string; width: number }) {
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
