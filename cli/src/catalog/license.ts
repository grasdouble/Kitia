"use strict";

const parseExpression = require("spdx-expression-parse");

type SpdxNode = {
  license?: string;
  left?: SpdxNode;
  right?: SpdxNode;
  conjunction?: string;
  exception?: string;
  plus?: boolean;
};

function parsedSpdxExpression(value: unknown): SpdxNode | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    return parseExpression(value.trim());
  } catch {
    return undefined;
  }
}

function spdxExpression(value: unknown): string | undefined {
  return parsedSpdxExpression(value) ? (value as string).trim().replace(/\s+/g, " ") : undefined;
}

function matchesLicense(resource: { license_status?: string; license_spdx?: string }, filter: string): boolean {
  const filterExpression = parsedSpdxExpression(filter);
  if (filterExpression && filterExpression.license &&
      Object.keys(filterExpression).length === 1) {
    const resourceExpression = parsedSpdxExpression(resource.license_spdx);
    if (!resourceExpression) return false;
    const containsIdentifier = (node: SpdxNode): boolean =>
      node.license === filterExpression.license ||
      Boolean(node.left && containsIdentifier(node.left)) ||
      Boolean(node.right && containsIdentifier(node.right));
    return containsIdentifier(resourceExpression);
  }
  if (filterExpression) return resource.license_spdx === filter.trim();
  return resource.license_status === filter.trim();
}

module.exports = { spdxExpression, matchesLicense };
