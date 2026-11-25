import { loadUserSourceConfiguration } from '../core/catalogs/config.js';
import { loadCatalogs, type CatalogLoadRequest, type CatalogLoadWarning } from '../core/catalogs/indexes.js';
import { catalogNameKey, type SourceConfiguration } from '../core/catalogs/model.js';
import { prepareTrackedResources } from '../core/inventory/inventory.js';
import { CatalogError, type CatalogResource } from '../core/resources/model.js';
import type { ParsedCliOptions } from './arguments.js';

function loadCommandCatalogs(
  options: ParsedCliOptions,
  warn: (warning: CatalogLoadWarning) => void = () => {},
): { sourceResources: CatalogResource[]; unavailable: string[] } {
  const { command, catalog, kind, id } = options;
  const sources: SourceConfiguration[] = loadUserSourceConfiguration();
  const sourceNames = sources.map(({ name }) => name);
  const tracked =
    command === 'update' && id
      ? prepareTrackedResources(options.target!, {
          kind,
          id,
          registeredCatalogs: sourceNames,
          includeRemovedCatalogs: false,
        })
      : command === 'uninstall' && !catalog
        ? prepareTrackedResources(options.target!, {
            kind,
            id,
            registeredCatalogs: sourceNames,
            includeRemovedCatalogs: true,
          })
        : undefined;
  const names = catalog ? [catalog] : tracked ? tracked.names : sourceNames;
  if (command === 'uninstall' && catalog) {
    const selectedInventory = prepareTrackedResources(options.target!, {
      kind,
      id,
      registeredCatalogs: sourceNames,
      includeRemovedCatalogs: true,
    });
    const installedCatalog =
      selectedInventory.installedCatalogs.find((name: string) => name === catalog) ||
      selectedInventory.installedCatalogs.find((name: string) => catalogNameKey(name) === catalogNameKey(catalog));
    const registeredCatalog =
      sources.find((source) => source.name === catalog)?.name ||
      sources.find((source) => catalogNameKey(source.name) === catalogNameKey(catalog))?.name;
    if (!installedCatalog && !registeredCatalog) {
      throw new CatalogError(`Unknown catalog: ${catalog}`, 'INVALID_ARGUMENT');
    }
    const selectedCatalog = installedCatalog || registeredCatalog;
    options.catalog = selectedCatalog;
    const trackedResources = selectedInventory.resources.filter(
      (resource: CatalogResource) => resource.catalog === selectedCatalog,
    );
    if (trackedResources.length || !registeredCatalog) {
      return { sourceResources: trackedResources, unavailable: [] };
    }
    return loadCatalogs({ names: [registeredCatalog], sources, sourceResources: options.sourceResources });
  }
  if (command === 'uninstall' && tracked) return { sourceResources: tracked.resources, unavailable: [] };

  const request: CatalogLoadRequest = {
    names: command === 'validate' ? sourceNames : names,
    sources,
    sourceResources: options.sourceResources,
    allowUnavailable: ['list', 'search'].includes(command),
    strictAggregate: command === 'validate',
  };
  const loaded = loadCatalogs(request, warn);
  if (command === 'validate' && catalog) {
    loaded.sourceResources = loaded.sourceResources.filter((resource: CatalogResource) => resource.catalog === catalog);
  }
  return loaded;
}
export { loadCommandCatalogs };
