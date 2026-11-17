import type { FileFingerprint } from "../inventory/model.js";

const SOURCE_SKILL_DIRECTORIES = {
  "github-copilot": ".agents/skills",
  "claude-code": ".claude/skills",
};

export type InstallationTool = "claude" | "copilot" | "both";

export type InstallationScope = "project" | "user";


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

module.exports = { SOURCE_SKILL_DIRECTORIES };
