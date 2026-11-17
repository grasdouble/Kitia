'use strict';

const { validateSourceConfiguration } = require('./model.js');
const { readUtf8 } = require('../resources/content.js');

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function userCatalogDirectory() {
  if (process.env.KITIA_CONFIG_DIR) return process.env.KITIA_CONFIG_DIR;
  const current = path.join(os.homedir(), '.config', 'kitia');
  const previous = path.join(os.homedir(), '.config', 'kiti');
  if (!fs.existsSync(current) && fs.existsSync(previous)) {
    fs.mkdirSync(path.dirname(current), { recursive: true });
    fs.cpSync(previous, current, { recursive: true, errorOnExist: true, force: false });
  }
  return current;
}

function userCatalogSourcesFile() {
  return path.join(userCatalogDirectory(), 'catalogSources.json');
}

function userCatalogIndexDirectory() {
  return path.join(userCatalogDirectory(), 'source-catalogs');
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
  loadUserSourceConfiguration,
};

export {};
