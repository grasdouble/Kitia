'use strict';

import { Text, useInput, useStdin } from 'ink';
import React, { type ReactNode, useState } from 'react';

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
  const { isRawModeSupported } = useStdin();
  const [page, setPage] = useState(() => ({ resetKey, offset: 0 }));
  const maxOffset = viewport > 0 ? Math.max(0, lines.length - viewport) : 0;
  const reset =
    resetKey.length !== page.resetKey.length ||
    resetKey.some((value, index) => !Object.is(value, page.resetKey[index]));
  const visibleOffset = reset ? 0 : Math.min(page.offset, maxOffset);
  // Reset before publishing the frame so a passive effect cannot undo the next input.
  if (reset || visibleOffset !== page.offset) {
    setPage({ resetKey, offset: visibleOffset });
  }
  const canScroll = enabled && !menuFilter && maxOffset > 0;
  const canPage = isRawModeSupported && canScroll && !filterMode && (focus === 'list' || focus === 'actions');
  const move = (delta: number) =>
    setPage((current) => {
      const offset = Math.max(0, Math.min(maxOffset, current.offset + delta));
      return offset === current.offset ? current : { resetKey: current.resetKey, offset };
    });
  // Keep the listener installed across layout and focus changes when stdin supports raw mode.
  useInput(
    (input, key) => {
      if (!canPage) return;
      const step = Math.max(1, viewport - 1);
      if (key.pageUp || input === '\u001b[5~') {
        move(-step);
      } else if (key.pageDown || input === '\u001b[6~') {
        move(step);
      }
    },
    { isActive: isRawModeSupported },
  );
  return {
    visibleLines: lines.slice(visibleOffset, visibleOffset + Math.max(0, viewport)),
    isClipped: maxOffset > 0,
    canPage,
    scroll: canScroll ? move : undefined,
  };
}
