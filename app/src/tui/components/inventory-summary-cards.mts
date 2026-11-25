'use strict';

import { Box, Text } from 'ink';
import React from 'react';

import { summarizeInventory } from '../../core/inventory/view.js';
import type { CatalogResource } from '../../core/resources/model.js';
import { DASHBOARD_THEME } from '../colors.js';
import { fitText } from '../helpers.mjs';
import { Panel } from './panel.mjs';

const h = React.createElement;

// InventorySummaryCards
// Normal: [PROJECT]  [USER]  [UPDATES] (three side-by-side panels)
// stacked: those panels become vertical; compact: title/count only per panel.
// ultraCompact: one row of three title/count labels, no panels.
export function InventorySummaryCards({
  resources,
  width,
  stacked = false,
  compact = false,
  ultraCompact = false,
  marginTop = 1,
}: {
  resources: CatalogResource[];
  width: number;
  stacked?: boolean;
  compact?: boolean;
  ultraCompact?: boolean;
  marginTop?: number;
}) {
  const { project, user, current, updates, warnings } = summarizeInventory(resources);
  type SummaryCard =
    | { type: 'scope'; title: string; count: number; managed: number; color: string }
    | { type: 'updates'; title: string; count: number; note: string; color: string };
  const cards: SummaryCard[] = [
    {
      type: 'scope',
      title: 'PROJECT',
      count: project.total,
      managed: project.managed,
      color: DASHBOARD_THEME.semantic.terminalScope.project,
    },
    {
      type: 'scope',
      title: 'USER',
      count: user.total,
      managed: user.managed,
      color: DASHBOARD_THEME.semantic.terminalScope.user,
    },
    {
      type: 'updates',
      title: 'UPDATES',
      count: updates,
      note: `${current} current · ${warnings} warning(s)`,
      color:
        updates + warnings
          ? DASHBOARD_THEME.semantic.inventoryStatus.attention
          : DASHBOARD_THEME.semantic.inventoryStatus.current,
    },
  ];
  if (ultraCompact) {
    return h(
      Box,
      { flexDirection: 'row', width, marginTop, justifyContent: 'space-between' },
      ...cards.map((card, index) =>
        h(
          Text,
          {
            key: `compact-summary-${card.title}`,
            color: card.color,
            bold: true,
          },
          `${card.title} ${card.count}${index < cards.length - 1 ? ' ·' : ''}`,
        ),
      ),
    );
  }
  const gap = 1;
  const availableCardWidth = width - gap * 2;
  const baseCardWidth = Math.floor(availableCardWidth / 3);
  const cardWidths = cards.map((_, index) =>
    stacked ? width : baseCardWidth + Number(index < availableCardWidth % 3),
  );
  return h(
    Box,
    { flexDirection: stacked ? 'column' : 'row', width, marginTop, alignItems: 'stretch' },
    ...cards.map((card, index) => {
      const note =
        card.type === 'scope' ? `${card.managed} managed · ${card.count - card.managed} unmanaged` : card.note;
      const cardNode = compact
        ? h(
            Box,
            {
              key: card.title,
              width: cardWidths[index],
              height: 3,
              borderStyle: 'single',
              borderColor: card.color,
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            },
            h(Text, { color: DASHBOARD_THEME.semantic.accents.muted }, card.title),
            h(Text, { bold: true, color: card.color }, String(card.count)),
          )
        : h(
            Panel,
            {
              key: card.title,
              title: card.title,
              color: card.color,
              width: cardWidths[index],
              marginTop: stacked && index ? 1 : 0,
              marginLeft: !stacked && index ? gap : 0,
            },
            h(
              Box,
              { flexDirection: 'row', justifyContent: 'space-between' },
              h(Text, { dimColor: true }, fitText(note, Math.max(1, cardWidths[index] - 8))),
              h(Text, { bold: true, color: card.color }, String(card.count)),
            ),
          );
      return compact && !stacked
        ? h(
            Box,
            {
              key: `compact-gap-${card.title}`,
              marginLeft: index ? gap : 0,
            },
            cardNode,
          )
        : cardNode;
    }),
  );
}
