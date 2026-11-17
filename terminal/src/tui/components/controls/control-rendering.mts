'use strict';

export function clipped(value: string, width: number) {
  if (width <= 0) return '';
  const chars = Array.from(value);
  return chars.length > width ? `${chars.slice(0, Math.max(0, width - 1)).join('')}…` : value;
}
