import fs from 'node:fs';
import path from 'node:path';

import { loadUserSourceConfiguration } from '../core/catalogs/config.js';
import {
  exportCatalogConfiguration,
  addCatalog,
  importCatalogConfigurationText,
  refreshCatalogs,
  removeCatalog,
} from '../core/catalogs/manage.js';
import { repositoryId } from '../core/catalogs/model.js';
import { CatalogError } from '../core/resources/model.js';
import type { CliOptions } from './arguments.js';

function manageCatalogCommand(options: CliOptions): number {
  const output = options.output || console;
  if (options.action === 'add') {
    addCatalog(options.name!, options.repository!);
    output.log(`Added catalog ${options.name} (${repositoryId(options.repository!)}).`);
    return 0;
  }
  if (options.action === 'export') {
    exportCatalogConfiguration(options.file!);
    output.log(`Exported catalog configuration to ${options.file}.`);
    return 0;
  }
  if (options.action === 'import') {
    const summary = importCatalogConfigurationText(fs.readFileSync(path.resolve(options.file!), 'utf8'));
    output.log(
      `Catalog import: ${summary.added.length} added, ${summary.ignored.length} ignored, ${summary.refreshed.length} refreshed, ${summary.refreshFailures.length} refresh failed.`,
    );
    for (const name of summary.added) output.log(`Added: ${name}`);
    for (const { name, reason } of summary.ignored) output.log(`Ignored: ${name} · ${reason}`);
    for (const catalog of summary.refreshed) {
      output.log(`Refreshed: ${catalog.name} · ${catalog.count} resources indexed.`);
    }
    for (const failure of summary.refreshFailures) {
      output.error(`Refresh failed: ${failure.name} · ${failure.message}`);
    }
    return summary.refreshFailures.length ? 1 : 0;
  }
  if (options.action === 'refresh') {
    const result = refreshCatalogs(options.allCatalogs ? undefined : [options.name!]);
    for (const catalog of result.refreshed) {
      output.log(
        `Refreshed catalog ${catalog.name} · ${catalog.count} resource${catalog.count === 1 ? '' : 's'} indexed.`,
      );
    }
    for (const failure of result.failures) {
      output.error(`Catalog refresh failed for ${failure.name}: ${failure.message}`);
    }
    return result.failures.length ? 1 : 0;
  }
  if (options.action === 'remove') {
    removeCatalog(options.name!);
    output.log(`Removed user catalog ${options.name}.`);
    return 0;
  }
  if (options.action === 'list') {
    for (const source of loadUserSourceConfiguration()) {
      output.log(`${source.name}\t${source.repository}`);
    }
    return 0;
  }
  throw new CatalogError(
    'Usage: kitia catalog <add <name> <github-repository> | refresh <name> | refresh --all | remove <name> | list>',
  );
}

export { manageCatalogCommand };
