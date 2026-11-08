"use strict";

export type CatalogName = string;
export type ResourceKind = "skill" | "agent" | "instruction";

export interface ResourceIssue {
  code: string;
  paths?: string[];
}

export interface CatalogResource {
  id: string;
  kind: ResourceKind;
  catalog?: CatalogName;
  description?: string;
  owner?: string;
  category?: string;
  tags?: string[];
  status?: string;
  use_when?: string;
  example?: string;
  expected_output?: string;
  prerequisites?: string[];
  limitations?: string[];
  deprecation_reason?: string;
  replacement?: string;
  apply_to?: string[];
  applyTo?: string[];
  source_repository?: string;
  source_path?: string;
  source_ref?: string | null;
  license_status?: string;
  license_spdx?: string;
  scope?: string;
  bundle_id?: string;
  managed?: boolean;
  issues?: ResourceIssue[];
  paths?: string[];
  version?: string;
  removed?: boolean;
}
