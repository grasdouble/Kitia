'use strict';

import { Text, useInput } from 'ink';
import React, { type ReactNode, useEffect, useState } from 'react';

import { DASHBOARD_THEME } from '../colors.js';
import { fitText, wrapText } from '../helpers.mjs';
import type { DashboardControlFocus, DashboardFilter } from '../input-transport.mjs';

const h = React.createElement;

// SelectionDetails: kind + bold id → wrapped description → optional metadata block.
export function SelectionDetails({
  kind,
  id,
  description,
  width,
  kindColor,
  leadingMetadata = [],
  metadata = [],
}: {
  kind: string;
  id: string;
  description: string;
  width: number;
  kindColor?: string;
  leadingMetadata?: ReactNode[];
  metadata?: ReactNode[];
}): ReactNode[] {
  return [
    h(Text, { key: 'selection-details-kind', color: kindColor }, fitText(kind, width)),
    h(Text, { key: 'selection-details-kind-gap' }, ' '),
    h(Text, { key: 'selection-details-id', bold: true }, fitText(id, width)),
    h(Text, { key: 'selection-details-id-gap' }, ' '),
    ...leadingMetadata,
    ...wrapText(description, width, Infinity).map((line, index) =>
      h(
        Text,
        {
          key: `selection-details-description-${index}`,
          color: DASHBOARD_THEME.semantic.accents.muted,
        },
        fitText(line, width),
      ),
    ),
    ...(metadata.length ? [h(Text, { key: 'selection-details-description-gap' }, ' '), ...metadata] : []),
  ];
}

export function useDashboardDetailPaging({
  lines,
  viewport,
  enabled,
  filterMode,
  focus,
  menuFilter,
  resetKey,
}: {
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
  const canScroll = enabled && !menuFilter && maxOffset > 0;
  const canPage = canScroll && !filterMode && (focus === 'list' || focus === 'actions');
  const move = (delta: number) => setOffset((current) => Math.max(0, Math.min(maxOffset, current + delta)));
  useInput(
    (input, key) => {
      const step = Math.max(1, viewport - 1);
      if (key.pageUp || input === '\u001b[5~') {
        move(-step);
      } else if (key.pageDown || input === '\u001b[6~') {
        move(step);
      }
    },
    { isActive: canPage },
  );
  return {
    visibleLines: lines.slice(visibleOffset, visibleOffset + Math.max(0, viewport)),
    isClipped: maxOffset > 0,
    canPage,
    scroll: canScroll ? move : undefined,
  };
}
