"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const buildFile = path.join(root, "dist", "catalog-build.json");

// A distributed tarball already carries its immutable Git provenance.
if (!fs.existsSync(path.join(root, ".git"))) {
  if (!fs.existsSync(buildFile)) {
    throw new Error("Catalog build metadata is missing. Use a Git checkout or an official release archive.");
  }
  process.exit(0);
}

if (process.argv.includes("--clean")) {
  fs.rmSync(buildFile, { force: true });
  process.exit(0);
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

const packageInfo = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const { validateCatalog, readSourceFiles } = require("../dist/catalog/resources/files.js");
const resources = validateCatalog(root);
const commit = git(["rev-parse", "HEAD"]);
const dirty = git(["status", "--porcelain", "--untracked-files=all"]).length > 0;
fs.writeFileSync(
  buildFile,
  `${JSON.stringify(
    {
      catalog: "grasdouble/Kitia",
      commit,
      package_version: packageInfo.version,
      dirty,
      executable_files: resources.filter((resource) => resource.kind === "skill")
        .flatMap((resource) => readSourceFiles(resource, root)
          .filter(([, , executable]) => executable)
          .map(([relativePath]) => path.posix.join(
            path.relative(root, resource.source).split(path.sep).join("/"), relativePath,
          )))
        .sort(),
    },
    null,
    2,
  )}\n`,
);
