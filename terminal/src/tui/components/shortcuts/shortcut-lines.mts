'use strict';

import { wrapText } from '../../helpers.mjs';

export type ShortcutCategory = 'Actions' | 'Filters' | 'Display' | 'Navigation';

export const sectionNavigationHints = ['I Inventory', 'B Browse resources', 'M Manage catalogs'] as const;

export function categorizedShortcutLines(
  groups: Partial<Record<ShortcutCategory, string[]>>,
  format: 'headings' | 'inline' | 'packed' = 'headings',
): string[] {
  const lines = (['Actions', 'Filters', 'Display', 'Navigation'] as const).flatMap((category) => {
    const shortcuts = groups[category];
    if (!shortcuts?.length) return [];
    const hints = shortcuts.join(' · ');
    return format === 'headings' ? [category, hints] : [`${category}: ${hints}`];
  });
  return format === 'packed' && lines.length ? [lines.join(' · ')] : lines;
}

export function wrappedShortcutLines(lines: string[], width?: number) {
  const contentWidth = Math.max(1, (width || 80) - 4);
  return lines.flatMap((line) => {
    const wrapped = [];
    let current = '';
    for (const shortcut of line.split(' · ')) {
      const next = current ? `${current} · ${shortcut}` : shortcut;
      if (current && next.length > contentWidth) {
        wrapped.push(current);
        current = shortcut;
      } else {
        current = next;
      }
    }
    if (current) wrapped.push(current);
    return wrapped.flatMap((row) => wrapText(row, contentWidth));
  });
}
