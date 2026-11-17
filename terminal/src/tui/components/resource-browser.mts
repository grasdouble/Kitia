"use strict";

import React from "react";
import type { CatalogResource } from "../../core/resources/model.js";
import { Controls } from "../controls.mjs";
import {
  dashboardActionButtonRows, dashboardControlsLayout, type ControlsProps,
} from "./controls/control-layout-plan.mjs";
import { DASHBOARD_HEADER_ROWS } from "../sections/header.mjs";
import { joinedWorkspaceLayout, type JoinedWorkspaceLayout } from "../layouts/joined-workspace.mjs";
import { InventorySummaryCards } from "./inventory-summary-cards.mjs";

const h = React.createElement;

export interface ResourceBrowserPlan {
  controlsState: ControlsProps;
  tabsProps: ControlsProps;
  filterProps: ControlsProps;
  tabsHeight: number;
  summaryRows: number;
  filterHeight: number;
  ultraCompactSummary: boolean;
  compactSummary: boolean;
  workspaceGap: number;
  workspaceHeight: number;
  outerWorkspaceWidth: number;
  actionRows: number;
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
  const controlsState = { ...controls, modalActive, actionPairs: true, hideActionHeading: true };
  const tabsProps = { ...controlsState, part: "tabs" as const, showSearch: false };
  const tabsLayout = dashboardControlsLayout(tabsProps);
  const ultraCompactSummary = rows < 40;
  const compactSummary = rows < 50 || columns < 76;
  const summaryRows = ultraCompactSummary ? 1 : 1 + (compactSummary ? 3 : 4);
  const filterProps = {
    ...controlsState,
    part: "filters" as const,
    layout: "toolbar" as const,
    rowOffset: tabsLayout.height + summaryRows,
  };
  const filterLayout = dashboardControlsLayout(filterProps);
  const workspaceGap = columns >= 45 && columns < 76 ? 0 : 1;
  const workspaceHeight = Math.max(1, rows - (
    DASHBOARD_HEADER_ROWS + tabsLayout.height + summaryRows + filterLayout.height + warningRows +
    workspaceGap + footerRows
  ));
  const stackedWorkspace = columns < 94;
  const outerWorkspaceWidth = columns - 2;
  const initialWorkspaceLayout = joinedWorkspaceLayout(
    outerWorkspaceWidth, workspaceHeight, stackedWorkspace, showDetails, 0, 0.76,
  );
  const initialDetailsWidth = initialWorkspaceLayout.detailsWidth
    ? initialWorkspaceLayout.detailsWidth - 1
    : initialWorkspaceLayout.innerWidth - 1;
  const actionRows = showDetails
    ? dashboardActionButtonRows(controlsState, Math.max(1, initialDetailsWidth))
    : 0;
  const workspaceLayout = joinedWorkspaceLayout(
    outerWorkspaceWidth, workspaceHeight, stackedWorkspace, showDetails, actionRows, 0.76,
  );
  return {
    controlsState,
    tabsProps,
    filterProps,
    tabsHeight: tabsLayout.height,
    summaryRows,
    filterHeight: filterLayout.height,
    ultraCompactSummary,
    compactSummary,
    workspaceGap,
    workspaceHeight,
    outerWorkspaceWidth,
    actionRows,
    workspaceLayout,
    listContentWidth: workspaceLayout.listWidth,
    detailsContentWidth: Math.max(1, workspaceLayout.detailsWidth
      ? workspaceLayout.detailsWidth - 1
      : workspaceLayout.innerWidth - 1),
  };
}

// ResourceBrowserChrome: tabs → inventory summary cards → filter controls (vertical).
export function ResourceBrowserChrome({ plan, resources, columns }: {
  plan: ResourceBrowserPlan;
  resources: CatalogResource[];
  columns: number;
}) {
  return h(React.Fragment, null,
    h(Controls, plan.tabsProps),
    h(InventorySummaryCards, {
      resources,
      width: columns - 2,
      compact: plan.compactSummary,
      ultraCompact: plan.ultraCompactSummary,
      marginTop: plan.ultraCompactSummary ? 0 : 1,
    }),
    h(Controls, plan.filterProps),
  );
}
