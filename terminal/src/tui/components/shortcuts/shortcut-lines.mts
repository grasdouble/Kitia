"use strict";

import { wrapText } from "../../helpers.mjs";

export type ShortcutCategory = "Actions" | "Filters" | "Display" | "Navigation";

export function categorizedShortcutLines(
  groups: Partial<Record<ShortcutCategory, string[]>>,
): string[] {
  return (["Actions", "Filters", "Display", "Navigation"] as const).flatMap((category) => {
    const shortcuts = groups[category] || [];
    return shortcuts.length ? [category, shortcuts.join(" · ")] : [];
  });
}

export function wrappedShortcutLines(lines: string[], width?: number) {
  const contentWidth = Math.max(1, (width || 80) - 4);
  return lines.flatMap((line) => {
    const wrapped = [];
    let current = "";
    for (const shortcut of line.split(" · ")) {
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

export function shortcutFooterLines(lines: string[], width: number): string[] {
  const headings = new Set(["Actions", "Filters", "Display", "Navigation"]);
  const shortcuts = lines.filter((line) => !headings.has(line)).flatMap((line) => line.split(" · "));
  const lineWidth = Math.max(1, width);
  const rows: string[] = [];
  let current = "";
  for (const shortcut of shortcuts) {
    const next = current ? `${current} · ${shortcut}` : shortcut;
    if (current && next.length > lineWidth) {
      rows.push(current);
      current = shortcut;
    } else {
      current = next;
    }
  }
  if (current) rows.push(current);
  return rows.flatMap((line) => line.length > lineWidth ? wrapText(line, lineWidth) : [line]);
}
