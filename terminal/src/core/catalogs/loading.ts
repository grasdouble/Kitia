"use strict";

const { loadUserSourceConfiguration, userCatalogIndexDirectory } = require("./config.js");
const { loadSourceCatalogsFromDirectory } = require("./loader.js");
const { CatalogError } = require("../resources/model.js");
export interface CatalogLoadRequest {
  names?: string[];
  sources?: Array<{ name: string; repository: string; repositoryId: string; mode?: string; entries?: Array<{kind: string; id?: string; path: string}> }>;
  sourceResources?: import("../resources/model.js").CatalogResource[];
  allowUnavailable?: boolean;
}
export interface CatalogLoadWarning { code: string; catalog: string; message: string; }
function loadCatalogs({ names, sources = loadUserSourceConfiguration(), sourceResources: suppliedResources, allowUnavailable = false }: CatalogLoadRequest = {}, warn: (warning: CatalogLoadWarning) => void = () => {}) {
  names ||= sources.map(({ name }) => name);
  const loaded = { sourceResources: [], unavailable: [] };
  let sourceResources;
  const loadSources = () => {
    if (sourceResources) return sourceResources;
    sourceResources = suppliedResources || (sources.length
      ? loadSourceCatalogsFromDirectory(userCatalogIndexDirectory(), sources)
      : []);
    return sourceResources;
  };
  const loaders = Object.fromEntries(sources.map((source) => [source.name, () => {
    loaded.sourceResources.push(...loadSources().filter((resource) => resource.catalog === source.name));
  }]));
  for (const name of names) {
    const loader = loaders[name];
    if (!loader) throw new CatalogError(`Unknown catalog: ${name}`, "INVALID_ARGUMENT");
    try {
      loader();
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const message = `${name} catalog unavailable: ${error.message}`;
      const errorCode = (error as Error & { code?: string }).code;
      const code = errorCode && ["UNSUPPORTED_CATALOG_VERSION", "UNSUPPORTED_RESOURCE_KIND", "INVALID_ARGUMENT"].includes(errorCode)
        ? errorCode : "CATALOG_UNAVAILABLE";
      if (!allowUnavailable) throw new CatalogError(message, code);
      loaded.unavailable.push(name);
      warn({ code, catalog: name, message });
    }
  }
  return loaded;
}
module.exports = { loadCatalogs };

