"use strict";

import React, { type ReactNode, useEffect, useState } from "react";
import { Text, useInput } from "ink";
import { DASHBOARD_THEME } from "../colors.js";
import type { DashboardControlFocus, DashboardFilter } from "../input-transport.mjs";
import { fitText, wrapText } from "../helpers.mjs";

const h = React.createElement;

// SelectionDetails: kind + bold id → wrapped description → optional metadata block.
export function SelectionDetails({ kind, id, description, width, kindColor, metadata = [] }: {
  kind: string;
  id: string;
  description: string;
  width: number;
  kindColor?: string;
  metadata?: ReactNode[];
}): ReactNode[] {
  return [
    h(Text, { key: "selection-details-kind", color: kindColor }, fitText(kind, width)),
    h(Text, { key: "selection-details-kind-gap" }, " "),
    h(Text, { key: "selection-details-id", bold: true }, fitText(id, width)),
    h(Text, { key: "selection-details-id-gap" }, " "),
    ...wrapText(description, width, Infinity).map((line, index) => h(Text, {
      key: `selection-details-description-${index}`,
      color: DASHBOARD_THEME.semantic.accents.muted,
    }, fitText(line, width))),
    ...(metadata.length ? [
      h(Text, { key: "selection-details-description-gap" }, " "),
      ...metadata,
    ] : []),
  ];
}

export function useDashboardDetailPaging({ lines, viewport, enabled, filterMode, focus, menuFilter, resetKey }: {
  lines: ReactNode[];
  viewport: number;
  enabled: boolean;
  filterMode: boolean;
  focus: DashboardControlFocus;
  menuFilter?: DashboardFilter | null;
  resetKey: readonly unknown[];
}) {
  const [offset, setOffset] = useState(0);
  const maxOffset = viewport > 0 ? Math.max(0, lines.length - viewport) : 0;
  const visibleOffset = Math.min(offset, maxOffset);
  useEffect(() => setOffset(0), resetKey);
  useEffect(() => {
    if (offset !== visibleOffset) setOffset(visibleOffset);
  }, [offset, visibleOffset]);
  const canPage = enabled && !filterMode && !menuFilter && (focus === "list" || focus === "actions") && maxOffset > 0;
  useInput((input, key) => {
    const step = Math.max(1, viewport - 1);
    if (key.pageUp || input === "\u001b[5~") {
      setOffset((current) => Math.max(0, Math.min(current, maxOffset) - step));
    } else if (key.pageDown || input === "\u001b[6~") {
      setOffset((current) => Math.min(maxOffset, Math.min(current, maxOffset) + step));
    }
  }, { isActive: canPage });
  return {
    visibleLines: lines.slice(visibleOffset, visibleOffset + Math.max(0, viewport)),
    isClipped: maxOffset > 0,
    canPage,
  };
}
