'use strict';

const { prepareTrackedResources } = require('../core/inventory/inventory.js');
const { loadUserSourceConfiguration } = require('../core/catalogs/config.js');
const { loadCatalogs } = require('../core/catalogs/indexes.js');

function loadCommandCatalogs(options, warn = (_warning) => {}) {
  const { command, catalog, kind, id } = options;
  const sources = loadUserSourceConfiguration();
  const sourceNames = sources.map(({ name }) => name);
  const trackedRequest = {
    catalog,
    kind,
    id,
    registeredCatalogs: sourceNames,
    includeRemovedCatalogs: options.command === 'uninstall',
  };
  const tracked =
    ['update', 'uninstall'].includes(command) && (command === 'uninstall' || id)
      ? prepareTrackedResources(options.target, trackedRequest)
      : undefined;
  const names = catalog ? [catalog] : tracked ? tracked.names : sourceNames;
  if (command === 'uninstall') {
    const needsCatalogDiscovery =
      catalog && sourceNames.includes(catalog) && !tracked.installedCatalogs.includes(catalog);
    if (!needsCatalogDiscovery) return { sourceResources: tracked.resources, unavailable: [] };
  }

  return loadCatalogs(
    {
      names,
      sources,
      sourceResources: options.sourceResources,
      allowUnavailable: ['list', 'search'].includes(command),
    },
    warn,
  );
}
module.exports = { loadCommandCatalogs };
