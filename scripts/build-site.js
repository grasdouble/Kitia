"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { generateSourceCatalogs, parseBuildArguments } = require("./build-source-catalogs.js");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "site-build");

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function cleanOutputDirectory(outputDirectory) {
  const destination = path.resolve(outputDirectory);
  const destinationContainsRoot = isWithin(destination, root);
  if (destination === path.parse(destination).root || destination === root || destinationContainsRoot ||
      isWithin(root, destination) && !isWithin(output, destination)) {
    throw new Error(`Refusing to replace unsafe site output directory: ${destination}`);
  }
  try {
    const stat = fs.lstatSync(destination);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Site output must be a regular directory, not a file or symbolic link: ${destination}`);
    }
    fs.rmSync(destination, { recursive: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  fs.mkdirSync(destination, { recursive: true });
  return destination;
}

function buildSite(outputDirectory = output, { sourceRoot, sourceRoots } = {}) {
  const destination = cleanOutputDirectory(outputDirectory);
  const roots = sourceRoots || (sourceRoot ? { community: sourceRoot } : {});
  generateSourceCatalogs({
    sourceRoots: roots,
    includeUserSources: false,
    outputDirectory: path.join(destination, "data", "source-catalogs"),
  });
  fs.cpSync(path.join(root, "site"), destination, { recursive: true });
  fs.copyFileSync(path.join(root, "src/catalog/search.ts"), path.join(destination, "catalog-search.js"));
  const dataDirectory = path.join(destination, "data");
  fs.mkdirSync(dataDirectory, { recursive: true });
  fs.copyFileSync(path.join(root, "catalogs", "catalog.json"), path.join(dataDirectory, "catalog.json"));
  return outputDirectory;
}

if (require.main === module) {
  try {
    const { sourceRoots, outputDirectory } = parseBuildArguments(process.argv.slice(2));
    if (outputDirectory) throw new Error("site:build does not support --output");
    const builtDirectory = buildSite(undefined, { sourceRoots });
    console.log(`Built visual catalog in ${path.relative(root, builtDirectory)}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { buildSite, cleanOutputDirectory };
