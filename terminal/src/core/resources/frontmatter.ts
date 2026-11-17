"use strict";

const { CatalogError } = require("./model.js");
const YAML = require("yaml");
function frontmatterParts(text, filePath) {
  const lines = text.split(/\r?\n/);
  if (!lines.length || lines[0].trim() !== "---") {
    throw new CatalogError(`${filePath} must start with YAML frontmatter`);
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) throw new CatalogError(`Unclosed YAML frontmatter in ${filePath}`);
  const document = YAML.parseDocument(lines.slice(1, end).join("\n"), {
    uniqueKeys: true,
    schema: "core",
  });
  if (document.errors.length || document.warnings.length) {
    throw new CatalogError(`Invalid YAML in ${filePath}: ${[...document.errors, ...document.warnings].map((error) => error.message).join("; ")}`);
  }
  if (!YAML.isMap(document.contents)) {
    throw new CatalogError(`${filePath} frontmatter must be a YAML mapping`);
  }
  let values;
  try {
    values = document.toJS({ maxAliasCount: 20, mapAsMap: true });
  } catch (error) {
    throw new CatalogError(`Invalid YAML in ${filePath}: ${error.message}`);
  }
  return { document, values, body: lines.slice(end + 1).join("\n") };
}

function parseFrontmatter(text, filePath) {
  return frontmatterParts(text, filePath).values;
}

module.exports = { frontmatterParts, parseFrontmatter };

export {};
