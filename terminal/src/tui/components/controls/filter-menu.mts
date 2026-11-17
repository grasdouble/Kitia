'use strict';

import { Box, Text } from 'ink';
import React from 'react';

import { DASHBOARD_THEME } from '../../colors.js';
import type { DashboardFilter } from '../../input-transport.mjs';
import type { ControlMenu, LayoutItem } from './control-layout-plan.mjs';
import { clipped } from './control-rendering.mjs';

const h = React.createElement;

// FilterMenu
// ╭────────────╮
// │› active    │
// │✓ selected  │
// ╰────────────╯
// Active and selected markers appear only on matching options.
export function FilterMenu({
  menu,
  filter,
  options,
  menuIndex,
  onRegion,
}: {
  menu: ControlMenu;
  filter: DashboardFilter;
  options: string[];
  menuIndex: number;
  onRegion: (item: LayoutItem, x: number, top: number, bottom: number) => void;
}) {
  const { left, top, width, first, count, selectedValue, allLabel } = menu;
  const backgroundColor = DASHBOARD_THEME.semantic.modal.background;
  const foregroundColor = DASHBOARD_THEME.semantic.modal.foreground;
  const borderColor = DASHBOARD_THEME.semantic.accents.primary;
  const borderLine = (start: string, end: string) =>
    width > 1 ? `${start}${'─'.repeat(Math.max(0, width - 2))}${end}` : start;
  const borderItem: LayoutItem = {
    id: 'filter-popover-border',
    label: '',
    text: '',
    width,
    target: { type: 'filter-dismiss', filter },
  };
  onRegion(borderItem, left + 1, top, top);
  onRegion(borderItem, left + 1, top + count + 1, top + count + 1);
  return h(
    Box,
    {
      key: 'filter-popover',
      position: 'absolute',
      top,
      left,
      width,
      height: count + 2,
      flexDirection: 'column',
      flexShrink: 0,
    },
    h(Text, { key: 'filter-popover-top', color: borderColor, backgroundColor }, clipped(borderLine('╭', '╮'), width)),
    ...options.slice(first, first + count).map((value, visibleIndex) => {
      const optionIndex = first + visibleIndex;
      const active = optionIndex === menuIndex;
      const checked = value === selectedValue;
      const optionLabel = value === 'all' ? allLabel : value;
      const innerWidth = Math.max(0, width - 2);
      const marker = ` ${active ? '›' : ' '} ${checked ? '✓' : ' '} `;
      const labelWidth = Math.max(0, innerWidth - Array.from(marker).length);
      const content = `${clipped(marker, innerWidth)}${clipped(optionLabel, labelWidth).padEnd(labelWidth)}`;
      const row = `│${content.padEnd(innerWidth)}│`;
      const color = active
        ? DASHBOARD_THEME.semantic.selectedForeground
        : checked
          ? DASHBOARD_THEME.semantic.accents.success
          : foregroundColor;
      const rowBackground = active ? DASHBOARD_THEME.semantic.selected : backgroundColor;
      const item: LayoutItem = {
        id: `filter-option-${optionIndex}`,
        label: optionLabel,
        text: optionLabel,
        width,
        target: { type: 'filter-option', filter, value },
      };
      onRegion(item, left + 2, top + visibleIndex + 1, top + visibleIndex + 1);
      return h(
        Text,
        {
          key: item.id,
          color,
          backgroundColor: rowBackground,
          bold: active || checked,
        },
        clipped(row, width),
      );
    }),
    h(
      Text,
      { key: 'filter-popover-bottom', color: borderColor, backgroundColor },
      clipped(borderLine('╰', '╯'), width),
    ),
  );
}
