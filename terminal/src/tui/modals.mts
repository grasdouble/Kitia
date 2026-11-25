'use strict';

import { Box, measureElement, Text } from 'ink';
import type { DOMElement } from 'ink';
import React from 'react';

import { DASHBOARD_THEME } from './colors.js';
import { Panel } from './components/panel.mjs';
import { categorizedShortcutLines, wrappedShortcutLines } from './components/shortcuts/shortcut-lines.mjs';
import { ShortcutsPanel } from './components/shortcuts/shortcuts-panel.mjs';
import { fitColumn, fitText, wrapText } from './helpers.mjs';
import { DashboardMouseRegions, type DashboardMouseRegion, type DashboardMouseTarget } from './input-transport.mjs';

type ModalOption = { label: string; color?: string };
type ModalContentLine = {
  text: string;
  type?: 'choice-group' | 'selectable-option';
  label?: string;
  options?: ModalOption[];
  selectedIndex?: number;
  focused?: boolean;
  selected?: boolean;
  color?: string;
  borderColor?: string;
  bold?: boolean;
  dimColor?: boolean;
  preserveSpacing?: boolean;
  mouseTarget?: DashboardMouseTarget;
};
type ModalContentEntry = string | ModalContentLine;
type ModalRenderedLine = ModalContentLine & { bodyText?: string; component?: 'choice-group' | 'selectable-option' };
type ChoiceGroupLine = ModalRenderedLine & {
  component: 'choice-group';
  label: string;
  options: ModalOption[];
  selectedIndex: number;
  focused: boolean;
};
type SelectableOptionLine = ModalRenderedLine & {
  component: 'selectable-option';
  label: string;
  bodyText: string;
  selected: boolean;
};
type ChoiceGroupEntry = ModalContentLine & {
  type: 'choice-group';
  label: string;
  options: ModalOption[];
  selectedIndex: number;
  focused: boolean;
};
type SelectableOptionEntry = ModalContentLine & { type: 'selectable-option'; label: string; selected: boolean };
type ModalFrameResult = {
  width: number;
  accent: string;
  panelTitle?: string;
  headerLines: Array<{ text: string }>;
  lines: ModalRenderedLine[];
  shortcuts: string[];
  destinationMenu?: {
    items: { title: string; directory: string; tracked: boolean }[];
    index: number;
    move: NonNullable<DashboardMouseRegion['scroll']>;
  };
};
type ModalElementRef = React.RefObject<DOMElement | null>;
type ChoiceGroupRefs = { row: ModalElementRef; options: ModalElementRef[] };

const h = React.createElement;
const MODAL_BACKGROUND = DASHBOARD_THEME.semantic.modal.background;
const MODAL_FOREGROUND = DASHBOARD_THEME.semantic.modal.foreground;

const { semantic } = DASHBOARD_THEME;
function choiceLabel(choice: string): string {
  return choice.toUpperCase();
}

function choiceButtonWidth(choice: string): number {
  return choiceLabel(choice).length + 4;
}

function choiceOutline(choice: string): string {
  return `╭${'─'.repeat(choiceButtonWidth(choice) - 2)}╮`;
}

export function choiceGroup(
  label: string,
  choices: Array<string | ModalOption>,
  selectedIndex: number,
  focused = true,
): ChoiceGroupEntry {
  const options = choices.map((choice) => (typeof choice === 'string' ? { label: choice } : choice));
  const prefix = label ? `${label.padEnd(8)} ` : '';
  const text = `${prefix}${options.map((choice) => choiceOutline(choice.label)).join(' ')}`;
  return {
    type: 'choice-group',
    text,
    label: prefix,
    options,
    selectedIndex,
    focused,
  };
}

export function categorizeShortcutHint(hint: string) {
  const groups: Record<'Actions' | 'Filters' | 'Display' | 'Navigation', string[]> = {
    Actions: [],
    Filters: [],
    Display: [],
    Navigation: [],
  };
  for (const shortcut of hint.split(' · ')) {
    const value = shortcut.toUpperCase();
    const category = /FILTER|SEARCH|TYPE TO|BACKSPACE|APPLY|CLEAR/.test(value)
      ? 'Filters'
      : /DETAILS|SHOW DETAILS|PANEL/.test(value)
        ? 'Display'
        : /↑|↓|←|→|PGUP|PGDN|TAB|NAVIGATE|SELECT|CHOOSE|MOVE|GUIDE|QUIT|BACK|NEXT|FINISH|INVENTORY/.test(value)
          ? 'Navigation'
          : 'Actions';
    groups[category].push(shortcut);
  }
  return categorizedShortcutLines(groups);
}

export function selectableOption(label: string, selected: boolean): SelectableOptionEntry {
  return {
    type: 'selectable-option',
    text: `${selected ? '› ' : '  '}${label}`,
    label,
    selected,
  };
}

export function modalFrame(
  title: string,
  content: ModalContentEntry[],
  columns: number,
  accent: string,
  maxWidth = 64,
  headerContent?: string[],
): ModalFrameResult {
  const separateHeader = headerContent !== undefined;
  const width = Math.max(20, Math.min(maxWidth, columns - 4));
  const innerWidth = width - 4;
  const lastContent = content.at(-1);
  const shortcutHint =
    typeof lastContent === 'string' &&
    /ENTER|ESC|CHOOSE|SELECT|FIELD|BACK|NEXT|CANCEL|CLOSE|QUIT|CONFIRM|TOGGLE|CTRL|SPACE|Y\/N/i.test(lastContent)
      ? lastContent
      : undefined;
  const modalContent = shortcutHint ? content.slice(0, -1) : content;
  const label = separateHeader ? '' : ` ${fitText(title, width - 5)} `;
  const top = separateHeader ? '' : `┌─${label}${'─'.repeat(Math.max(0, width - label.length - 3))}┐`;
  const body: ModalRenderedLine[] = modalContent.flatMap((entry) => {
    const row: ModalContentLine = typeof entry === 'string' ? { text: entry } : entry;
    const wrapped = row.preserveSpacing ? [row.text] : wrapText(row.text, innerWidth);
    return wrapped.map((line) => ({
      text: separateHeader
        ? line
        : `│ ${row.preserveSpacing ? line.padEnd(innerWidth) : fitColumn(line, innerWidth)} │`,
      bodyText: line,
      component: wrapped.length === 1 && row.text.length <= innerWidth ? row.type : undefined,
      label: row.label,
      options: row.options,
      selectedIndex: row.selectedIndex,
      focused: row.focused,
      selected: row.selected,
      color: row.color,
      bold: row.bold,
      dimColor: row.dimColor,
      borderColor: accent,
      mouseTarget: row.mouseTarget,
    }));
  });
  return {
    width,
    accent,
    panelTitle: separateHeader ? title : undefined,
    headerLines: (headerContent || []).flatMap((text) => wrapText(text, innerWidth).map((text) => ({ text }))),
    lines: separateHeader
      ? body
      : [
          { text: top, color: accent, bold: true },
          ...body,
          { text: `└${'─'.repeat(width - 2)}┘`, color: accent, bold: true },
        ],
    shortcuts: shortcutHint ? categorizeShortcutHint(shortcutHint.replaceAll(' | ', ' · ')) : [],
  };
}

export function loadingModal({
  message,
  frame,
  columns,
}: {
  message: string;
  frame: string;
  columns: number;
}): ModalFrameResult {
  return modalFrame(
    'LOADING',
    [
      { text: `${frame} ${message}`, color: semantic.selected, bold: true },
      '',
      'Please wait while Kitia completes this operation.',
    ],
    columns,
    semantic.selected,
    72,
  );
}

function fixedModalText(text: string, props: React.ComponentProps<typeof Text>, ref?: ModalElementRef) {
  return h(Box, { flexShrink: 0, ref }, h(Text, props, text));
}

function ChoiceGroup({
  line,
  rowRef,
  optionRefs = [],
}: {
  line: ChoiceGroupLine;
  rowRef?: ModalElementRef;
  optionRefs?: ModalElementRef[];
}) {
  const width = line.text.length;
  const borderColor = line.borderColor || semantic.accents.muted;
  const contentWidth = Math.max(0, width - 3);
  const buttonWidths = line.options.map((option) => choiceButtonWidth(option.label));
  const contentLength =
    line.label.length +
    buttonWidths.reduce((length, buttonWidth, index) => length + buttonWidth + Number(index > 0), 0);
  const padding = Math.max(0, contentWidth - contentLength);
  const vertical = (values: string[], textProps: React.ComponentProps<typeof Text>, cellWidth: number) =>
    h(
      Box,
      {
        flexDirection: 'column',
        width: cellWidth,
        height: 3,
        flexShrink: 0,
      },
      ...values.map((text, index) =>
        h(
          Text,
          {
            key: `choice-cell-${index}`,
            backgroundColor: MODAL_BACKGROUND,
            ...textProps,
          },
          text,
        ),
      ),
    );
  const options = line.options.flatMap((option, index) => {
    const active = index === line.selectedIndex;
    const label = choiceLabel(option.label);
    const buttonWidth = buttonWidths[index];
    const color = active ? option.color || semantic.accents.primary : semantic.accents.neutral;
    const frameColor = active ? color : semantic.accents.muted;
    return [
      ...(index ? [vertical([' ', ' ', ' '], { color: MODAL_BACKGROUND }, 1)] : []),
      h(
        Box,
        {
          key: `choice-button-${index}`,
          ref: optionRefs[index],
          flexDirection: 'column',
          width: buttonWidth,
          height: 3,
          flexShrink: 0,
        },
        h(Text, { backgroundColor: MODAL_BACKGROUND, color: frameColor }, `╭${'─'.repeat(buttonWidth - 2)}╮`),
        h(
          Text,
          {
            backgroundColor: MODAL_BACKGROUND,
            color,
            bold: active && line.focused,
          },
          `│ ${label} │`,
        ),
        h(Text, { backgroundColor: MODAL_BACKGROUND, color: frameColor }, `╰${'─'.repeat(buttonWidth - 2)}╯`),
      ),
    ];
  });
  return h(
    Box,
    { ref: rowRef, width, height: 3, flexDirection: 'row' },
    vertical(['│ ', '│ ', '│ '], { color: borderColor }, 2),
    vertical(
      [' '.repeat(line.label.length), line.label, ' '.repeat(line.label.length)],
      { color: semantic.accents.label },
      line.label.length,
    ),
    ...options,
    vertical([' '.repeat(padding), ' '.repeat(padding), ' '.repeat(padding)], { color: MODAL_BACKGROUND }, padding),
    vertical(['│', '│', '│'], { color: borderColor }, 1),
  );
}

function SelectableOption({ line }: { line: SelectableOptionLine }) {
  return h(
    Box,
    { width: line.text.length, flexDirection: 'row' },
    fixedModalText('│ ', { backgroundColor: MODAL_BACKGROUND, color: line.borderColor }),
    fixedModalText(line.selected ? '› ' : '  ', {
      backgroundColor: MODAL_BACKGROUND,
      color: line.selected ? semantic.selected : MODAL_FOREGROUND,
      bold: line.selected,
    }),
    fixedModalText(fitColumn(line.label, line.bodyText.length - 2), {
      backgroundColor: MODAL_BACKGROUND,
      color: line.selected ? semantic.selected : MODAL_FOREGROUND,
      bold: line.selected,
    }),
    fixedModalText(' '.repeat(Math.max(0, line.text.length - 3 - line.bodyText.length)), {
      backgroundColor: MODAL_BACKGROUND,
      color: MODAL_BACKGROUND,
    }),
    fixedModalText('│', { backgroundColor: MODAL_BACKGROUND, color: line.borderColor }),
  );
}

function isChoiceGroupLine(line: ModalRenderedLine): line is ChoiceGroupLine {
  return (
    line.component === 'choice-group' &&
    typeof line.label === 'string' &&
    line.options !== undefined &&
    typeof line.selectedIndex === 'number' &&
    typeof line.focused === 'boolean'
  );
}

function isSelectableOptionLine(line: ModalRenderedLine): line is SelectableOptionLine {
  return (
    line.component === 'selectable-option' &&
    typeof line.label === 'string' &&
    typeof line.selected === 'boolean' &&
    typeof line.bodyText === 'string'
  );
}
function ModalLine({ line, choiceRefs }: { line: ModalRenderedLine; choiceRefs?: ChoiceGroupRefs | null }) {
  const commonProps = {
    color: line.color || MODAL_FOREGROUND,
    backgroundColor: MODAL_BACKGROUND,
    bold: line.bold,
    dimColor: line.dimColor,
  };
  if (isChoiceGroupLine(line)) {
    return h(ChoiceGroup, { line, rowRef: choiceRefs?.row, optionRefs: choiceRefs?.options });
  }
  if (isSelectableOptionLine(line)) {
    return h(SelectableOption, { line });
  }
  const content =
    line.text?.startsWith('│') && line.text.endsWith('│')
      ? h(
          Text,
          { backgroundColor: MODAL_BACKGROUND },
          h(Text, { color: line.borderColor }, '│'),
          h(Text, commonProps, line.text.slice(1, -1)),
          h(Text, { color: line.borderColor }, '│'),
        )
      : h(Text, commonProps, line.text || ' ');
  return choiceRefs?.row
    ? h(Box, { ref: choiceRefs.row, width: line.text?.length || 1, height: 1, flexShrink: 0 }, content)
    : content;
}

function destinationPopover(modal: ModalFrameResult, left: number, top: number, rows: number) {
  const menu = modal.destinationMenu;
  if (!menu) return;
  let below = top;
  for (const line of modal.lines) {
    below += isChoiceGroupLine(line) ? 3 : 1;
    if (line.mouseTarget?.type === 'modal-destinations') break;
  }
  const above = below - 1;
  const width = modal.width - 4;
  const inner = width - 4;
  const needsDetailRow = menu.items.some(({ title, directory }) => title.length + directory.length + 5 > inner);
  const fullHeight = menu.items.length * (needsDetailRow ? 2 : 1) + 2;
  const useAbove = rows - below < fullHeight && above > rows - below;
  const room = useAbove ? above : rows - below;
  const bordered = room >= 3;
  const bodyRows = Math.max(1, room - (bordered ? 2 : 0));
  const itemHeight = needsDetailRow && bodyRows >= 2 ? 2 : 1;
  const count = Math.min(menu.items.length, Math.floor(bodyRows / itemHeight));
  const first = Math.max(0, Math.min(menu.index - count + 1, menu.items.length - count));
  const height = count * itemHeight + (bordered ? 2 : 0);
  const x = left + 2;
  const y = useAbove ? above - height : below;
  const regions: DashboardMouseRegion[] = [];
  const parts = [];
  const frame = (start: string, end: string, more: string) =>
    h(
      Text,
      { key: start, backgroundColor: MODAL_BACKGROUND, color: semantic.accents.primary },
      `${start}${'─'.repeat(width - 2 - more.length)}${more}${end}`,
    );
  if (bordered) parts.push(frame('╭', '╮', first ? ' ↑ ' : ''));
  for (let index = first; index < first + count; index += 1) {
    const { title, directory, tracked } = menu.items[index];
    const active = menu.index === index;
    const color = active ? semantic.selected : tracked ? semantic.inventoryStatus.attention : MODAL_FOREGROUND;
    const marker = active ? '› ' : '  ';
    const line = (text: string) => `│ ${text.padEnd(inner)} │`;
    const label = itemHeight === 1 ? `${title} · ${directory}` : title;
    parts.push(
      h(
        Text,
        { key: index, backgroundColor: MODAL_BACKGROUND, color, bold: active },
        line(marker + fitText(label, inner - 2)),
      ),
    );
    if (itemHeight === 2) {
      parts.push(
        h(
          Text,
          { key: `directory-${index}`, backgroundColor: MODAL_BACKGROUND, color, dimColor: !active },
          line(`  ${fitText(directory, inner - 2)}`),
        ),
      );
    }
    const start = y + Number(bordered) + (index - first) * itemHeight;
    regions.push({
      left: x + 1,
      right: x + width,
      top: start + 1,
      bottom: start + itemHeight,
      target: { type: 'modal-option', group: 'destination', index },
      scroll: menu.move,
    });
  }
  if (bordered) parts.push(frame('╰', '╯', first + count < menu.items.length ? ' ↓ ' : ''));
  regions.push({
    left: x + 1,
    right: x + width,
    top: y + 1,
    bottom: y + height,
    target: { type: 'modal-destinations', action: 'surface' },
    scroll: menu.move,
  });
  return {
    regions,
    element: h(Box, { position: 'absolute', top: y, left: x, width, flexDirection: 'column' }, ...parts),
  };
}

export function ModalOverlay({
  modal,
  columns,
  rows,
  mouse,
}: {
  modal: ModalFrameResult;
  columns: number;
  rows: number;
  mouse?: DashboardMouseRegions;
}) {
  const shortcutsRows = modal.shortcuts.length ? wrappedShortcutLines(modal.shortcuts, modal.width).length + 4 : 0;
  const choiceRows = modal.lines.filter(({ component }) => component === 'choice-group').length * 2;
  const modalHeight =
    modal.lines.length +
    choiceRows +
    modal.headerLines.length +
    (modal.panelTitle ? 4 : 0) +
    (shortcutsRows ? shortcutsRows + 1 : 0);
  const top = Math.max(0, Math.floor((rows - modalHeight) / 2));
  const left = Math.max(0, Math.floor((columns - modal.width) / 2));
  const popover = destinationPopover(modal, left, top, rows);
  const choiceRefs = React.useRef<Array<ChoiceGroupRefs | null>>([]);
  choiceRefs.current.length = modal.lines.length;
  for (const [lineIndex, line] of modal.lines.entries()) {
    if (!modal.panelTitle && (line.mouseTarget || (line.options?.length && typeof line.bodyText === 'string'))) {
      const current = choiceRefs.current[lineIndex];
      choiceRefs.current[lineIndex] = {
        row: current?.row || React.createRef<DOMElement>(),
        options: isChoiceGroupLine(line)
          ? line.options.map((_, index) => current?.options[index] || React.createRef<DOMElement>())
          : [],
      };
    } else {
      choiceRefs.current[lineIndex] = null;
    }
  }
  React.useLayoutEffect(() => {
    const regions: DashboardMouseRegion[] = [];
    if (!modal.panelTitle) {
      for (const [lineIndex, line] of modal.lines.entries()) {
        const refs = choiceRefs.current[lineIndex];
        const row = refs?.row.current;
        if (!row) continue;
        const rowLayout = measureElement(row);
        if (line.mouseTarget) {
          regions.push({
            left: rowLayout.x + 1,
            right: Math.min(columns, rowLayout.x + rowLayout.clientWidth),
            top: rowLayout.y + 1,
            bottom: Math.min(rows, rowLayout.y + rowLayout.clientHeight),
            target: line.mouseTarget,
          });
          continue;
        }
        if (!line.options?.length || typeof line.bodyText !== 'string') continue;
        const group = String(line.label || '')
          .trim()
          .toLowerCase();
        if (group && group !== 'scope') continue;
        const bodyOffset = typeof line.text === 'string' ? line.text.indexOf(line.bodyText) : -1;
        for (const [index, option] of line.options.entries()) {
          const label = option.label;
          const target: DashboardMouseTarget =
            group === 'scope' ? { type: 'modal-option', group, index } : { type: 'modal-choice', index };
          const node = refs?.options[index]?.current;
          if (node) {
            const optionLayout = measureElement(node);
            const visibleWidth = Math.max(
              0,
              Math.min(
                optionLayout.clientWidth,
                rowLayout.x + rowLayout.clientWidth - optionLayout.x,
                columns - optionLayout.x,
              ),
            );
            if (visibleWidth && optionLayout.clientHeight)
              regions.push({
                left: optionLayout.x + 1,
                right: optionLayout.x + visibleWidth,
                top: optionLayout.y + 1,
                bottom: optionLayout.y + optionLayout.clientHeight,
                target,
              });
            continue;
          }
          const outline = choiceOutline(label);
          const offset = line.bodyText.indexOf(outline);
          if (bodyOffset < 0 || offset < 0) continue;
          const start = rowLayout.x + bodyOffset + offset;
          const visibleWidth = Math.max(
            0,
            Math.min(outline.length, rowLayout.clientWidth - bodyOffset - offset, columns - start),
          );
          if (visibleWidth)
            regions.push({
              left: start + 1,
              right: start + visibleWidth,
              top: rowLayout.y + 1,
              bottom: rowLayout.y + rowLayout.clientHeight,
              target,
            });
        }
      }
    }
    mouse?.replace(
      'modal',
      popover
        ? [
            ...popover.regions,
            ...regions.filter(({ target }) => target.type === 'modal-destinations'),
            {
              left: 1,
              right: columns,
              top: 1,
              bottom: rows,
              target: { type: 'modal-destinations', action: 'dismiss' },
            },
          ]
        : regions,
    );
    return () => mouse?.replace('modal', []);
  });
  const frame = h(
    Box,
    {
      position: 'absolute',
      top,
      left,
      width: modal.width,
      flexDirection: 'column',
    },
    modal.panelTitle
      ? h(
          Panel,
          {
            title: modal.panelTitle,
            width: modal.width,
            color: modal.accent,
            backgroundColor: MODAL_BACKGROUND,
            separateHeader: true,
            headerContent: modal.headerLines.map((line, index) => h(ModalLine, { key: `modal-header-${index}`, line })),
          },
          ...modal.lines.map((line, index) =>
            h(ModalLine, {
              key: `modal-line-${index}`,
              line,
              choiceRefs: choiceRefs.current[index] || undefined,
            }),
          ),
        )
      : modal.lines.map((line, index) =>
          h(ModalLine, {
            key: `modal-line-${index}`,
            line,
            choiceRefs: choiceRefs.current[index] || undefined,
          }),
        ),
    ...(modal.shortcuts.length
      ? [
          h(Text, { key: 'modal-shortcuts-gap', backgroundColor: MODAL_BACKGROUND }, ' '.repeat(modal.width)),
          h(ShortcutsPanel, {
            key: 'modal-shortcuts',
            lines: modal.shortcuts,
            width: modal.width,
            color: modal.accent,
            backgroundColor: MODAL_BACKGROUND,
          }),
        ]
      : []),
  );
  return popover ? h(React.Fragment, null, frame, popover.element) : frame;
}
