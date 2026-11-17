import type { CatalogResource } from "../catalog/entries.js";
import type { ScanError } from "../catalog/lifecycle.js";
import type { CatalogFreshnessStatus } from "./catalog-freshness.mjs";

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

export type CatalogEntry = { kind: "skill" | "agent" | "instruction"; id?: string; path: string };
export type AddCatalogRequest = {
  name: string;
  repository: string;
  mode: "basic" | "custom";
  entries: CatalogEntry[];
};
export type UserCatalog = {
  name: string;
  repository: string;
  mode?: "basic" | "custom";
  entries?: CatalogEntry[];
};
export type CatalogFreshnessResult = { name: string; status: CatalogFreshnessStatus };
export type CatalogActionResult = {
  catalogs?: UserCatalog[];
  resources?: CatalogResource[];
  refreshed?: Array<{ name: string; count: number }>;
  failures?: Array<{ name: string; message: string }>;
  importSummary?: {
    added: string[];
    ignored: Array<{ name: string; reason: string }>;
    refreshed: Array<{ name: string; count: number }>;
    refreshFailures: Array<{ name: string; message: string }>;
  };
};
export type CatalogMutationResult = {
  catalog: string;
  count: number;
  catalogs?: UserCatalog[];
  resources?: CatalogResource[];
};

export type SourceVersionOption = { sha: string; prefix: string; date: string; subject: string };

export interface DashboardActions {
  catalogResources?: CatalogResource[];
  execute?: (
    operation: string,
    resource: CatalogResource,
    options: {
      scope?: string;
      tool?: string;
      force?: boolean;
      ref?: string;
      ghForce?: boolean;
      ghForceAgent?: string;
      onProgress?: (message: string) => void;
    },
  ) => Promise<DashboardActionResult>;
  listSourceVersions?: (resource: CatalogResource) => SourceVersionOption[] | Promise<SourceVersionOption[]>;
  addCatalog?: (request: AddCatalogRequest) => Promise<CatalogMutationResult>;
  updateCatalog?: (originalName: string, request: AddCatalogRequest) => Promise<CatalogMutationResult>;
  userCatalogs?: UserCatalog[];
  removeCatalog?: (name: string) => Promise<CatalogActionResult>;
  refreshCatalog?: (name?: string) => Promise<CatalogActionResult>;
  transferCatalogs?: (action: "import" | "export", content: string) => Promise<CatalogActionResult>;
  checkCatalogFreshness?: (names?: string[]) => Promise<CatalogFreshnessResult[]>;
  showOnboarding?: boolean;
}
