"use strict";

import React, { type ReactNode } from "react";
import { Box, Text } from "ink";
import { DASHBOARD_THEME } from "../colors.js";

const h = React.createElement;

// PanelHeader: title, then optional children, inside a bottom-rule-only header.
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
