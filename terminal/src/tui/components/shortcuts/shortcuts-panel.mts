'use strict';

import React from 'react';
import type { ReactNode } from 'react';

import { Panel } from '../panel.mjs';
import { ShortcutHint } from './shortcut-hint.mjs';
import { wrappedShortcutLines } from './shortcut-lines.mjs';

const h = React.createElement;

// ShortcutsPanel: bordered SHORTCUTS panel → wrapped shortcut lines (each a ShortcutHint).
export function ShortcutsPanel({
  lines,
  width,
  marginTop = 0,
  color,
  backgroundColor,
}: {
  lines: string[];
  width?: number;
  marginTop?: number;
  color?: string;
  backgroundColor?: string;
}): ReactNode {
  return h(
    Panel,
    { title: 'SHORTCUTS', width, marginTop, color, backgroundColor, separateHeader: true },
    ...wrappedShortcutLines(lines, width).map((line, index) =>
      h(ShortcutHint, {
        key: `shortcut-${index}`,
        value: line,
        width: Math.max(1, (width || 80) - 4),
      }),
    ),
  );
}
