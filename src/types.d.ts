export type SourceResourceKind = "skill" | "agent" | "instruction";
export interface SourceResourceMapping {
  kind: SourceResourceKind;
  id?: string;
  path: string;
}
export interface SourceCatalogConfiguration {
  mode: "basic" | "custom";
  entries: SourceResourceMapping[];
}
export interface IndexedSourceCatalog {
  catalog_version: 1;
  catalog_name: string;
  source_repository: string;
  source_ref: string;
  resources: Array<{ id: string; kind: SourceResourceKind; source_path: string; description: string; license_status: string; apply_to?: string[] }>;
}
export type AddCatalog = (
  name: string,
  repository: string,
  configuration?: SourceCatalogConfiguration,
) => IndexedSourceCatalog;
export interface AddCatalogRequest {
  name: string;
  repository: string;
  mode: "basic" | "custom";
  entries: SourceResourceMapping[];
}
export interface AddCatalogResult {
  catalog: string;
  count: number;
}
export type CatalogName = string;
export type ResourceKind = "skill" | "agent" | "instruction" | "mcp" | "bundle";
export type ClientTool = "claude" | "copilot" | "both";
export type JsonRecord = Record<string, any>;

export interface ResourceIssue {
  code: string;
  paths?: string[];
}

export interface BundleMember {
  catalog: string;
  kind: ResourceKind;
  id: string;
}

export interface McpInput {
  type: string;
  required?: boolean;
  secret?: boolean;
  target_env: string;
  default?: unknown;
  description?: string;
  [key: string]: any;
}

export interface McpServer {
  command?: string;
  args?: string[];
  type?: string;
  url?: string;
  env?: Record<string, string>;
  [key: string]: any;
}

export interface CatalogResource {
  id: string;
  kind: ResourceKind;
  scope?: string;
  description?: string;
  catalog?: CatalogName;
  group?: string;
  status?: string;
  license_status?: string;
  compatibility?: Record<string, { status?: string }>;
  issues?: ResourceIssue[];
  resources?: BundleMember[];
  inputs?: Record<string, McpInput>;
  mcp_config?: { mcpServers: Record<string, McpServer> };
  managed?: boolean;
  [key: string]: any;
}

export interface InstallState {
  lock_version: number;
  resources: Record<string, JsonRecord>;
  bundles?: Record<string, JsonRecord>;
  mcps?: Record<string, JsonRecord>;
  sources?: Record<string, Record<string, Record<string, JsonRecord>>>;
  [key: string]: any;
}

export interface McpConfiguration {
  managed?: boolean;
  sha256?: string;
  [key: string]: any;
}

export interface McpFileConfig {
  data: JsonRecord;
  fingerprint: JsonRecord | null;
  mode: number;
  changed?: boolean;
}

export interface CliOptions {
  command?: string;
  action?: string;
  target?: string;
  catalog?: string;
  kind?: string;
  id?: string;
  scope?: string;
  tool?: string;
  nonInteractive?: boolean;
  [key: string]: any;
}

export interface Keypress {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

export type TerminalInput = NodeJS.ReadStream & { isRaw?: boolean };
export type TerminalOutput = NodeJS.WriteStream;

export interface ScanError {
  scope: string;
  code: string;
  message: string;
}

export interface PlanAction {
  action: string;
  path: string;
  resource?: JsonRecord | null;
  command?: { program: string; args: string[] };
}

export interface InstallPlanOptions {
  force?: boolean;
  dryRun?: boolean;
  remove?: string[];
  expectedRemovals?: Map<string, JsonRecord | null>;
  onAction?: (action: PlanAction) => void;
  [key: string]: any;
}

export interface SourceResourceInstallation {
  agent: string;
  path: string;
  ref: string | null;
  missing: boolean;
  modified: boolean;
  provenanceMatches: boolean;
}

export interface InstalledSourceResource {
  resource: CatalogResource;
  installations: SourceResourceInstallation[];
  removed: boolean;
  tracked?: boolean;
}

export interface DashboardActionResult {
  code: number;
  messages?: string[];
  resources?: CatalogResource[];
  errors?: ScanError[];
  postInstallEnvironment?: string[];
}

export interface PendingDashboardAction {
  action: "install" | "update" | "uninstall" | "remove-unmanaged";
  resource: CatalogResource;
  scope?: string;
  tool?: string;
}
