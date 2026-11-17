import type { CatalogResource } from "../../../catalog/entries.js";

export interface PendingDashboardAction {
  action: "install" | "update" | "uninstall" | "remove-unmanaged" | "preview";
  resource: CatalogResource;
  scope?: string;
  tool?: string;
  ref?: string;
  forceRetry?: boolean;
  ghForceRetry?: boolean;
  ghForceAgent?: string;
  ghForceAgents?: string[];
  conflict?: { category: string; paths: string[]; message?: string };
}
