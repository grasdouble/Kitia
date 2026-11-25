import { execFile } from 'node:child_process';

import {
  runResourceAction,
  type ResourceAction,
  type ResourceActionOptions,
  type ResourceActionResult,
} from '../application/resource-actions.js';
import type { InstallationTargets } from '../application/snapshot.js';
import { formatAuditLines } from '../cli/inspection-format.js';
import type { CatalogResource } from '../core/resources/model.js';
import type { DashboardActionResult } from './action-result.js';
import { formatPreviewTree } from './preview-tree.js';

export function presentResourceAction(result: ResourceActionResult): DashboardActionResult {
  const { code, messages, resources, errors, failure, inspection } = result;
  const output: DashboardActionResult = {
    code,
    messages: messages.flatMap((message) => (typeof message === 'string' ? [message] : formatAuditLines(message))),
    resources,
    errors,
  };
  if (failure) {
    const { audit, ...details } = failure;
    output.failure = audit ? { ...details, auditLines: formatAuditLines(audit) } : details;
  }
  if (inspection) {
    const { files, root, treeEntries, audit, origin } = inspection;
    output.previewFiles = files;
    output.previewTree =
      origin === 'local'
        ? [`${root}/`, ...treeEntries.map(({ path }, i) => `${i === treeEntries.length - 1 ? '└──' : '├──'} ${path}`)]
        : formatPreviewTree(root, treeEntries);
    if (audit) output.previewAuditLines = formatAuditLines(audit);
  }
  return output;
}

export function createDashboardActionHandler(onProgress?: (message: string) => void) {
  return async (
    action: ResourceAction,
    resource: CatalogResource,
    targets: InstallationTargets,
    options?: ResourceActionOptions,
  ) => presentResourceAction(await runResourceAction(action, resource, targets, options, onProgress));
}
async function copyTextToClipboard(text: string): Promise<void> {
  const commands: [string, string[]][] =
    process.platform === 'darwin'
      ? [['pbcopy', []]]
      : process.platform === 'win32'
        ? [['clip', []]]
        : [
            ['wl-copy', []],
            ['xclip', ['-selection', 'clipboard']],
          ];
  for (const [program, args] of commands) {
    try {
      await new Promise<void>((resolve, reject) => {
        const child = execFile(program, args, (error) => (error ? reject(error) : resolve()));
        child.stdin?.on('error', reject);
        child.stdin?.end(text);
      });
      return;
    } catch (error) {
      if (process.platform === 'darwin' || process.platform === 'win32') throw error;
    }
  }
  throw new Error('Clipboard access requires wl-copy or xclip on Linux.');
}

export { copyTextToClipboard };
