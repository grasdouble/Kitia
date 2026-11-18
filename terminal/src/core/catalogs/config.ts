'use strict';

const { validateSourceConfiguration, catalogNameKey } = require('./model.js');
const { readUtf8 } = require('../resources/content.js');

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

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
  const crypto = require('node:crypto');
  const digest = crypto.createHash('sha256').update(catalogNameKey(name), 'utf8').digest('hex');
  return path.join('.kitia-index', `${digest}.json`);
}

function loadUserSourceConfiguration() {
  const file = userCatalogSourcesFile();
  if (!fs.existsSync(file)) return [];
  return validateSourceConfiguration(JSON.parse(readUtf8(file, 'User catalog source configuration')));
}

module.exports = {
  userCatalogDirectory,
  userCatalogSourcesFile,
  userCatalogIndexDirectory,
  catalogIndexFileName,
  loadUserSourceConfiguration,
};

export {};
