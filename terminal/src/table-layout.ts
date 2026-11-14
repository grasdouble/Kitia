"use strict";

export type ColumnWidthRule = {
  contentWidth: number;
  minWidth: number;
  maxWidth?: number;
  growWeight?: number;
  shrinkWeight?: number;
};

/** Fit aligned table columns to terminal cells without shrinking below readable minima. */
export function adaptiveColumnWidths(
  totalWidth: number,
  rules: ColumnWidthRule[],
  separatorWidth = 1,
): number[] {
  const available = Math.max(0, totalWidth - Math.max(0, rules.length - 1) * separatorWidth);
  const widths = rules.map((rule) => Math.max(rule.minWidth, rule.contentWidth));
  const growthLimits = rules.map((rule, index) =>
    Math.max(widths[index], Math.min(available, rule.maxWidth ?? available)));
  let current = widths.reduce((sum, width) => sum + width, 0);

  if (current < available) {
    let remaining = available - current;
    while (remaining > 0) {
      const weight = rules.reduce((sum, rule, index) =>
        sum + (widths[index] < growthLimits[index] ? rule.growWeight || 0 : 0), 0);
      if (!weight) break;
      let distributed = 0;
      for (let index = 0; index < rules.length && remaining > 0; index += 1) {
        const ruleWeight = widths[index] < growthLimits[index] ? rules[index].growWeight || 0 : 0;
        if (!ruleWeight) continue;
        const share = Math.max(1, Math.floor(remaining * ruleWeight / weight));
        const amount = Math.min(share, growthLimits[index] - widths[index], remaining);
        widths[index] += amount;
        remaining -= amount;
        distributed += amount;
      }
      if (!distributed) break;
    }
  } else if (current > available) {
    let deficit = current - available;
    while (deficit > 0) {
      const weight = rules.reduce((sum, rule, index) =>
        sum + (widths[index] > rule.minWidth ? rule.shrinkWeight ?? 1 : 0), 0);
      if (!weight) break;
      let reduced = 0;
      for (let index = 0; index < rules.length && deficit > 0; index += 1) {
        const rule = rules[index];
        const ruleWeight = widths[index] > rule.minWidth ? rule.shrinkWeight ?? 1 : 0;
        if (!ruleWeight) continue;
        const share = Math.max(1, Math.floor(deficit * ruleWeight / weight));
        const amount = Math.min(share, widths[index] - rule.minWidth, deficit);
        widths[index] -= amount;
        deficit -= amount;
        reduced += amount;
      }
      if (!reduced) break;
    }
  }
  return widths;
}
