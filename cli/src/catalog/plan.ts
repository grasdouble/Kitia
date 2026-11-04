export interface FileFingerprint {
  sha256: string;
  executable: boolean;
}

export interface InstallPlanEntry {
  content: Buffer;
  executable: boolean;
  expected?: FileFingerprint | null;
  mode?: number;
}
