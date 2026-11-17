'use strict';

import { Text } from 'ink';
import React, { type ReactNode } from 'react';

import { DASHBOARD_THEME } from '../../colors.js';

const h = React.createElement;

export interface ResourceTableWindow<T> {
  first: number;
  items: T[];
}

export function resourceTableWindow<T>(items: T[], selectedIndex: number, viewport: number): ResourceTableWindow<T> {
  const first = Math.max(0, Math.min(selectedIndex - viewport + 1, items.length - viewport));
  return { first, items: items.slice(first, first + viewport) };
}

// ResourceTableRow: one text row; selected rows use the selected foreground/surface.
export function ResourceTableRow({
  row,
  selected,
}: {
  row: { key: string; color: string; text: string };
  selected: boolean;
}) {
  return h(
    Text,
    {
      color: selected ? DASHBOARD_THEME.semantic.selectedForeground : row.color,
      backgroundColor: selected ? DASHBOARD_THEME.semantic.selected : undefined,
      bold: selected,
    },
    row.text,
  );
}

export function resourceTableRows<T>({
  window,
  selectedIndex,
  emptyMessage,
  renderRow,
}: {
  window: ResourceTableWindow<T>;
  selectedIndex: number;
  emptyMessage: string;
  renderRow: (
    item: T,
    selected: boolean,
    absoluteIndex: number,
  ) => {
    key: string;
    color: string;
    text: string;
  };
}): ReactNode[] {
  if (!window.items.length) return [h(Text, { key: 'resource-table-empty', dimColor: true }, emptyMessage)];
  return window.items.map((item, index) => {
    const absoluteIndex = window.first + index;
    const selected = absoluteIndex === selectedIndex;
    const row = renderRow(item, selected, absoluteIndex);
    return h(ResourceTableRow, { key: row.key, row, selected });
  });
}
