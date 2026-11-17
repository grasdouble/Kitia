'use strict';

import { Text } from 'ink';
import React from 'react';

import { DASHBOARD_THEME } from '../colors.js';
import { fitText, wrapText } from '../helpers.mjs';

const h = React.createElement;
const OSC8_OPEN = '\u001b]8;;';
const OSC8_CLOSE = '\u001b]8;;\u001b\\';

export function detailValue(
  key: string,
  value: unknown,
  width: number,
  maxLines = 1,
  color: string = DASHBOARD_THEME.semantic.accents.muted,
) {
  return wrapText(value, width, maxLines).map((line, index) =>
    h(Text, { key: `${key}-value-${index}`, color }, fitText(line, width)),
  );
}
export function detailLocations(key: string, locations: { text: string; href?: string }[], width: number) {
  if (!locations.length) return detailValue(key, '-', width, Infinity);
  const lines = [];
  for (const [locationIndex, location] of locations.entries()) {
    if (location.href) {
      for (const [lineIndex, line] of wrapText(location.text, width).entries()) {
        lines.push(
          h(
            Text,
            {
              key: `${key}-${locationIndex}-${lineIndex}`,
              color: DASHBOARD_THEME.semantic.accents.muted,
            },
            `${OSC8_OPEN}${location.href}\u001b\\${line}${OSC8_CLOSE}`,
          ),
        );
      }
    } else {
      lines.push(...detailValue(`${key}-${locationIndex}`, location.text, width, Infinity));
    }
  }
  return lines;
}

export function detailField(
  key: string,
  label: string,
  value: unknown,
  width: number,
  maxLines = 1,
  color: string = DASHBOARD_THEME.semantic.accents.muted,
) {
  return [
    h(Text, { key: `${key}-label`, color: DASHBOARD_THEME.semantic.accents.label, bold: true }, fitText(label, width)),
    ...detailValue(key, value, width, maxLines, color),
  ];
}
