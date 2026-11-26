'use strict';

import type {
  DashboardControlFocus,
  DashboardFilter,
  DashboardMouseRegion,
  DashboardMouseRegions,
  DashboardSection,
} from '../../input-transport.mjs';
import { DASHBOARD_HEADER_ROWS } from '../../sections/header.mjs';

export interface DashboardControlButton {
  id: string;
  label: string;
}

export interface DashboardControlFilter {
  id: DashboardFilter;
  value: string;
  options: string[];
}

export type DashboardControlPart = 'all' | 'tabs' | 'filters';
export type DashboardControlLayoutMode = 'stacked' | 'toolbar';

export interface ControlsProps {
  columns: number;
  rows?: number;
  section: DashboardSection;
  sectionCounts?: Partial<Record<DashboardSection, number>>;
  focus: DashboardControlFocus;
  query: string;
  searchActive: boolean;
  showSearch?: boolean;
  filters?: DashboardControlFilter[];
  menuFilter?: DashboardFilter | null;
  menuOptions?: string[];
  menuIndex?: number;
  menuOverlayOnly?: boolean;
  modalActive?: boolean;
  /** Keep action pairs together when they fit, without mixing adjacent groups on narrow panels. */
  actionPairs?: boolean;
  /** Omit the heading row when contextual buttons directly follow selection details. */
  hideActionHeading?: boolean;
  /** Use single-line actions when the details pane cannot fit the boxed layout. */
  compactActions?: boolean;
  actions?: DashboardControlButton[];
  actionsInToolbar?: boolean;
  actionIndex?: number;
  mouse?: DashboardMouseRegions;
  scrollList?: (direction: -1 | 1) => void;
  part?: DashboardControlPart;
  /** Arrange search and filter controls on one row when they fit. */
  layout?: DashboardControlLayoutMode;
  /** Additional rows after the physical brand header, used for mouse hit testing. */
  rowOffset?: number;
  /** Use readable selected-card colors for contextual actions inside a selected surface. */
  selectedSurface?: boolean;
}

export interface ControlItem {
  id: string;
  label: string;
  target: DashboardMouseRegion['target'];
  text?: string;
}

export type LayoutItem = ControlItem & { text: string; width: number };
export type ControlLineKind = 'tab-top' | 'tabs' | 'tab-underline' | 'labels' | 'fields' | 'actions';
export interface ControlMenu {
  left: number;
  top: number;
  width: number;
  first: number;
  count: number;
  selectedValue: string;
  allLabel: string;
}

export interface ControlLine {
  row: number;
  items: LayoutItem[];
  kind: ControlLineKind;
}

export interface ControlsLayout {
  width: number;
  height: number;
  lines: ControlLine[];
  menu?: ControlMenu;
}

function splitControlLines(
  items: LayoutItem[],
  maxWidth: number,
  row: number,
  kind: ControlLineKind,
  stride = 1,
  gap = 1,
) {
  const lines: ControlLine[] = [];
  let lineItems: LayoutItem[] = [];
  let used = 0;
  const width = Math.max(1, maxWidth);
  for (const item of items) {
    const itemWidth = Math.max(1, Math.min(width, item.width));
    if (lineItems.length && used + gap + itemWidth > width) {
      lines.push({ row: row + lines.length * stride, kind, items: lineItems });
      lineItems = [];
      used = 0;
    }
    lineItems.push({ ...item, width: itemWidth });
    used += (lineItems.length > 1 ? gap : 0) + itemWidth;
  }
  if (lineItems.length) lines.push({ row: row + lines.length * stride, kind, items: lineItems });
  return lines;
}

export function sectionTabMetrics(width: number) {
  const compact = width < 62;
  return { inset: compact ? 0 : 1, itemPadding: compact ? 0 : 1, gap: compact ? 1 : 2 };
}

function filterLabel(filter: DashboardFilter) {
  if (filter === 'unmanaged') return 'Unmanaged';
  return filter === 'kind' ? 'Kind' : filter === 'catalog' ? 'Catalog' : 'License';
}

function filterValue(filter: DashboardControlFilter) {
  if (filter.value !== 'all') return filter.value;
  return filter.id === 'kind' ? 'All kinds' : filter.id === 'catalog' ? 'All catalogs' : 'All licenses';
}

function filterWidth(filter: DashboardControlFilter, width: number) {
  if (filter.id === 'unmanaged') return Math.min(width, 13);
  return Math.min(width, Math.max(8, filterLabel(filter.id).length, Math.min(22, filterValue(filter).length + 5)));
}

function actionButtonLines(props: ControlsProps, width: number) {
  if (props.actionsInToolbar || props.modalActive || !props.actions?.length) return [];
  const safeWidth = Math.max(1, width);
  const stride = props.compactActions ? 1 : 3;
  const items = props.actions.map((action): LayoutItem => ({
    id: action.id,
    label: action.label,
    text: action.label,
    width: Math.min(safeWidth, Math.max(1, action.label.length + (props.compactActions ? 2 : 4))),
    target: { type: 'action', action: action.id },
  }));
  if (!props.actionPairs) return splitControlLines(items, safeWidth, 0, 'actions', stride);
  const lines: ControlLine[] = [];
  for (let index = 0; index < items.length;) {
    const pair = items.slice(index, index + 2);
    if (pair.length === 2 && pair[0].width + 1 + pair[1].width <= safeWidth) {
      lines.push({ row: lines.length * stride, kind: 'actions', items: pair });
    } else {
      for (const item of pair) {
        lines.push({
          row: lines.length * stride,
          kind: 'actions',
          items: [{ ...item, width: Math.min(item.width, safeWidth) }],
        });
      }
    }
    index += pair.length;
  }
  return lines;
}

export function dashboardActionButtonRows(props: ControlsProps, width: number) {
  const rows = actionButtonLines(props, width).length;
  return rows ? Number(!props.hideActionHeading) + rows * (props.compactActions ? 1 : 3) : 0;
}

export function dashboardActionButtonLines(props: ControlsProps, width: number) {
  return actionButtonLines(props, width);
}

export function dashboardControlsLayout(props: ControlsProps): ControlsLayout {
  const width = Math.max(1, props.columns - 2);
  const fieldRows = props.rows && props.rows < 40 ? 2 : 4;
  const lines: ControlLine[] = [];
  const part = props.part || 'all';
  let row = 0;
  if (part !== 'filters') {
    const sectionNames: Record<DashboardSection, string> = {
      inventory: 'Inventory',
      browse: 'Browse resources',
      catalogs: 'Manage Catalogs',
    };
    const tabMetrics = sectionTabMetrics(width);
    const sections = ['inventory', 'browse', 'catalogs'] as const;
    const tabWidth = (section: DashboardSection) =>
      sectionNames[section].length +
      String(props.sectionCounts?.[section] ?? 0).length +
      1 +
      tabMetrics.itemPadding * 2;
    const availableTabWidth = Math.max(1, width - 2 - tabMetrics.inset * 2);
    // Leave room for the focus marker so focusing a tab does not wrap the strip.
    const preferredTabWidth = () =>
      sections.reduce((total, section) => total + tabWidth(section), 2 + 2 * tabMetrics.gap);
    if (preferredTabWidth() > availableTabWidth) sectionNames.browse = 'Browse';
    if (preferredTabWidth() > availableTabWidth) sectionNames.catalogs = 'Manage…';
    const tabs: LayoutItem[] = sections.map((section) => ({
      id: section,
      label: sectionNames[section],
      text: `${sectionNames[section]} ${props.sectionCounts?.[section] ?? 0}`,
      width: tabWidth(section) + Number(props.focus === 'tabs' && props.section === section) * 2,
      target: { type: 'section', section },
    }));
    const tabLines = splitControlLines(tabs, availableTabWidth, row, 'tabs', 3, tabMetrics.gap);
    for (const tabLine of tabLines) {
      lines.push(
        { ...tabLine, kind: 'tab-top' },
        { ...tabLine, row: tabLine.row + 1 },
        { ...tabLine, row: tabLine.row + 2, kind: 'tab-underline' },
      );
    }
    row += tabLines.length * 3;
  }
  if (part === 'tabs' || props.modalActive) return { width, height: row, lines, menu: undefined };

  const filters = ['kind', 'catalog', 'license', 'unmanaged'].flatMap((id) =>
    (props.filters || []).filter((filter) => filter.id === id),
  );
  const showSearch = props.showSearch !== false;
  const searchItem = (fieldWidth: number): LayoutItem => ({
    id: 'search',
    label: 'Search',
    text: props.query || (props.searchActive ? '' : 'Search resources…'),
    width: fieldWidth,
    target: { type: 'focus', focus: 'search' },
  });
  const selectorItems: LayoutItem[] = filters.map((filter) => ({
    id: filter.id,
    label: filterLabel(filter.id),
    text: filterValue(filter),
    width: filterWidth(filter, width),
    target: { type: 'filter-open', filter: filter.id },
  }));
  const selectorWidth = selectorItems.reduce((total, item, index) => total + item.width + Number(index > 0), 0);
  const canUseToolbar =
    props.layout === 'toolbar' &&
    showSearch &&
    selectorItems.length > 0 &&
    selectorWidth + 18 + Number(selectorItems.length) <= width;
  if (canUseToolbar) {
    const searchWidth = width - selectorWidth - selectorItems.length;
    const items = [searchItem(searchWidth), ...selectorItems];
    lines.push({ row, kind: 'labels', items }, { row: row + 1, kind: 'fields', items });
    row += fieldRows;
  } else {
    if (showSearch) {
      const item = searchItem(width);
      lines.push({ row, kind: 'labels', items: [item] }, { row: row + 1, kind: 'fields', items: [item] });
      row += fieldRows;
    }
    const selectorLines = splitControlLines(selectorItems, width, row, 'fields', fieldRows);
    for (const selectorLine of selectorLines) {
      lines.push(
        { row: selectorLine.row, kind: 'labels', items: selectorLine.items },
        { ...selectorLine, row: selectorLine.row + 1 },
      );
      row += fieldRows;
    }
  }

  let menu: ControlMenu | undefined;
  const options = props.menuFilter ? props.menuOptions || [] : [];
  if (props.menuFilter && options.length) {
    const filterLine = lines.find(
      (line) => line.kind === 'fields' && line.items.some((item) => item.id === props.menuFilter),
    );
    const filterIndex = filterLine?.items.findIndex((item) => item.id === props.menuFilter) ?? -1;
    const anchor = filterLine?.items[filterIndex];
    const filter = filters.find(({ id }) => id === props.menuFilter);
    if (filterLine && anchor && filter) {
      const left = 2 + filterLine.items.slice(0, filterIndex).reduce((used, item) => used + item.width + 1, 0);
      const localLeft = left - 2;
      const fieldBottom = filterLine.row + (fieldRows === 2 ? 0 : 2);
      let top = fieldBottom;
      const terminalBottom = props.rows
        ? props.rows - DASHBOARD_HEADER_ROWS - (props.rowOffset || 0)
        : Number.POSITIVE_INFINITY;
      const availableRows = Math.max(0, terminalBottom - top);
      const count = Math.min(5, options.length, Math.max(1, availableRows - 2));
      const panelHeight = count + 2;
      if (availableRows < panelHeight) top = Math.max(0, terminalBottom - panelHeight);
      const availableWidth = Math.max(1, width - localLeft);
      const allLabel = filterValue({ ...filter, value: 'all' });
      const longestOption = Math.max(...options.map((value) => Array.from(value === 'all' ? allLabel : value).length));
      const desiredWidth = Math.max(anchor.width, Math.min(32, longestOption + 7));
      const menuWidth = Math.min(availableWidth, desiredWidth);
      const first = Math.max(0, Math.min((props.menuIndex || 0) - count + 1, options.length - count));
      menu = {
        left: localLeft,
        top,
        width: menuWidth,
        first,
        count,
        selectedValue: filter.value,
        allLabel,
      };
    }
  }

  if (props.actionsInToolbar && props.actions?.length) {
    const actionItems = props.actions.map((action): LayoutItem => ({
      id: action.id,
      label: action.label,
      text: action.label,
      width: Math.min(width, action.label.length + 4),
      target: { type: 'action', action: action.id },
    }));
    const actionLines = splitControlLines(actionItems, width, row, 'actions', 3);
    for (const actionLine of actionLines) {
      lines.push(actionLine);
      row += 3;
    }
  }
  return { width, height: row, lines, menu };
}
