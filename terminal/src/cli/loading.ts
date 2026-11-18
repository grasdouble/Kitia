'use strict';

const { CatalogError } = require('../core/resources/model.js');
const { prepareTrackedResources } = require('../core/inventory/inventory.js');
const { loadUserSourceConfiguration } = require('../core/catalogs/config.js');
const { catalogNameKey } = require('../core/catalogs/model.js');
const { loadCatalogs } = require('../core/catalogs/indexes.js');

function loadCommandCatalogs(options, warn = (_warning) => {}) {
  const { command, catalog, kind, id } = options;
  const sources = loadUserSourceConfiguration();
  const sourceNames = sources.map(({ name }) => name);
  const tracked =
    command === 'update' && id
      ? prepareTrackedResources(options.target, {
          kind,
          id,
          registeredCatalogs: sourceNames,
          includeRemovedCatalogs: false,
        })
      : command === 'uninstall' && !catalog
        ? prepareTrackedResources(options.target, {
            kind,
            id,
            registeredCatalogs: sourceNames,
            includeRemovedCatalogs: true,
          })
        : undefined;
  const names = catalog ? [catalog] : tracked ? tracked.names : sourceNames;
  if (command === 'uninstall' && catalog) {
    const selectedInventory = prepareTrackedResources(options.target, {
      kind,
      id,
      registeredCatalogs: sourceNames,
      includeRemovedCatalogs: true,
    });
    const installedCatalog =
      selectedInventory.installedCatalogs.find((name) => name === catalog) ||
      selectedInventory.installedCatalogs.find((name) => catalogNameKey(name) === catalogNameKey(catalog));
    const registeredCatalog =
      sources.find((source) => source.name === catalog)?.name ||
      sources.find((source) => catalogNameKey(source.name) === catalogNameKey(catalog))?.name;
    if (!installedCatalog && !registeredCatalog) {
      throw new CatalogError(`Unknown catalog: ${catalog}`, 'INVALID_ARGUMENT');
    }
    const selectedCatalog = installedCatalog || registeredCatalog;
    options.catalog = selectedCatalog;
    const trackedResources = selectedInventory.resources.filter((resource) => resource.catalog === selectedCatalog);
    if (trackedResources.length || !registeredCatalog) {
      return { sourceResources: trackedResources, unavailable: [] };
    }
    return loadCatalogs({ names: [registeredCatalog], sources, sourceResources: options.sourceResources });
  }
  if (command === 'uninstall' && tracked) return { sourceResources: tracked.resources, unavailable: [] };

  const loaded = loadCatalogs(
    {
      names: command === 'validate' ? sourceNames : names,
      sources,
      sourceResources: options.sourceResources,
      allowUnavailable: ['list', 'search', 'dashboard'].includes(command),
      strictAggregate: command === 'validate',
    },
    warn,
  );
  if (command === 'validate' && catalog) {
    loaded.sourceResources = loaded.sourceResources.filter((resource) => resource.catalog === catalog);
  }
  return loaded;
}
module.exports = { loadCommandCatalogs };
