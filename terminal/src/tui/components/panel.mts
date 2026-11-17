'use strict';

import { Box, Text } from 'ink';
import React, { type ReactNode } from 'react';

import { DASHBOARD_THEME } from '../colors.js';
import { PanelHeader } from './panel-header.mjs';

const h = React.createElement;

export interface PanelProps {
  title: string;
  children?: ReactNode;
  headerContent?: ReactNode;
  color?: string;
  width?: number;
  marginTop?: number;
  marginLeft?: number;
  flexGrow?: number;
  flexShrink?: number;
  separateHeader?: boolean;
  bordered?: boolean;
  backgroundColor?: string;
}

// Panel
// ┌────────────────────┐
// │ title or header     │
// │ children            │
// └────────────────────┘
// separateHeader uses a bottom-rule header with optional headerContent; otherwise only the title is shown.
// With bordered=false, the outline is omitted.
export function Panel({
  title,
  children,
  headerContent,
  color = DASHBOARD_THEME.semantic.accents.primary,
  width,
  marginTop = 0,
  marginLeft = 0,
  flexGrow = 0,
  flexShrink = 0,
  separateHeader = false,
  bordered = true,
  backgroundColor,
}: PanelProps) {
  return h(
    Box,
    {
      flexDirection: 'column',
      flexShrink,
      flexGrow,
      borderStyle: bordered ? 'single' : undefined,
      borderColor: color,
      backgroundColor,
      paddingX: bordered ? 1 : 2,
      marginTop,
      marginLeft,
      width,
    },
    separateHeader ? h(PanelHeader, { title, color }, headerContent) : h(Text, { bold: true, color }, title),
    children,
  );
}
