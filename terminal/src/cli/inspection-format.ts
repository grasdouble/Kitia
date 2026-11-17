import type { AuditResult } from "../core/inspection/audit.js";
"use strict";

export function formatAuditLines(audit: AuditResult): string[] {
  const { coverage, findings } = audit;
  return [
    `Audit coverage: ${coverage.analyzed}/${coverage.discovered} files analyzed; ${coverage.complete ? "no files skipped." : "coverage incomplete."}`,
    ...coverage.skipped.map((item) => `  Skipped ${item.path}: ${item.reason}.`),
    ...findings.map((finding) => `  ${finding.severity.toUpperCase()} ${finding.path}:${finding.line} [${finding.code}] ${finding.message}`),
    ...(coverage.analyzed > 0 && !findings.length ? ["  No configured audit rules matched. This is not a safety guarantee."] : []),
    ...(!coverage.analyzed ? ["  No text files were analyzed; coverage is incomplete."] : []),
  ];
}
