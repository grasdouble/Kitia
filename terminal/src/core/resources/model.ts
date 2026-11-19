'use strict';

export type CatalogName = string;
export type ResourceKind = 'skill' | 'agent' | 'instruction';

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
  managed?: boolean;
  issues?: ResourceIssue[];
  paths?: string[];
  version?: string;
  removed?: boolean;
}

const INSTALLABLE_KINDS = new Set(['skill', 'agent', 'instruction']);

const USER_INSTALLABLE_KINDS = new Set(['skill', 'agent']);

const TOOLS = new Set(['claude', 'copilot', 'both']);

const RESOURCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

class CatalogError extends Error {
  code: string;
  category?: string;
  paths?: string[];
  recoverable?: boolean;
  userMessage?: string;
  technicalDetail?: string;
  agent?: string;

  constructor(
    message: string,
    code = 'CATALOG_ERROR',
    details: {
      category?: string;
      paths?: string[];
      recoverable?: boolean;
      userMessage?: string;
      technicalDetail?: string;
      agent?: string;
    } = {},
  ) {
    super(message);
    this.code = code;
    this.category = details.category;
    this.paths = details.paths ? [...details.paths] : undefined;
    this.recoverable = details.recoverable || false;
    this.userMessage = details.userMessage;
    this.technicalDetail = details.technicalDetail;
    this.agent = details.agent;
  }
}

function rejectUnsupportedVersion(version: unknown, supported: number, label: string, code: string): void {
  if (typeof version === 'number' && Number.isSafeInteger(version) && version > 0 && version !== supported) {
    throw new CatalogError(
      `${label} version ${version} is not supported by this CLI (supported: ${supported}). Use a compatible CLI version; do not rewrite or delete the data to change its version.`,
      code,
    );
  }
}

export { CatalogError, INSTALLABLE_KINDS, USER_INSTALLABLE_KINDS, TOOLS, RESOURCE_ID, rejectUnsupportedVersion };
