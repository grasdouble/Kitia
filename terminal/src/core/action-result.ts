import type { CatalogResource } from "../catalog/entries.js";
import type { ScanError } from "../catalog/lifecycle.js";

export interface DashboardActionFailure {
  code: string;
  category?: string;
  paths?: string[];
  recoverable?: boolean;
  userMessage: string;
  agent?: string;
}
export interface DashboardActionResult {
  code: number;
  messages: string[];
  resources: CatalogResource[];
  errors: ScanError[];
  failure?: DashboardActionFailure;
  previewFiles?: Array<{ path: string; content: string }>;
  previewTree?: string[];
  previewAuditLines?: string[];
}
