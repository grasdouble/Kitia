import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readUtf8 } from '../resources/content.js';
import { catalogNameKey, validateSourceConfiguration } from './model.js';
import type { SourceConfiguration } from './model.js';

function userCatalogDirectory() {
  return process.env.KITIA_CONFIG_DIR || path.join(os.homedir(), '.config', 'kitia');
}

function userCatalogSourcesFile() {
  return path.join(userCatalogDirectory(), 'catalogSources.json');
}

function userCatalogIndexDirectory() {
  return path.join(userCatalogDirectory(), 'source-catalogs');
}

function catalogIndexFileName(name: string) {
  const digest = createHash('sha256').update(catalogNameKey(name), 'utf8').digest('hex');
  return path.join('.kitia-index', `${digest}.json`);
}

function loadUserSourceConfiguration(): SourceConfiguration[] {
  const file = userCatalogSourcesFile();
  if (!fs.existsSync(file)) return [];
  return validateSourceConfiguration(JSON.parse(readUtf8(file, 'User catalog source configuration')));
}

export {
  userCatalogDirectory,
  userCatalogSourcesFile,
  userCatalogIndexDirectory,
  catalogIndexFileName,
  loadUserSourceConfiguration,
};
