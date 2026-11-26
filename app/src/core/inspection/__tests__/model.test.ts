import type { ResourceInspection, PreviewFile, PreviewTreeEntry } from '../model.js';

const file: PreviewFile = { path: 'SKILL.md', content: '# Example' };
const treeEntry: PreviewTreeEntry = { path: 'SKILL.md', type: 'file' };
const inspection: ResourceInspection = {
  files: [file],
  treeEntries: [treeEntry],
  audit: { findings: [], coverage: { discovered: 1, analyzed: 1, skipped: [], complete: true } },
};

// @ts-expect-error Preview files require source content.
const missingContent: PreviewFile = { path: 'SKILL.md' };
// @ts-expect-error Tree entries use only file or directory.
const invalidTreeEntry: PreviewTreeEntry = { path: 'SKILL.md', type: 'symlink' };
// @ts-expect-error Inspection requires an audit result.
const missingAudit: ResourceInspection = { files: [file], treeEntries: [treeEntry] };

void [inspection, missingContent, invalidTreeEntry, missingAudit];
