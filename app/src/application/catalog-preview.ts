import type { AuditResult } from '../core/inspection/audit.js';
import type { PreviewFile, PreviewTreeEntry } from '../core/inspection/model.js';
import { decodeSourcePreview } from '../core/inspection/source-preview.js';
import { runSourceOperation } from '../core/installations/lifecycle.js';
import { CatalogError, type CatalogResource, type ResourceKind } from '../core/resources/model.js';
import { readCatalogSnapshot } from './snapshot.js';

export type CatalogResourceSelector = { catalog: string; kind: ResourceKind; id: string; ref: string };

export type SourceInspection = {
  origin: 'source';
  root: string;
  files: PreviewFile[];
  treeEntries: PreviewTreeEntry[];
  audit?: AuditResult;
};

export function resolvePinnedCatalogResource(
  selector: CatalogResourceSelector,
  resources = readCatalogSnapshot().resources,
): CatalogResource {
  const resource = resources.find(
    ({ catalog, kind, id }) => catalog === selector.catalog && kind === selector.kind && id === selector.id,
  );
  if (!resource) throw new CatalogError('This resource is no longer available in the catalog.', 'RESOURCE_NOT_FOUND');
  if (!resource.source_repository || !resource.source_path || resource.source_ref !== selector.ref)
    throw new CatalogError(
      'The source pin has changed. Reopen Browse resources to load the latest catalog.',
      'STALE_SOURCE',
    );
  return resource;
}

export async function inspectPinnedSource(
  resource: CatalogResource,
  target: string,
): Promise<{
  code: number;
  messages: string[];
  inspection?: SourceInspection;
}> {
  let audit: AuditResult | undefined;
  const result = await runSourceOperation({
    action: 'preview',
    resource,
    target,
    audit: true,
    nonInteractive: true,
    captureOutput: true,
    onAudit: (report) => {
      audit = report;
    },
  });
  if (result.status !== 0) return { code: result.status, messages: result.messages.map(({ text }) => text) };
  const content = result.preview ?? result.messages.find(({ level }) => level === 'log')?.text ?? '';
  return { code: 0, messages: [], inspection: { ...decodeSourcePreview(resource, content), origin: 'source', audit } };
}
