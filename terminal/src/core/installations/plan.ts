'use strict';

const { CatalogError } = require('../resources/model.js');
import type { FileFingerprint } from '../inventory/model.js';

export interface InstallPlanEntry {
  content: Buffer;
  executable: boolean;
  fingerprint?: FileFingerprint;
  expected?: FileFingerprint | null;
  mode?: number;
}

function addPlanEntry(
  plan: Map<string, InstallPlanEntry>,
  relativePath: string,
  content: Buffer,
  executable = false,
): void {
  const existing = plan.get(relativePath);
  if (existing && (!existing.content.equals(content) || existing.executable !== executable)) {
    throw new CatalogError(`Multiple resources generate different content for ${relativePath}`);
  }
  plan.set(relativePath, { content, executable });
}

module.exports = { addPlanEntry };
