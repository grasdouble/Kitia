import { useState } from "react";
import type { Key } from "ink";
import type { CatalogResource } from "../../../catalog/entries.js";
import type { DashboardActionResult } from "../../contracts.js";
import { inspectionPageCount } from "../../screens/inspection.mjs";

export function useInspection() {
  const [inspection, setInspection] = useState<{
    resource: CatalogResource;
    content: string;
    page: number;
    focus: "source" | "audit" | "tree";
    auditPage: number;
    treePage: number;
    localFiles?: Array<{ path: string; content: string }>;
    localTreeLines?: string[];
    localAuditLines?: string[];
  } | null>(null);
  const open = (resource: CatalogResource, result: DashboardActionResult) => {
    setInspection({
      resource,
      content: result.messages?.filter(Boolean).join("\n") || "Source content unavailable; no preview was returned.",
      page: 0, focus: "source", auditPage: 0, treePage: 0,
      ...(result.previewFiles ? { localFiles: result.previewFiles, localTreeLines: result.previewTree, localAuditLines: result.previewAuditLines } : {}),
    });
  };
  const handleInput = (input: string, key: Key, columns: number, rows: number) => {
    const character = input.toLocaleLowerCase();
    if (key.tab || character === "s" || character === "a" || character === "t") {
      setInspection((current) => {
        if (!current) return current;
        const panels = ["source", "audit", "tree"] as const;
        const focus = key.tab
          ? panels[(panels.indexOf(current.focus) + (key.shift ? 2 : 1)) % panels.length]
          : character === "a" ? "audit" : character === "t" ? "tree" : "source";
        return { ...current, focus };
      });
    } else if (key.leftArrow || key.pageUp || key.rightArrow || key.pageDown) {
      setInspection((current) => {
        if (!current) return current;
        const field = current.focus === "audit" ? "auditPage" : current.focus === "tree" ? "treePage" : "page";
        const pageCount = inspectionPageCount({ ...current, columns, rows });
        const delta = key.leftArrow || key.pageUp ? -1 : 1;
        return { ...current, [field]: Math.max(0, Math.min(pageCount - 1, current[field] + delta)) };
      });
    } else if (key.return || key.escape || input === " ") {
      setInspection(null);
    }
  };
  return { inspection, open, handleInput };
}
