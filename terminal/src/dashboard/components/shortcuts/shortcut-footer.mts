"use strict";

import React from "react";
import { Box, Text } from "ink";
import { DASHBOARD_THEME } from "../../colors.js";
import { shortcutFooterLines } from "./shortcut-lines.mjs";
import { ShortcutHint } from "./shortcut-hint.mjs";

const h = React.createElement;

// ShortcutFooter: when rows exist, absolute-bottom separator → one ShortcutHint per row.
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
      h(ShortcutHint, { value: line, width }))))
    : null;
}
