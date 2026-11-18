'use strict';

const { CatalogError } = require('./model.js');
const YAML = require('yaml');
function frontmatterParts(text, filePath, allowEmpty = false) {
  const lines = text.split('\n');
  if (!lines.length || lines[0].trim() !== '---') {
    throw new CatalogError(`${filePath} must start with YAML frontmatter`);
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) throw new CatalogError(`Unclosed YAML frontmatter in ${filePath}`);
  const document = YAML.parseDocument(lines.slice(1, end).join('\n'), {
    uniqueKeys: true,
    schema: 'core',
  });
  if (document.errors.length || document.warnings.length) {
    throw new CatalogError(
      `Invalid YAML in ${filePath}: ${[...document.errors, ...document.warnings].map((error) => error.message).join('; ')}`,
    );
  }
  if (allowEmpty && document.contents === null) {
    return { document, values: new Map(), body: lines.slice(end + 1).join('\n') };
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
  return { document, values, body: lines.slice(end + 1).join('\n') };
}

function parseFrontmatter(text, filePath) {
  return frontmatterParts(text, filePath).values;
}

function parseInstruction(
  content: Buffer,
  label: string,
): { values: Map<string, unknown>; body: string; applyTo: string[] } {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    throw new CatalogError(`Source instruction is not valid UTF-8: ${label}`);
  }
  const hasFrontmatter = /^[^\S\r\n]*---[^\S\r\n]*(?:\r?\n|$)/.test(text);
  const { values, body } = hasFrontmatter ? frontmatterParts(text, label, true) : { values: new Map(), body: text };
  const key = ['apply_to', 'applyTo', 'paths'].find((candidate) => values.has(candidate));
  const scope = key === undefined ? '**' : values.get(key);
  const applyTo = typeof scope === 'string' ? [scope] : scope;
  if (
    !Array.isArray(applyTo) ||
    !applyTo.length ||
    applyTo.some((pattern) => typeof pattern !== 'string' || !pattern.trim())
  ) {
    throw new CatalogError(`${label} must define a non-empty apply_to, applyTo, or paths frontmatter value`);
  }
  return { values, body, applyTo };
}

module.exports = { frontmatterParts, parseFrontmatter, parseInstruction };

export {};
