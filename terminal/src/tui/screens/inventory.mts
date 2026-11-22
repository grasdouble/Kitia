'use strict';

import { Box, Text } from 'ink';
import React from 'react';

import type { ScanError } from '../../core/inventory/checks.js';
import type { CatalogResource } from '../../core/resources/model.js';
import { adaptiveColumnWidths } from '../../table-layout.js';
import { DASHBOARD_THEME, resolveRowColor } from '../colors.js';
import { ActionButtons } from '../components/button/button-layout.mjs';
import type { ControlsProps } from '../components/controls/control-layout-plan.mjs';
import { detailField, detailLocations } from '../components/detail-fields.mjs';
import { ResourceBrowserChrome, resourceBrowserPlan } from '../components/resource-browser.mjs';
import { SelectionDetails, useDashboardDetailPaging } from '../components/selection-details.mjs';
import { ShortcutFooter } from '../components/shortcuts/shortcut-footer.mjs';
import { categorizedShortcutLines, shortcutFooterLines } from '../components/shortcuts/shortcut-lines.mjs';
import { resourceTableRows, resourceTableWindow } from '../components/table/resource-table.mjs';
import { Controls } from '../controls.mjs';
import type { InventoryCatalogConfiguration } from '../helpers.mjs';
import {
  colorForStatus,
  dashboardStatus,
  filterInventory,
  inventoryCatalogLabels,
  issueLine,
  tableLine,
  fitText,
  wrapText,
} from '../helpers.mjs';
import { JoinedWorkspace } from '../layouts/joined-workspace.mjs';
import { DashboardHeader } from '../sections/header.mjs';
const h = React.createElement;
export function InventoryScreen({
  resources,
  errors,
  query,
  filterMode,
  catalogFilter,
  kindFilter,
  licenseFilter = 'all',
  selectedIndex,
  versionLabel,
  actionMessage,
  catalogAvailable,
  canExecute,
  showDetails,
  columns,
  rows,
  controls,
  modalActive = false,
  userCatalogs = [],
  inventoryLabels: suppliedInventoryLabels,
  tourStep,
}: {
  resources: CatalogResource[];
  errors: ScanError[];
  query: string;
  filterMode: boolean;
  catalogFilter: string;
  kindFilter: string;
  licenseFilter: string;
  selectedIndex: number;
  versionLabel: string;
  actionMessage: string;
  catalogAvailable: boolean;
  canExecute: boolean;
  showDetails: boolean;
  columns: number;
  rows: number;
  controls: ControlsProps;
  modalActive?: boolean;
  userCatalogs?: InventoryCatalogConfiguration[];
  inventoryLabels?: Map<CatalogResource, string>;
  tourStep?: number | null;
}) {
  const inventoryLabels = suppliedInventoryLabels || inventoryCatalogLabels(resources, userCatalogs);
  const visible = filterInventory(
    resources,
    query,
    catalogFilter,
    kindFilter,
    userCatalogs,
    inventoryLabels,
    licenseFilter,
  );
  const activeIndex = Math.min(selectedIndex, Math.max(0, visible.length - 1));
  const selected = visible[activeIndex];
  const detailPagingFocus =
    !modalActive && !filterMode && !controls.menuFilter && (controls.focus === 'list' || controls.focus === 'actions');
  const shortcutLines = modalActive
    ? []
    : filterMode
      ? categorizedShortcutLines({
          Filters: ['TYPE to search', 'BACKSPACE edit', 'ENTER apply', 'ESC clear'],
          Navigation: ['↑↓ navigate'],
        })
      : categorizedShortcutLines({
          Actions: [
            ...(catalogAvailable ? ['A install'] : []),
            ...(canExecute &&
            selected &&
            selected.scope &&
            (selected.managed === false
              ? Boolean(selected.paths?.length)
              : Boolean(selected.source_repository && selected.source_path))
              ? ['P preview']
              : []),
            ...(canExecute && selected && selected.managed !== false && dashboardStatus(selected) === 'update'
              ? ['U update']
              : []),
            ...(canExecute && selected ? [selected.managed === false ? 'Delete remove' : 'Delete uninstall'] : []),
          ],
          Filters: ['F filter', ...(resources.length ? ['C catalog', 'K kind', 'L license'] : [])],
          Display: ['D details'],
          Navigation: [
            '1/2/3 sections · M catalogs',
            '↑↓ navigate',
            ...(showDetails && selected && detailPagingFocus ? ['PgUp/PgDn details'] : []),
            '? guide',
            'Q quit',
          ],
        });
  const footerRows = shortcutFooterLines(shortcutLines, columns - 2).length + Number(Boolean(shortcutLines.length));
  const warningLines = errors.flatMap((error) =>
    wrapText(`${error.scope.toUpperCase()} · ${error.code}: ${error.message}`, Math.max(1, columns - 2)),
  );
  const warningBlockRows = warningLines.length ? warningLines.length + 1 : 0;
  const browserPlan = resourceBrowserPlan({
    controls,
    modalActive,
    columns,
    rows,
    warningRows: warningBlockRows,
    footerRows,
    showDetails,
  });
  const {
    controlsState,
    workspaceGap,
    workspaceHeight,
    workspaceTop,
    showWorkspaceDetails,
    showShortcutFooter,
    outerWorkspaceWidth,
    actionRows,
    workspaceLayout,
    listContentWidth,
    detailsContentWidth,
  } = browserPlan;
  const footer =
    showShortcutFooter && !modalActive ? h(ShortcutFooter, { lines: shortcutLines, width: columns - 2 }) : null;
  const warnings = warningLines.length
    ? h(
        Box,
        { width: columns - 2, marginTop: 1, flexDirection: 'column' },
        ...warningLines.map((line, index) =>
          h(
            Text,
            {
              key: `inventory-warning-${index}`,
              color: DASHBOARD_THEME.semantic.inventoryStatus.attention,
            },
            line,
          ),
        ),
      )
    : null;
  const visibleIds = visible.reduce((longest, resource) => Math.max(longest, String(resource.id || '').length), 8);
  const ultraCompactTable = listContentWidth < 28;
  const compactTable = listContentWidth < 58;
  const widths = ultraCompactTable
    ? [0, listContentWidth, 0, 0, 0]
    : adaptiveColumnWidths(listContentWidth, [
        { contentWidth: 2, minWidth: compactTable ? 1 : 2, maxWidth: 2, shrinkWeight: 0 },
        { contentWidth: Math.max(12, visibleIds), minWidth: compactTable ? 4 : 8, growWeight: 4 },
        { contentWidth: compactTable ? 5 : 11, minWidth: compactTable ? 3 : 5, growWeight: 1 },
        { contentWidth: compactTable ? 5 : 7, minWidth: compactTable ? 3 : 5, growWeight: 1 },
        { contentWidth: compactTable ? 8 : 17, minWidth: compactTable ? 4 : 6, growWeight: 2 },
      ]);
  const [markerWidth, resourceWidth, kindWidth, scopeWidth, statusWidth] = widths;
  const tableHeader = ultraCompactTable
    ? fitText('RESOURCE', listContentWidth)
    : tableLine([
        ['', markerWidth],
        ['RESOURCE', resourceWidth],
        ['KIND', kindWidth],
        ['SCOPE', scopeWidth],
        ['STATUS', statusWidth],
      ]);
  const tableWindow = resourceTableWindow<CatalogResource>(visible, activeIndex, workspaceLayout.listRows);
  const tableRows = resourceTableRows({
    window: tableWindow,
    selectedIndex: activeIndex,
    emptyMessage: 'No matching resources.',
    renderRow: (resource: CatalogResource, selectedRow: boolean) => {
      const status = dashboardStatus(resource);
      const row = ultraCompactTable
        ? fitText(`${selectedRow ? '› ' : ''}${resource.id}`, listContentWidth)
        : tableLine([
            [selectedRow ? '›' : '', markerWidth],
            [resource.id, resourceWidth],
            [resource.kind, kindWidth],
            [resource.scope || '-', scopeWidth],
            [
              status
                ? status === 'update'
                  ? 'Update available'
                  : `${status[0].toUpperCase()}${status.slice(1)}`
                : 'Current',
              statusWidth,
            ],
          ]);
      return {
        key: `${resource.managed === false ? 'unmanaged' : resource.catalog}:${resource.scope}:${resource.kind}:${resource.id}`,
        color: resolveRowColor(resource.kind, selectedRow, colorForStatus(dashboardStatus(resource))),
        text: row,
      };
    },
  });
  const hasDetail = (value: unknown) =>
    typeof value === 'string'
      ? Boolean(value.trim()) && value !== '-'
      : value !== undefined && value !== null && (!Array.isArray(value) || value.length > 0);
  const detailFieldRows = (fields: Array<{ key: string; label: string; value: unknown; color?: string }>) =>
    fields
      .filter(({ value }) => hasDetail(value))
      .flatMap((field, index) => [
        ...(index ? [h(Text, { key: `${field.key}-gap` }, ' ')] : []),
        ...detailField(field.key, field.label, field.value, detailsContentWidth, Infinity, field.color),
      ]);
  const description = selected?.description || 'No description available.';
  const selectedStatus = selected ? dashboardStatus(selected) || 'current' : '';
  const revision = selected?.source_ref || selected?.version;
  const installedRevision = hasDetail(revision) ? String(revision).slice(0, 7) : undefined;
  const catalog = selected ? inventoryLabels.get(selected) || selected.catalog : undefined;
  const license = selected?.license_spdx || selected?.license_status;
  const installedPath = selected?.paths?.join(' · ');
  const sourceLocation = selected?.source_repository ? `https://github.com/${selected.source_repository}` : '';
  const selectedIssues = selected?.issues?.length ? selected.issues.map(issueLine).join(' · ') : undefined;
  const unmanagedNote =
    selected?.managed === false ? 'Not managed by Kitia; removal requires two confirmations.' : undefined;
  const coreDetails = selected
    ? [
        ...detailFieldRows([
          { key: 'inventory-catalog', label: 'CATALOG', value: catalog },
          { key: 'inventory-license', label: 'LICENSE', value: license },
          { key: 'inventory-revision', label: 'INSTALLED REVISION', value: installedRevision },
          { key: 'inventory-path', label: 'INSTALLED PATH', value: installedPath },
        ]),
      ]
    : [];
  const optionalDetailParts: React.ReactNode[][] = [];
  const addOptionalField = (key: string, label: string, value: unknown, color?: string) => {
    if (hasDetail(value))
      optionalDetailParts.push(detailField(key, label, value, detailsContentWidth, Infinity, color));
  };
  if (selected) {
    addOptionalField('inventory-issues', 'ISSUES', selectedIssues);
    addOptionalField('inventory-note', 'NOTE', unmanagedNote);
    if (sourceLocation)
      optionalDetailParts.push([
        h(
          Text,
          {
            key: 'inventory-source-label',
            color: DASHBOARD_THEME.semantic.accents.label,
            bold: true,
          },
          fitText('SOURCE', detailsContentWidth),
        ),
        ...detailLocations('inventory-source', [{ text: sourceLocation, href: sourceLocation }], detailsContentWidth),
      ]);
    addOptionalField('inventory-source-path', 'SOURCE PATH', selected.source_path);
    addOptionalField('inventory-category', 'CATEGORY', selected.category);
    addOptionalField('inventory-tags', 'TAGS', selected.tags?.join(' · '));
    addOptionalField('inventory-use-when', 'USE WHEN', selected.use_when);
    addOptionalField('inventory-example', 'EXAMPLE', selected.example);
    addOptionalField('inventory-prerequisites', 'PREREQUISITES', selected.prerequisites?.join(' · '));
    addOptionalField('inventory-owner', 'OWNER', selected.owner);
    addOptionalField('inventory-expected-output', 'EXPECTED OUTPUT', selected.expected_output);
    addOptionalField('inventory-limitations', 'LIMITATIONS', selected.limitations?.join(' · '));
    addOptionalField('inventory-deprecation', 'DEPRECATION', selected.deprecation_reason);
    addOptionalField('inventory-replacement', 'REPLACEMENT', selected.replacement);
    addOptionalField('inventory-apply-to', 'APPLIES TO', (selected.apply_to || selected.applyTo)?.join(' · '));
    addOptionalField('inventory-action', 'MESSAGE', actionMessage);
  }
  const optionalDetails = optionalDetailParts.flatMap((part, index) => [
    ...(index ? [h(Text, { key: `inventory-optional-gap-${index}` }, ' ')] : []),
    ...part,
  ]);
  const detailRows = selected
    ? SelectionDetails({
        kind: selected.kind,
        id: selected.id,
        description,
        width: detailsContentWidth,
        kindColor: resolveRowColor(selected.kind, false, colorForStatus(selectedStatus)),
        metadata: [
          ...coreDetails,
          ...(optionalDetails.length
            ? [...(coreDetails.length ? [h(Text, { key: 'inventory-core-gap' }, ' ')] : []), ...optionalDetails]
            : []),
        ],
      })
    : [
        h(
          Text,
          {
            key: 'inventory-empty-detail',
            color: DASHBOARD_THEME.semantic.accents.muted,
          },
          errors.length
            ? 'No resource selected; see scan warnings above.'
            : resources.length
              ? 'No matching resource selected.'
              : 'No resources found.',
        ),
      ];

  const detailPaging = useDashboardDetailPaging({
    lines: detailRows,
    viewport: workspaceLayout.detailsContentRows,
    enabled: showDetails && !modalActive,
    filterMode,
    focus: controls.focus,
    menuFilter: controls.menuFilter,
    resetKey: [
      selected?.id,
      selected?.kind,
      selected?.scope,
      query,
      catalogFilter,
      kindFilter,
      licenseFilter,
      columns,
      rows,
      showDetails,
    ],
  });
  const actionButtons = actionRows ? ActionButtons({ controls: controlsState, width: detailsContentWidth }) : null;
  const firstResourceRow = workspaceTop + workspaceLayout.firstResourceRowOffset;
  controls.mouse?.replace(
    'inventory-rows',
    modalActive || !workspaceHeight
      ? []
      : tableWindow.items.map((_, index) => ({
          left: 3,
          right: workspaceLayout.listWidth + 2,
          top: firstResourceRow + index,
          bottom: firstResourceRow + index,
          target: {
            type: 'row' as const,
            screen: 'inventory' as const,
            index: tableWindow.first + index,
          },
        })),
  );
  return h(
    Box,
    { width: columns, height: rows, flexDirection: 'column', paddingX: 1, position: 'relative' },
    h(DashboardHeader, {
      versionLabel,
      screenName: 'INVENTORY',
      metadata: `RESOURCES ${visible.length}/${resources.length} · CATALOG ${catalogFilter.toUpperCase()} · KIND ${kindFilter.toUpperCase()} · LICENSE ${licenseFilter.toUpperCase()}`,
      columns,
    }),
    h(ResourceBrowserChrome, { plan: browserPlan, resources, columns }),
    warnings,
    workspaceHeight
      ? h(
          Box,
          { width: columns - 2, marginTop: workspaceGap },
          h(JoinedWorkspace, {
            width: outerWorkspaceWidth,
            height: workspaceHeight,
            layout: workspaceLayout,
            showDetails: showWorkspaceDetails,
            listTitle: 'INSTALLED RESOURCES',
            listMeta: `${visible.length} results`,
            listHeader: tableHeader,
            listRows: tableRows,
            detailsTitle: 'SELECTION DETAILS',
            details: detailPaging.visibleLines,
            detailsFooter: actionButtons,
            detailsHint: detailPaging.canPage ? 'PgUp/PgDn' : undefined,
            color:
              tourStep === 0
                ? DASHBOARD_THEME.semantic.inventoryStatus.attention
                : DASHBOARD_THEME.semantic.accents.detailPanel,
          }),
        )
      : null,
    footer,
    controls.menuFilter ? h(Controls, { ...browserPlan.filterProps, menuOverlayOnly: true }) : null,
  );
}
