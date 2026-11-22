'use strict';

import React from 'react';

import type { CatalogResource } from '../../core/resources/model.js';
import { Controls } from '../controls.mjs';
import { joinedWorkspaceLayout, type JoinedWorkspaceLayout } from '../layouts/joined-workspace.mjs';
import { DASHBOARD_HEADER_ROWS } from '../sections/header.mjs';
import { ActionButtons } from './button/button-layout.mjs';
import {
  dashboardActionButtonRows,
  dashboardControlsLayout,
  type ControlsProps,
} from './controls/control-layout-plan.mjs';
import { InventorySummaryCards } from './inventory-summary-cards.mjs';

const h = React.createElement;

// Outer border, list title/rule/table header, and one resource row.
const minimumWorkspaceHeight = 2 + 3 + 1;

export interface ResourceBrowserPlan {
  controlsState: ControlsProps;
  tabsProps: ControlsProps;
  filterProps: ControlsProps;
  tabsHeight: number;
  summaryRows: number;
  ultraCompactSummary: boolean;
  compactSummary: boolean;
  workspaceGap: number;
  workspaceHeight: number;
  workspaceTop: number;
  showWorkspaceDetails: boolean;
  showShortcutFooter: boolean;
  outerWorkspaceWidth: number;
  actionRows: number;
  toolbarActions?: ControlsProps;
  workspaceLayout: JoinedWorkspaceLayout;
  listContentWidth: number;
  detailsContentWidth: number;
}

export function resourceBrowserPlan({
  controls,
  modalActive,
  columns,
  rows,
  warningRows,
  footerRows,
  showDetails,
}: {
  controls: ControlsProps;
  modalActive: boolean;
  columns: number;
  rows: number;
  /** Inventory scan warnings reserve their actual rendered height; Browse passes zero. */
  warningRows: number;
  footerRows: number;
  showDetails: boolean;
}): ResourceBrowserPlan {
  let controlsState = { ...controls, modalActive, actionPairs: true, hideActionHeading: true };
  const tabsProps = { ...controlsState, part: 'tabs' as const, showSearch: false };
  const tabsLayout = dashboardControlsLayout(tabsProps);
  const ultraCompactSummary = rows < 40;
  const compactSummary = rows < 50 || columns < 76;
  const summaryRows = ultraCompactSummary ? 1 : 1 + (compactSummary ? 3 : 4);
  const filterProps = {
    ...controlsState,
    part: 'filters' as const,
    layout: 'toolbar' as const,
    rowOffset: tabsLayout.height + summaryRows,
  };
  const filterLayout = dashboardControlsLayout(filterProps);
  const workspaceGap = columns >= 45 && columns < 76 ? 0 : 1;
  const chromeRows = DASHBOARD_HEADER_ROWS + tabsLayout.height + summaryRows + filterLayout.height;
  const availableWorkspaceHeight = rows - chromeRows - warningRows - workspaceGap;
  let workspaceHeight = Math.max(1, availableWorkspaceHeight - footerRows);
  const stackedWorkspace = columns < 94;
  const outerWorkspaceWidth = columns - 2;
  const layoutWorkspace = (details: boolean, actionRows = 0) =>
    joinedWorkspaceLayout(outerWorkspaceWidth, workspaceHeight, stackedWorkspace, details, actionRows);
  let workspaceLayout = layoutWorkspace(showDetails);
  const detailsContentWidth = Math.max(1, (workspaceLayout.detailsWidth || workspaceLayout.innerWidth) - 1);
  let actionRows = showDetails ? dashboardActionButtonRows(controlsState, detailsContentWidth) : 0;
  let toolbarActions: ControlsProps | undefined;
  let toolbarActionRows = 0;
  let showShortcutFooter = true;
  if (actionRows) {
    workspaceLayout = layoutWorkspace(true, actionRows);
    if (actionRows > workspaceLayout.detailsRows || workspaceHeight < minimumWorkspaceHeight) {
      controlsState = { ...controlsState, compactActions: true };
      actionRows = dashboardActionButtonRows(controlsState, detailsContentWidth);
      workspaceLayout = layoutWorkspace(true, actionRows);
      if (actionRows > workspaceLayout.detailsRows || workspaceHeight < minimumWorkspaceHeight) {
        // A short stacked pane may not have any body rows. Keep its actions on
        // the full-width resource toolbar instead, with their own height budget.
        toolbarActions = { ...controlsState, actionPairs: false };
        toolbarActionRows = dashboardActionButtonRows(toolbarActions, outerWorkspaceWidth);
        workspaceHeight = availableWorkspaceHeight - footerRows - toolbarActionRows;
        if (workspaceHeight < minimumWorkspaceHeight && footerRows) {
          workspaceHeight += footerRows;
          showShortcutFooter = false;
        }
        if (workspaceHeight < minimumWorkspaceHeight) workspaceHeight = 0;
        actionRows = 0;
        workspaceLayout = layoutWorkspace(true);
      }
    }
  }
  const showWorkspaceDetails = showDetails && (!stackedWorkspace || workspaceLayout.detailsRows > 0);
  if (showDetails && !showWorkspaceDetails) workspaceLayout = layoutWorkspace(false);
  return {
    controlsState,
    tabsProps,
    filterProps,
    tabsHeight: tabsLayout.height,
    summaryRows,
    ultraCompactSummary,
    compactSummary,
    workspaceGap,
    workspaceHeight,
    workspaceTop: chromeRows + toolbarActionRows + warningRows + workspaceGap + 1,
    showWorkspaceDetails,
    showShortcutFooter,
    outerWorkspaceWidth,
    actionRows,
    toolbarActions,
    workspaceLayout,
    listContentWidth: workspaceLayout.listWidth,
    detailsContentWidth,
  };
}

// ResourceBrowserChrome: tabs → inventory summary → filters → optional compact actions.
export function ResourceBrowserChrome({
  plan,
  resources,
  columns,
}: {
  plan: ResourceBrowserPlan;
  resources: CatalogResource[];
  columns: number;
}) {
  return h(
    React.Fragment,
    null,
    h(Controls, plan.tabsProps),
    h(InventorySummaryCards, {
      resources,
      width: columns - 2,
      compact: plan.compactSummary,
      ultraCompact: plan.ultraCompactSummary,
      marginTop: plan.ultraCompactSummary ? 0 : 1,
    }),
    h(Controls, plan.filterProps),
    plan.toolbarActions ? ActionButtons({ controls: plan.toolbarActions, width: columns - 2 }) : null,
  );
}
