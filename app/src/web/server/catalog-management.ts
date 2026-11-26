import type { IncomingMessage } from 'node:http';

import { runOperation } from '../../application/worker-client.js';
import { isReservedCatalogName, isValidCatalogName, validateSourceConfiguration } from '../../core/catalogs/model.js';
import { CatalogError } from '../../core/resources/model.js';
import { CATALOG_BODY_LIMIT, type CatalogCommand, type CatalogCommandResult } from '../catalog-contract.js';

function names(value: unknown): string {
  if (!isValidCatalogName(value) || isReservedCatalogName(value)) throw new Error('Enter a valid catalog name.');
  return value;
}

export async function readCatalogCommand(request: IncomingMessage): Promise<CatalogCommand> {
  if (request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    throw new CatalogError('Catalog requests must use application/json.', 'UNSUPPORTED_MEDIA_TYPE');
  }
  const tooLarge = () => new CatalogError('Catalog requests are limited to 1 MiB.', 'PAYLOAD_TOO_LARGE');
  if (Number(request.headers['content-length']) > CATALOG_BODY_LIMIT) {
    request.resume();
    throw tooLarge();
  }
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > CATALOG_BODY_LIMIT) {
      request.resume();
      throw tooLarge();
    }
    chunks.push(chunk);
  }
  try {
    const payload: unknown = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
    if (!payload || typeof payload !== 'object' || !('action' in payload)) throw new Error('Missing catalog action.');
    const input = payload as Record<string, unknown>;
    switch (input.action) {
      case 'add':
      case 'edit': {
        const [{ name, repository, mode, entries }] = validateSourceConfiguration({
          catalog_version: 1,
          sources: [input.catalog],
        });
        const catalog = { name: names(name), repository, mode, entries };
        return input.action === 'add'
          ? { action: 'add', catalog }
          : { action: 'edit', originalName: names(input.originalName), catalog };
      }
      case 'refresh':
        return { action: 'refresh', name: input.name === undefined ? undefined : names(input.name) };
      case 'remove':
        return { action: 'remove', name: names(input.name) };
      case 'import': {
        if (!Array.isArray(input.sources) || !input.sources.length)
          throw new Error('Select at least one catalog to import.');
        const sources = input.sources.map((source: unknown) => {
          const [{ name, repository, mode, entries }] = validateSourceConfiguration({
            catalog_version: 1,
            sources: [source],
          });
          return { name: names(name), repository, mode, entries };
        });
        return { action: 'import', sources };
      }
      default:
        throw new Error('Unknown catalog action.');
    }
  } catch (error) {
    throw new CatalogError(error instanceof Error ? error.message : 'Invalid catalog request.', 'INVALID_ARGUMENT');
  }
}

export async function runCatalogCommand(command: CatalogCommand): Promise<CatalogCommandResult> {
  switch (command.action) {
    case 'add':
    case 'edit': {
      const { catalog, count, ...snapshot } =
        command.action === 'add'
          ? await runOperation({ task: 'catalog-add', request: command.catalog })
          : await runOperation({
              task: 'catalog-update',
              originalName: command.originalName,
              request: command.catalog,
            });
      return {
        snapshot,
        messages: [`${command.action === 'add' ? 'Added' : 'Saved'} ${catalog} · ${count} indexed resources.`],
        warnings: [],
      };
    }
    case 'remove': {
      const snapshot = await runOperation({ task: 'catalog-remove', name: command.name });
      return { snapshot, messages: [`Removed ${command.name}. Installed files were not removed.`], warnings: [] };
    }
    case 'refresh': {
      const { refreshed, failures, ...snapshot } = await runOperation({ task: 'catalog-refresh', name: command.name });
      return {
        snapshot,
        messages: refreshed.map(({ name, count }) => `Refreshed ${name} · ${count} indexed resources.`),
        warnings: failures.map(({ name, message }) => `${name}: ${message}`),
      };
    }
    case 'import': {
      const { importSummary, ...snapshot } = await runOperation({
        task: 'catalog-import',
        content: JSON.stringify({ catalog_version: 1, sources: command.sources }),
      });
      return {
        snapshot,
        messages: [
          ...importSummary.added.map((name) => `Imported ${name}.`),
          ...importSummary.refreshed.map(({ name, count }) => `Indexed ${count} resources for ${name}.`),
        ],
        warnings: [
          ...importSummary.ignored.map(({ name, reason }) => `Skipped ${name}: ${reason}`),
          ...importSummary.refreshFailures.map(
            ({ name, message }) => `Imported ${name}, but its index could not be refreshed: ${message}`,
          ),
        ],
      };
    }
  }
}
