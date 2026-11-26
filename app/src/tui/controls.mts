'use strict';

import { Box } from 'ink';
import React from 'react';

import { dashboardControlsLayout } from './components/controls/control-layout-plan.mjs';
import type { ControlsProps, LayoutItem } from './components/controls/control-layout-plan.mjs';
import { ControlLayout } from './components/controls/control-layout.mjs';
import type { DashboardMouseRegion } from './input-transport.mjs';
import { DASHBOARD_HEADER_ROWS } from './sections/header.mjs';

const h = React.createElement;

export function Controls(props: ControlsProps) {
  const layout = dashboardControlsLayout(props);
  const regions: DashboardMouseRegion[] = [];
  const mouseTop = (row: number) => DASHBOARD_HEADER_ROWS + (props.rowOffset || 0) + row + 1;
  const onRegion = (item: LayoutItem, x: number, top: number, bottom: number) => {
    if (props.modalActive) return;
    regions.push({
      left: x,
      right: Math.min(props.columns - 1, x + item.width - 1),
      top: mouseTop(top),
      bottom: mouseTop(bottom),
      target: item.target,
    });
  };
  const children = ControlLayout({ controls: props, layout, onRegion });
  React.useLayoutEffect(() => {
    if (!props.mouse) return;
    const owner = props.menuOverlayOnly ? 'filter-popover' : props.part ? `controls-${props.part}` : 'controls';
    props.mouse.replace(owner, regions);
    return () => props.mouse?.replace(owner, []);
  });
  if (props.menuOverlayOnly) {
    if (!layout.menu) return null;
    return h(
      Box,
      {
        position: 'absolute',
        top: DASHBOARD_HEADER_ROWS + (props.rowOffset || 0),
        left: 1,
        width: layout.width,
        height: layout.menu.top + layout.menu.count + 2,
        flexDirection: 'column',
        flexShrink: 0,
      },
      ...children,
    );
  }
  return h(
    Box,
    {
      flexDirection: 'column',
      width: layout.width,
      height: layout.height,
      position: 'relative',
      flexShrink: 0,
    },
    ...children,
  );
}
