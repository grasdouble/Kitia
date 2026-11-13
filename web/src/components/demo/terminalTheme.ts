import type { ITheme } from '@xterm/xterm';
import { DASHBOARD_THEME } from '../../../../cli/src/dashboard/colors';

const { semantic, terminalAnsi } = DASHBOARD_THEME;
const palette = terminalAnsi.palette;

/** Resolve a shared TUI color role without introducing browser-specific semantic roles. */
export function terminalColor(color: string): string {
  const code = terminalAnsi[color as keyof typeof terminalAnsi];
  if (typeof code !== 'string') return color;
  const value = Number(code);
  const index = value >= 90 ? value - 90 + 8 : value - 30;
  return palette[index] ?? color;
}

export const XTERM_THEME: ITheme = {
  background: palette[0],
  foreground: palette[7],
  cursor: palette[7],
  cursorAccent: palette[0],
  selectionBackground: terminalColor(semantic.selected),
  selectionForeground: palette[0],
  black: palette[0],
  red: palette[1],
  green: palette[2],
  yellow: palette[3],
  blue: palette[4],
  magenta: palette[5],
  cyan: palette[6],
  white: palette[7],
  brightBlack: palette[8],
  brightRed: palette[9],
  brightGreen: palette[10],
  brightYellow: palette[11],
  brightBlue: palette[12],
  brightMagenta: palette[13],
  brightCyan: palette[14],
  brightWhite: palette[15],
};
