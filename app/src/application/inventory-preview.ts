import { realpathSync } from 'node:fs';

import { localPreviewFiles } from '../core/inspection/local-preview.js';
import type { ResourceInspection } from '../core/inspection/model.js';
import type { InstallationScope } from '../core/installations/model.js';
import { collectInstalledScopes } from '../core/inventory/checks.js';
import { readInstallState } from '../core/inventory/inventory.js';
import { canPreviewInstalledResource } from '../core/inventory/view.js';
import { CatalogError, type CatalogResource, type ResourceKind } from '../core/resources/model.js';
import { readCatalogSnapshot, type InstallationTargets } from './snapshot.js';

export type InstalledResourceSelector = {
  scope: InstallationScope;
  kind: ResourceKind;
  id: string;
  catalog: string;
  managed: boolean;
};

export function inspectInstalledFiles(target: string, resource: CatalogResource): ResourceInspection {
  return localPreviewFiles(target, readInstallState(target), resource);
}

export function readInstalledPreview(
  targets: InstallationTargets,
  selector: InstalledResourceSelector,
): ResourceInspection | null {
  const { scope, kind, id, catalog, managed } = selector;
  const target = targets[scope];
  if (realpathSync(target) !== target) throw new CatalogError('The inventory target has moved. Restart Kitia web.');
  const { resources, errors } = collectInstalledScopes({ [scope]: target }, readCatalogSnapshot().resources);
  if (errors.length) throw new CatalogError(errors[0].message, errors[0].code);
  const matches = resources.filter(
    (resource) =>
      resource.kind === kind &&
      resource.id === id &&
      (resource.catalog || '') === catalog &&
      (resource.managed !== false) === managed,
  );
  if (matches.length !== 1 || !canPreviewInstalledResource(matches[0])) return null;
  return inspectInstalledFiles(target, matches[0]);
}
