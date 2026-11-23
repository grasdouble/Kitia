import type { AuditResult } from './audit.js';

export interface PreviewFile {
  path: string;
  content: string;
}

export interface PreviewTreeEntry {
  path: string;
  type: 'file' | 'directory';
}

export interface ResourceInspection {
  files: PreviewFile[];
  treeEntries: PreviewTreeEntry[];
  audit: AuditResult;
}
