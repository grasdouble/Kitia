import type { FileFingerprint, InstallState, SourceResourceInventoryRecord } from '../model.js';

const fingerprint: FileFingerprint = { sha256: 'abc123', executable: false };
const resource: SourceResourceInventoryRecord = {
  source_repository: 'https://github.com/example/resources',
  source_path: 'skills/example',
  files: { 'SKILL.md': fingerprint },
};
const state: InstallState = {
  lock_version: 1,
  catalog: 'team',
  sources: { team: { skill: { example: resource } } },
};

// @ts-expect-error Fingerprints require executable state.
const missingExecutable: FileFingerprint = { sha256: 'abc123' };
// @ts-expect-error Resource records require their source repository.
const missingRepository: SourceResourceInventoryRecord = { source_path: 'skills/example', files: {} };
// @ts-expect-error Installed resources are grouped by catalog, kind, and id.
const invalidSources: InstallState = { lock_version: 1, catalog: 'team', sources: { team: [resource] } };

void [state, missingExecutable, missingRepository, invalidSources];
