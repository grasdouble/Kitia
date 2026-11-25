import type { ResourceKind } from '../resources/model.js';
import { CatalogError } from '../resources/model.js';
import type { InstallationScope } from './model.js';

type Locations = Partial<Record<InstallationScope, string>> & {
  suffix?: string;
  instructionScope?: 'applyTo' | 'paths';
};
interface DestinationDefinition {
  label: string;
  locations: Partial<Record<ResourceKind, Locations>>;
}

const destinations = {
  standard: {
    label: 'Standard',
    locations: { skill: { project: '.agents/skills', user: '.agents/skills' } },
  },
  copilot: {
    label: 'GitHub Copilot',
    locations: {
      skill: { project: '.github/skills', user: '.copilot/skills' },
      agent: { project: '.github/agents', user: '.copilot/agents', suffix: '.agent.md' },
      instruction: { project: '.github/instructions', suffix: '.instructions.md', instructionScope: 'applyTo' },
    },
  },
  claude: {
    label: 'Claude Code',
    locations: {
      skill: { project: '.claude/skills', user: '.claude/skills' },
      agent: { project: '.claude/agents', user: '.claude/agents' },
      instruction: { project: '.claude/rules', instructionScope: 'paths' },
    },
  },
  mistral: {
    label: 'Mistral Vibe',
    locations: { skill: { project: '.vibe/skills', user: '.vibe/skills' } },
  },
} satisfies Record<string, DestinationDefinition>;

export type InstallationDestination = keyof typeof destinations;
export const installationDestinationIds: readonly InstallationDestination[] = Object.keys(
  destinations,
) as InstallationDestination[];
export const installationScopes = ['user', 'project'] as const satisfies readonly InstallationScope[];

export interface InstallationLayout {
  id: InstallationDestination;
  label: string;
  directory: string;
  suffix: string;
  instructionScope?: Locations['instructionScope'];
}

const defaults: Record<ResourceKind, InstallationDestination> = {
  skill: 'standard',
  agent: 'copilot',
  instruction: 'copilot',
};

export function isInstallationDestination(value: string): value is InstallationDestination {
  return Object.hasOwn(destinations, value);
}

export function availableInstallationDestinations(kind: ResourceKind, scope?: InstallationScope): InstallationLayout[] {
  const layouts: InstallationLayout[] = [];
  for (const id of installationDestinationIds) {
    const { label, locations }: DestinationDefinition = destinations[id];
    const location = locations[kind];
    if (!location) continue;
    const { project, user, suffix = kind === 'skill' ? '/SKILL.md' : '.md', instructionScope } = location;
    const directories = scope ? [location[scope]] : project === user ? [project] : [project, user];
    for (const directory of directories) {
      if (directory) layouts.push({ id, label, directory, suffix, instructionScope });
    }
  }
  return layouts;
}

export function resolveInstallationDestinations(
  kind: ResourceKind,
  scope: InstallationScope,
  requested: readonly InstallationDestination[] = [defaults[kind]],
): InstallationLayout[] {
  const available = availableInstallationDestinations(kind, scope);
  if (!available.length) {
    throw new CatalogError(
      kind === 'instruction' && scope === 'user'
        ? '--scope user supports source skills and agents; instructions are project-only'
        : `No installation destinations for ${kind}s in ${scope} scope.`,
      'INVALID_ARGUMENT',
    );
  }
  if (!requested.length) throw new CatalogError('Select at least one installation destination.', 'INVALID_ARGUMENT');
  return [...new Set(requested)].map((id) => {
    const layout = available.find((entry) => entry.id === id);
    if (!layout) {
      throw new CatalogError(
        `Destination '${id}' does not support ${kind}s in ${scope} scope. Choose ${available.map((entry) => entry.id).join(' or ')}.`,
        'INVALID_ARGUMENT',
      );
    }
    return layout;
  });
}

export function installationPath(layout: InstallationLayout, resourceId: string): string {
  return `${layout.directory}/${resourceId}${layout.suffix}`;
}
