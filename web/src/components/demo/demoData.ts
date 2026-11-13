export type Kind = 'skill' | 'agent' | 'instruction';
export type Scope = 'project' | 'user';
export type DemoCatalog = { name: string; repository: string; refreshedAt?: string };
export type DemoResource = {
  id: string;
  kind: Kind;
  catalog: string;
  description: string;
  license: string;
  content: string;
};
export type Installation = { resource: DemoResource; scope: Scope; revision: string };

export const revisions = [
  { sha: 'c8e4a21', label: 'Improve examples and review guidance' },
  { sha: 'a3d7f09', label: 'Add workspace conventions' },
  { sha: '7b2c610', label: 'Initial resource' },
];

export const initialCatalogs: DemoCatalog[] = [
  { name: 'toolkit', repository: 'demo/toolkit' },
  { name: 'team', repository: 'demo/team' },
];

export const resources: DemoResource[] = [
  { id: 'code-review', kind: 'skill', catalog: 'toolkit', license: 'MIT', description: 'Review changes for correctness, security, and maintainability.', content: '---\nname: code-review\ndescription: Review changes with a consistent checklist.\n---\n\n# Code review\n\n1. Read the diff and the surrounding code.\n2. Check correctness, security, and edge cases.\n3. Report actionable findings with file references.\n' },
  { id: 'testing', kind: 'skill', catalog: 'toolkit', license: 'MIT', description: 'Design focused, deterministic tests for consumer-visible behavior.', content: '---\nname: testing\ndescription: Design focused regression tests.\n---\n\n# Testing\n\nUse isolated fixtures and deterministic inputs.\nAssert public behavior rather than implementation details.\n' },
  { id: 'release-notes', kind: 'skill', catalog: 'team', license: 'Apache-2.0', description: 'Write concise release notes describing user-facing changes.', content: '---\nname: release-notes\ndescription: Explain the impact of a release.\n---\n\n# Release notes\n\nGroup changes by user-facing outcome.\nInclude migration steps for breaking changes.\n' },
  { id: 'reviewer', kind: 'agent', catalog: 'toolkit', license: 'MIT', description: 'A dedicated reviewer for evidence-backed code feedback.', content: '---\nname: reviewer\ndescription: Review code without changing it.\n---\n\nRead the changed code and its callers.\nPrioritize correctness and security findings.\nExplain each finding with concrete evidence.\n' },
  { id: 'planner', kind: 'agent', catalog: 'team', license: 'Apache-2.0', description: 'Turn a feature request into a small, verifiable implementation plan.', content: '---\nname: planner\ndescription: Plan small, verifiable changes.\n---\n\nInspect existing patterns before proposing changes.\nIdentify dependencies and observable acceptance criteria.\n' },
  { id: 'typescript', kind: 'instruction', catalog: 'toolkit', license: 'MIT', description: 'Shared TypeScript conventions for your project.', content: '---\napplyTo: "**/*.ts,**/*.tsx"\n---\n\n# TypeScript conventions\n\nPrefer explicit types at public boundaries.\nHandle missing values before accessing properties.\nKeep side effects at the edges of the application.\n' },
  { id: 'documentation', kind: 'instruction', catalog: 'team', license: 'Apache-2.0', description: 'Keep project documentation clear, current, and example-driven.', content: '---\napplyTo: "**/*.md"\n---\n\n# Documentation\n\nUse concrete examples and describe observable behavior.\nKeep commands aligned with the current public interface.\n' },
];

export function resourceKey(resource: DemoResource) {
  return `${resource.catalog}:${resource.kind}:${resource.id}`;
}

export function sourcePath(resource: DemoResource) {
  if (resource.kind === 'skill') return `skills/${resource.id}/SKILL.md`;
  return `${resource.kind}s/${resource.id}.md`;
}

export function installedPath(resource: DemoResource, scope: Scope) {
  const prefix = scope === 'user' ? '~/' : './';
  if (resource.kind === 'skill') return `${prefix}.agents/skills/${resource.id}/SKILL.md`;
  if (resource.kind === 'agent') return `${prefix}.copilot/agents/${resource.id}.agent.md`;
  return `./.github/instructions/${resource.id}.instructions.md`;
}

export function initialInstallations(): Installation[] {
  return [
    { resource: resources[0], scope: 'project', revision: revisions[1].sha },
    { resource: resources[3], scope: 'user', revision: revisions[0].sha },
    { resource: resources[5], scope: 'project', revision: revisions[0].sha },
  ];
}
