"use strict";

import React, { type ReactNode } from "react";
import { Box } from "ink";

const h = React.createElement;

// ScreenFrame: fixed columns × rows, column-stacked children stretched to frame width.
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
