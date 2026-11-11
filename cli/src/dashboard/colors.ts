"use strict";

export const DASHBOARD_THEME = {
  semantic: {
    kind: {
      skill: "yellow",
      agent: "cyan",
      instruction: "green",
    },
    selected: "blue",
    inventoryStatus: {
      unmanaged: "gray",
      attention: "yellow",
      update: "blue",
      current: "green",
    },
    catalogFreshness: {
      checking: "cyan",
      current: "green",
      outdated: "yellow",
      unknown: "gray",
    },
    catalogStatus: {
      experimental: "yellow",
      stable: "green",
      deprecated: "red",
      unknown: "gray",
    },
    catalogRepository: {
      connected: "cyan",
      missing: "gray",
    },
    terminalKind: "magenta",
    terminalScope: {
      user: "cyan",
      project: "blue",
    },
    accents: {
      primary: "cyan",
      detailPanel: "blue",
      muted: "gray",
      label: "white",
      warning: "yellow",
      success: "green",
      error: "redBright",
      danger: "redBright",
    },
    syntax: {
      comment: "#9ca3af",
      keyword: "#c084fc",
      string: "#86efac",
      number: "#fbbf24",
      function: "#67e8f9",
      type: "#fde68a",
      property: "#a5b4fc",
      operator: "#f0abfc",
      punctuation: "#9ca3af",
      heading: "#60a5fa",
      emphasis: "#fcd34d",
      link: "#22d3ee",
      code: "#6ee7b7",
    },
    modal: {
      background: "#111827",
      foreground: "#f9fafb",
    },
  },
  terminalAnsi: {
    bold: "1",
    gray: "90",
    red: "31",
    green: "32",
    yellow: "33",
    blue: "34",
    magenta: "35",
    cyan: "36",
    whiteOnBlue: "97;44",
    whiteOnGray: "97;100",
  },
  titleGradientStops: [[34, 211, 238], [167, 139, 250], [244, 114, 182]],
} as const;

const { semantic } = DASHBOARD_THEME;

export function colorForKind(kind: string): string | undefined {
  const color = semantic.kind[kind as keyof typeof semantic.kind];
  return typeof color === "string" ? color : undefined;
}

export function resolveRowColor(
  kind: string,
  selected: boolean,
  fallback?: string,
): string | undefined {
  return selected ? semantic.selected : colorForKind(kind) ?? fallback;
}

