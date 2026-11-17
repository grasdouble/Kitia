"use strict";

import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { DASHBOARD_THEME } from "../colors.js";
import { fitText } from "../helpers.mjs";

export const DASHBOARD_HEADER_ROWS = 5;
export type DashboardCatActivity = "idle" | "lick" | "scratch" | "wink";
const sittingCatFrame = [
  "       /\\_/\\",
  "      (=o.o=)",
  "      /:>^<:\\    )",
  "     / .| |. \\  /",
  "     \\__|_|__/_/",
];
const winkingCatFrame = [sittingCatFrame[0], "      (=o.-=)", ...sittingCatFrame.slice(2)];
const lickingCatFrames = [
  ["       /\\_/\\", "      (=-.-=)", "      /: v( )   )", "     / .| . \\  /", "     \\__|_|__/_/"],
  ["       /\\_/\\", "      (=-.-=)", "      /: -( )   )", "     / .| . \\  /", "     \\__|_|__/_/"],
];
const scratchingCatFrames = [
  ["       /\\_/\\", "      (=o.-=)()", "      /:>^< /   )", "     / .| ./ \\ /", "     \\__|_|__/_/"],
  ["       /\\_/\\ ()", "      (=o.-=) /", "      /:>^< /   )", "     / .| ./ \\ /", "     \\__|_|__/_/"],
];

export function dashboardCatArt(activity: DashboardCatActivity, frame: number): string[] {
  if (activity === "lick") return lickingCatFrames[frame];
  if (activity === "scratch") return scratchingCatFrames[frame];
  return activity === "wink" ? winkingCatFrame : sittingCatFrame;
}

const h = React.createElement;
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

// DashboardHeader
// ┌────────────────────────────────────────────────────────┐
// │ cat art │ KITIA wordmark (or compact title)             │
// │         │ screen/version                                │
// │         │ metadata                                      │
// │         │                                               │
// └────────────────────────────────────────────────────────┘
// Compact titles add two blank rows below metadata.
export function DashboardHeader({ versionLabel, screenName, metadata, columns }: {
  versionLabel: string;
  screenName: string;
  metadata: string;
  columns: number;
  activeSection?: "inventory" | "browse" | "catalogs";
}) {
  const [grooming, setGrooming] = useState<{ activity: DashboardCatActivity; frame: number }>({
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
  const art = dashboardCatArt(grooming.activity, grooming.frame);
  return h(AnimatedBrand, { art, catWidth, textWidth, versionLabel, screenName, metadata });
}
