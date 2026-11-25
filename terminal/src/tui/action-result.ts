import type { ScanError } from '../core/inventory/checks.js';
import type { CatalogResource } from '../core/resources/model.js';
export interface DashboardActionFailure {
  code: string;
  category?: string;
  paths?: string[];
  recoverable?: boolean;
  userMessage: string;
  agent?: string;
  auditLines?: string[];
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
