"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { generateSourceCatalogs, parseBuildArguments } = require("./build-source-catalogs.js");

const ROOT = path.resolve(__dirname, "..");
const SITE_ROOT = path.join(ROOT, "site");
const CATALOG_ROOT = path.join(ROOT, "catalogs");
const SOURCE_DATA = path.join(ROOT, "site-build", "data", "source-catalogs");
const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
]);

function fileForPath(pathname, sourceDataDirectory) {
  if (pathname === "/catalog-search.js") return path.join(ROOT, "src/catalog/search.ts");
  if (pathname === "/data/catalog.json") return path.join(CATALOG_ROOT, "catalog.json");
  if (pathname === "/data/source-catalogs/catalogSources.json") {
    return path.join(sourceDataDirectory, "catalogSources.json");
  }
  const sourceCatalog = pathname.match(/^\/data\/source-catalogs\/([^/]+)\.json$/);
  if (sourceCatalog && !/[\\:\u0000-\u001f\u007f-\u009f]/u.test(sourceCatalog[1])) {
    return path.join(sourceDataDirectory, `${sourceCatalog[1]}.json`);
  }
  const relativePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(SITE_ROOT, `.${relativePath}`);
  if (!filePath.startsWith(`${SITE_ROOT}${path.sep}`)) return null;
  return filePath;
}

function createSiteServer({ sourceDataDirectory = SOURCE_DATA } = {}) {
  return http.createServer((request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    } catch {
      response.writeHead(400).end("Bad request");
      return;
    }

    const filePath = fileForPath(pathname, sourceDataDirectory);
    if (!filePath) {
      response.writeHead(404).end("Not found");
      return;
    }
    fs.stat(filePath, (error, stats) => {
      if (error || !stats.isFile()) {
        response.writeHead(404).end("Not found");
        return;
      }
      response.writeHead(200, {
        "Content-Length": stats.size,
        "Content-Type": CONTENT_TYPES.get(path.extname(filePath)) || "application/octet-stream",
      });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      fs.createReadStream(filePath).pipe(response);
    });
  });
}

if (require.main === module) {
  try {
    const port = Number(process.env.PORT || 4173);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error("PORT must be an integer between 0 and 65535.");
    }
    const { sourceRoots, outputDirectory } = parseBuildArguments(process.argv.slice(2));
    if (outputDirectory) throw new Error("site:dev does not support --output");
    generateSourceCatalogs({ sourceRoots, includeUserSources: false, outputDirectory: SOURCE_DATA });
    const server = createSiteServer();
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      console.log(`Local site available at http://127.0.0.1:${address.port}`);
    });
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { createSiteServer };
