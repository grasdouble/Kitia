'use strict';

import { Box, Text } from 'ink';
import React, { type ReactNode } from 'react';

import { DASHBOARD_THEME } from '../colors.js';
import { fitText } from '../helpers.mjs';

export interface JoinedWorkspaceLayout {
  innerWidth: number;
  listWidth: number;
  detailsWidth: number;
  dividerWidth: number;
  contentHeight: number;
  listRows: number;
  detailsRows: number;
  detailsContentRows: number;
  firstResourceRowOffset: number;
}

export function joinedWorkspaceLayout(
  width: number,
  height: number,
  stacked: boolean,
  showDetails: boolean,
  detailsFooterRows = 0,
  listShare = 0.76,
): JoinedWorkspaceLayout {
  const innerWidth = Math.max(1, width - 2);
  const contentHeight = Math.max(1, height - 2);
  const sideBySide = showDetails && !stacked;
  const dividerWidth = sideBySide ? 1 : 0;
  const listWidth = sideBySide ? Math.max(1, Math.floor((innerWidth - dividerWidth) * listShare)) : innerWidth;
  const detailsWidth = sideBySide ? Math.max(1, innerWidth - dividerWidth - listWidth) : 0;
  const stackedDetails = showDetails && stacked;
  const bodyRows = Math.max(0, contentHeight - (stackedDetails ? 6 : 3));
  const detailsRows = sideBySide
    ? Math.max(1, contentHeight - 2)
    : stackedDetails
      ? Math.min(Math.max(0, bodyRows - 1), Math.max(detailsFooterRows + 4, Math.floor(bodyRows * 0.68)))
      : 0;
  const listRows = stackedDetails ? Math.max(1, bodyRows - detailsRows) : Math.max(1, bodyRows);
  return {
    innerWidth,
    listWidth,
    detailsWidth,
    dividerWidth,
    contentHeight,
    listRows,
    detailsRows,
    detailsContentRows: Math.max(0, detailsRows - detailsFooterRows),
    firstResourceRowOffset: 4,
  };
}

const h = React.createElement;

// JoinedWorkspace, side-by-side when details fit:
// ┌──────────────────────────┬────────────────────┐
// │ list title          meta │ details title hint │
// ├──────────────────────────┤────────────────────┤
// │ list header              │ details            │
// │ list rows                │ (optional footer)  │
// └──────────────────────────┴────────────────────┘
// Otherwise, details stack below the list with a horizontal rule.
export function JoinedWorkspace({
  width,
  height,
  layout,
  showDetails,
  listTitle,
  listMeta,
  listHeader,
  listRows,
  detailsTitle,
  details,
  detailsFooter,
  detailsHint,
  color = DASHBOARD_THEME.semantic.accents.detailPanel,
}: {
  width: number;
  height: number;
  layout: JoinedWorkspaceLayout;
  showDetails: boolean;
  listTitle: string;
  listMeta: string;
  listHeader: string;
  listRows: ReactNode[];
  detailsTitle: string;
  details: ReactNode[];
  detailsFooter?: ReactNode;
  detailsHint?: string;
  color?: string;
}) {
  const horizontal = (leftWidth: number, rightWidth = 0) =>
    h(
      Box,
      {
        flexDirection: 'row',
        width: leftWidth + rightWidth + Number(Boolean(rightWidth)),
        height: 1,
      },
      h(Text, { color }, '─'.repeat(leftWidth)),
      ...(rightWidth
        ? [h(Text, { key: 'junction', color }, '┼'), h(Text, { key: 'right-rule', color }, '─'.repeat(rightWidth))]
        : []),
    );
  const fillRows = (items: ReactNode[], count: number, key: string) => [
    ...items.slice(0, count),
    ...Array.from({ length: Math.max(0, count - items.length) }, (_, index) =>
      h(Text, { key: `${key}-empty-${index}` }, ' '),
    ),
  ];
  const sideBySide = showDetails && layout.detailsWidth > 0;
  const titleMetaWidth = Math.min(layout.listWidth, Math.max(12, Math.floor(layout.listWidth * 0.32)));
  const titleWidth = Math.max(1, layout.listWidth - titleMetaWidth - 1);
  const listColumnHeight = sideBySide || !showDetails ? layout.contentHeight : 3 + layout.listRows;
  const listColumn = h(
    Box,
    {
      key: 'workspace-list',
      flexDirection: 'column',
      width: layout.listWidth,
      height: listColumnHeight,
      flexShrink: 0,
    },
    h(
      Box,
      { flexDirection: 'row', height: 1, width: layout.listWidth, justifyContent: 'space-between' },
      h(Text, { color: DASHBOARD_THEME.semantic.accents.primary, bold: true }, fitText(listTitle, titleWidth)),
      h(Text, { color: DASHBOARD_THEME.semantic.accents.muted }, fitText(listMeta, titleMetaWidth)),
    ),
    horizontal(layout.listWidth),
    h(Text, { color: DASHBOARD_THEME.semantic.accents.muted, bold: true }, listHeader),
    ...fillRows(listRows, layout.listRows, 'workspace-row'),
  );
  const divider = sideBySide
    ? h(
        Box,
        {
          key: 'workspace-divider',
          flexDirection: 'column',
          width: 1,
          height: layout.contentHeight,
          flexShrink: 0,
        },
        ...Array.from({ length: layout.contentHeight }, (_, index) =>
          h(
            Text,
            {
              key: `workspace-divider-${index}`,
              color,
            },
            index === 1 ? '┼' : '│',
          ),
        ),
      )
    : null;
  const detailsContent = details.slice(0, layout.detailsContentRows);
  const detailsColumnWidth = sideBySide ? layout.detailsWidth : layout.innerWidth;
  const detailsHeaderWidth = Math.max(1, detailsColumnWidth - 1);
  const hintWidth = detailsHint ? Math.min(detailsHeaderWidth, detailsHint.length) : 0;
  const detailsTitleWidth = Math.max(1, detailsHeaderWidth - hintWidth - Number(Boolean(detailsHint)));
  const detailsHeader = h(
    Box,
    {
      flexDirection: 'row',
      width: detailsHeaderWidth,
      height: 1,
      justifyContent: 'space-between',
    },
    h(Text, { color: DASHBOARD_THEME.semantic.accents.primary, bold: true }, fitText(detailsTitle, detailsTitleWidth)),
    ...(detailsHint
      ? [
          h(
            Text,
            {
              color: DASHBOARD_THEME.semantic.accents.muted,
              bold: true,
            },
            fitText(detailsHint, hintWidth),
          ),
        ]
      : []),
  );
  const detailsSection = showDetails
    ? h(
        Box,
        {
          key: 'workspace-details',
          flexDirection: 'column',
          width: detailsColumnWidth,
          height: sideBySide ? layout.contentHeight : undefined,
          flexShrink: 0,
          paddingLeft: 1,
        },
        detailsHeader,
        horizontal(detailsHeaderWidth),
        ...detailsContent,
        ...(detailsFooter ? [detailsFooter] : []),
      )
    : null;
  const content = sideBySide
    ? h(
        Box,
        {
          flexDirection: 'row',
          width: layout.innerWidth,
          height: layout.contentHeight,
          alignItems: 'stretch',
        },
        listColumn,
        divider,
        detailsSection,
      )
    : h(
        Box,
        {
          flexDirection: 'column',
          width: layout.innerWidth,
          height: layout.contentHeight,
          alignItems: 'stretch',
        },
        listColumn,
        ...(showDetails
          ? [
              h(
                Text,
                {
                  key: 'workspace-detail-divider',
                  color: DASHBOARD_THEME.semantic.accents.detailPanel,
                },
                '─'.repeat(layout.innerWidth),
              ),
              detailsSection,
            ]
          : []),
      );
  return h(
    Box,
    {
      width,
      height,
      borderStyle: 'single',
      borderColor: color,
      flexShrink: 0,
      flexDirection: 'column',
    },
    content,
  );
}
