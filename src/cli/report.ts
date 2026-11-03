import type { ResourceIssue } from "../catalog/entries.js";

export interface CliReportIdentity {
  catalog?: string;
  kind: string;
  id: string;
}

export interface CliReportResource extends CliReportIdentity {
  status?: string;
  issues?: ResourceIssue[];
  unsupported_runtimes?: string[];
}

export interface CliReportAction {
  action: string;
  path: string | null;
  resource: CliReportIdentity | null;
  command?: { program: string; args: string[] };
}

export interface CliReportDiagnostic {
  code: string;
  message: string;
  catalog?: string;
}

export interface CliReportCheck {
  id: string;
  status: "ok" | "warning" | "error" | "skipped";
  message: string;
}

export interface CliReport {
  schema_version: number;
  command: string;
  dry_run: boolean;
  scope?: string;
  target?: string;
  status: "ok" | "attention" | "error";
  resources: CliReportResource[];
  actions: CliReportAction[];
  warnings: CliReportDiagnostic[];
  messages: string[];
  errors: CliReportDiagnostic[];
  checks?: CliReportCheck[];
}
