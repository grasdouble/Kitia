import type { FileFingerprint } from "./plan.js";

const LOCK_PATH = ".agents/kitia-lock.json";

const INSTALL_SCAN_DIRECTORIES = {
  claude: [".claude/skills", ".claude/agents", ".claude/rules"],
  copilot: [".agents/skills", ".agents/agents", ".agents/instructions", ".github/agents", ".github/instructions"],
};

const USER_INSTALL_SCAN_DIRECTORIES = {
  claude: [".claude/skills", ".claude/agents"],
  copilot: [".agents/skills", ".copilot/agents"],
};

const SOURCE_SKILL_DIRECTORIES = {
  "github-copilot": ".agents/skills",
  "claude-code": ".claude/skills",
};




export type InstallationTool = "claude" | "copilot" | "both";

export type InventoryScope = "project" | "user";

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

export interface PlanAction {
  action: string;
  path: string | null;
  resource?: { catalog: string; kind: string; id: string } | null;
  command?: { program: string; args: string[] };
}

export interface InstallPlanOptions {
  force?: boolean;
  dryRun?: boolean;
  remove?: string[];
  expectedRemovals?: Map<string, FileFingerprint | null>;
  onAction?: (action: PlanAction) => void;
}

module.exports = { LOCK_PATH, INSTALL_SCAN_DIRECTORIES, USER_INSTALL_SCAN_DIRECTORIES, SOURCE_SKILL_DIRECTORIES };
