"use strict";

import React, { type ReactNode, useEffect, useState } from "react";
import { Box, Text } from "ink";
import { DASHBOARD_THEME } from "../colors.js";
import { fitColumn, fitText, wrapText } from "../helpers.mjs";

const h = React.createElement;
const OSC8_OPEN = "\u001b]8;;";
const OSC8_CLOSE = "\u001b]8;;\u001b\\";

const kitiaWordmark = [
  "█  ▄▀  ▀█▀  ▀▀█▀▀  ▀█▀  ▄▀▀▀▄",
  "█▀▀▄    █     █     █   █▀▀▀█",
  "▀   ▀  ▀▀▀    ▀    ▀▀▀  ▀   ▀",
];

const titleColorStops = DASHBOARD_THEME.titleGradientStops;
const titleColors = Array.from({ length: 96 }, (_, index) => {
  const segment = Math.floor(index / 32);
  const start = titleColorStops[segment];
  const end = titleColorStops[(segment + 1) % titleColorStops.length];
  return `#${start.map((channel, component) =>
    Math.round(channel + (end[component] - channel) * (index % 32) / 32)
      .toString(16).padStart(2, "0")).join("")}`;
});

function AnimatedTitle({ width, versionLabel, screenName, metadata, phase }: {
  width: number;
  phase: number;
  versionLabel: string;
  screenName: string;
  metadata: string;
}) {
  const pixelTitle = width >= kitiaWordmark[0].length;
  return h(Box, { width, flexDirection: "column" },
    ...(pixelTitle
      ? kitiaWordmark.map((line, row) => h(Text, { key: row },
        ...Array.from(line, (character, column) => h(Text, {
          key: column,
          color: titleColors[(phase + column * 2 + row * 3) % titleColors.length],
        }, character))))
      : [h(Text, { key: "compact", color: DASHBOARD_THEME.semantic.accents.primary, bold: true }, fitText(`KITIA  ${versionLabel}`, width))]),
    h(Text, { color: DASHBOARD_THEME.semantic.accents.primary, bold: pixelTitle }, fitText(
      pixelTitle ? `${versionLabel} · ${screenName}` : screenName, width,
    )),
    h(Text, { dimColor: true }, fitText(metadata, width)),
    ...(!pixelTitle ? [h(Text, { key: "blank-1" }, " "), h(Text, { key: "blank-2" }, " ")] : []));
}

export const DASHBOARD_HEADER_ROWS = 5;
function AnimatedBrand({ art, catWidth, textWidth, versionLabel, screenName, metadata }: {
  art: string[];
  catWidth: number;
  textWidth: number;
  versionLabel: string;
  screenName: string;
  metadata: string;
}) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setPhase((value) => (value + 1) % titleColors.length), 60);
    return () => clearInterval(timer);
  }, []);
  return h(Box, { flexDirection: "row", height: DASHBOARD_HEADER_ROWS, flexShrink: 0 },
    h(Box, { width: catWidth, marginRight: 2, flexDirection: "column" },
      ...art.map((line, row) => h(Text, { key: row, bold: true, wrap: "truncate-end" },
        ...Array.from(line.slice(0, catWidth), (character, column) => h(Text, {
          key: column,
          color: titleColors[(phase + column * 2 + row * 3) % titleColors.length],
        }, character))))),
    h(AnimatedTitle, { width: textWidth, versionLabel, screenName, metadata, phase }));
}

const shortcutKey = /^(?:Delete|BACKSPACE|ENTER|ESC|↑↓|[A-Z])$/;

function shortcutHint(value: string, width: number) {
  const visible = fitText(value, width);
  const parts = visible.split(/(Delete|BACKSPACE|ENTER|ESC|↑↓|[A-Z])/g);
  return h(Text, { dimColor: true }, ...parts.map((part, index) =>
    shortcutKey.test(part)
      ? h(Text, { key: `shortcut-${index}`, bold: true, color: DASHBOARD_THEME.semantic.accents.primary }, part)
      : part));
}

export function PanelHeader({
  title, color = DASHBOARD_THEME.semantic.accents.primary, children,
}: { title: string; color?: string; children?: ReactNode }) {
  return h(Box, {
    flexDirection: "column", flexShrink: 0,
    borderStyle: "single", borderTop: false, borderLeft: false, borderRight: false,
    borderColor: color,
  },
  h(Text, { bold: true, color }, title),
  children);
}

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
}: {
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
}) {
  return h(Box, {
    flexDirection: "column",
    flexShrink,
    flexGrow,
    borderStyle: bordered ? "single" : undefined,
    borderColor: color,
    backgroundColor,
    paddingX: bordered ? 1 : 2,
    marginTop,
    marginLeft,
    width,
  }, separateHeader
    ? h(PanelHeader, { title, color }, headerContent)
    : h(Text, { bold: true, color }, title), children);
}

export function DetailsPanel({
  title,
  children,
  width,
  marginTop = 1,
  marginLeft = 0,
  flexGrow = 0,
  flexShrink = 0,
}: {
  title: string;
  children?: ReactNode;
  width?: number;
  marginTop?: number;
  marginLeft?: number;
  flexGrow?: number;
  flexShrink?: number;
}) {
  return h(Panel, {
    title, children, color: DASHBOARD_THEME.semantic.accents.detailPanel, width, marginTop, marginLeft, flexGrow, flexShrink,
    separateHeader: true,
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

export function ShortcutsPanel({ lines, width, marginTop = 0, color, backgroundColor }: {
  lines: string[];
  width?: number;
  marginTop?: number;
  color?: string;
  backgroundColor?: string;
}) {
  return h(Panel, { title: "SHORTCUTS", width, marginTop, color, backgroundColor, separateHeader: true },
    ...wrappedShortcutLines(lines, width).map((line) => shortcutHint(line, Math.max(1, (width || 80) - 4))));
}

export function detailValue(
  key: string,
  value: unknown,
  width: number,
  maxLines = 1,
  color: string = DASHBOARD_THEME.semantic.accents.muted,
 ) {
  return wrapText(value, width, maxLines).map((line, index) =>
    h(Text, { key: `${key}-value-${index}`, color }, fitText(line, width)));
}
export function detailLocations(key: string, locations: { text: string; href?: string }[], width: number) {
  if (!locations.length) return detailValue(key, "-", width, Infinity);
  const lines = [];
  for (const [locationIndex, location] of locations.entries()) {
    if (location.href) {
      for (const [lineIndex, line] of wrapText(location.text, width).entries()) {
        lines.push(h(Text, { key: `${key}-${locationIndex}-${lineIndex}`, color: DASHBOARD_THEME.semantic.accents.muted },
          `${OSC8_OPEN}${location.href}\u001b\\${line}${OSC8_CLOSE}`));
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

export function ScreenFrame({ columns, rows, children }: {
  columns: number;
  rows: number;
  children?: ReactNode;
}) {
  return h(Box, {
    width: columns,
    height: rows,
    flexDirection: "column",
    alignItems: "stretch",
    position: "relative",
  }, children);
}

export function DashboardHeader({ versionLabel, screenName, metadata, columns }: {
  versionLabel: string;
  screenName: string;
  metadata: string;
  columns: number;
}) {
  const [grooming, setGrooming] = useState<{ activity: "idle" | "lick" | "scratch" | "wink"; frame: number }>({
    activity: "idle", frame: 0,
  });
  const availableWidth = Math.max(1, columns - 2);
  const catWidth = Math.min(18, Math.max(1, availableWidth - 3));
  const textWidth = Math.max(1, availableWidth - catWidth - 2);
  useEffect(() => {
    let activityTimer: ReturnType<typeof setTimeout>;
    let frameTimer: ReturnType<typeof setInterval> | undefined;
    const scheduleAnimation = () => {
      activityTimer = setTimeout(() => {
        const activities = ["lick", "scratch", "wink"] as const;
        const activity = activities[Math.floor(Math.random() * activities.length)];
        setGrooming({ activity, frame: 0 });
        if (activity !== "wink") {
          frameTimer = setInterval(() => {
            setGrooming((current) => ({ activity, frame: (current.frame + 1) % 2 }));
          }, 300);
        }
        activityTimer = setTimeout(() => {
          clearInterval(frameTimer);
          setGrooming({ activity: "idle", frame: 0 });
          scheduleAnimation();
        }, activity === "wink" ? 180 : 2000 + Math.random() * 2000);
      }, 10000 + Math.random() * 10000);
    };
    scheduleAnimation();
    return () => {
      clearTimeout(activityTimer);
      clearInterval(frameTimer);
    };
  }, []);
  const sittingFrame = [
    "       /\\_/\\",
    grooming.activity === "wink" ? "      (=o.-=)" : "      (=o.o=)",
    "      /:>^<:\\    )",
    "     / .| |. \\  /",
    "     \\__|_|__/_/",
  ];
  const lickingFrames = [
    ["       /\\_/\\", "      (=-.-=)", "      /: v( )   )", "     / .| . \\  /", "     \\__|_|__/_/"],
    ["       /\\_/\\", "      (=-.-=)", "      /: -( )   )", "     / .| . \\  /", "     \\__|_|__/_/"],
  ];
  const scratchingFrames = [
    ["       /\\_/\\", "      (=o.-=)()", "      /:>^< /   )", "     / .| ./ \\ /", "     \\__|_|__/_/"],
    ["       /\\_/\\ ()", "      (=o.-=) /", "      /:>^< /   )", "     / .| ./ \\ /", "     \\__|_|__/_/"],
  ];
  const art = grooming.activity === "lick" ? lickingFrames[grooming.frame]
    : grooming.activity === "scratch" ? scratchingFrames[grooming.frame] : sittingFrame;
  return h(AnimatedBrand, { art, catWidth, textWidth, versionLabel, screenName, metadata });
}

