import type { FileFingerprint } from '../inventory/model.js';
import type { ResourceKind } from '../resources/model.js';

const SOURCE_SKILL_DIRECTORIES = {
  'github-copilot': '.agents/skills',
  'claude-code': '.claude/skills',
};

export type InstallationTool = 'claude' | 'copilot' | 'both';

export type InstallationScope = 'project' | 'user';

export interface PlanAction {
  action: 'install' | 'overwrite' | 'unchanged' | 'remove' | 'forget' | 'delegate_install';
  path: string | null;
  resource?: { catalog: string; kind: ResourceKind; id: string } | null;
  command?: { program: string; args: string[] };
}

export interface InstallPlanOptions {
  force?: boolean;
  dryRun?: boolean;
  remove?: string[];
  expectedRemovals?: Map<string, FileFingerprint | null>;
  onAction?: (action: PlanAction) => void;
}

export { SOURCE_SKILL_DIRECTORIES };
