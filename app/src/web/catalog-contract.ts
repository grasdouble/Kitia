import type { CatalogSnapshot } from '../application/snapshot.js';
import type { AddCatalogRequest, UserCatalog } from '../core/catalogs/model.js';

export type CatalogCommand =
  | { action: 'add'; catalog: AddCatalogRequest }
  | { action: 'edit'; originalName: string; catalog: AddCatalogRequest }
  | { action: 'refresh'; name?: string }
  | { action: 'remove'; name: string }
  | { action: 'import'; sources: UserCatalog[] };

export type CatalogCommandResult = {
  snapshot: CatalogSnapshot;
  messages: string[];
  warnings: string[];
};

export const CATALOG_BODY_LIMIT = 1024 * 1024;
