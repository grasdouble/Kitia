const LOCK_PATH = ".agents/kitia-lock.json";

export interface FileFingerprint {
  sha256: string;
  executable: boolean;
}

export interface SourceResourceInventoryRecord {
  source_repository: string;
  source_path: string;
  source_ref?: string;
  apply_to?: string[];
  license_status?: string;
  files: Record<string, FileFingerprint>;
}

export interface InstallState {
  lock_version: number;
  catalog: string;
  sources: Record<string, Record<string, Record<string, SourceResourceInventoryRecord>>>;
}

module.exports = { LOCK_PATH };
