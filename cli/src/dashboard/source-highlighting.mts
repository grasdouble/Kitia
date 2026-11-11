import { createRequire } from "node:module";
import { basename, extname } from "node:path";
import type { Grammar, Token, TokenStream } from "prismjs";
import type { DASHBOARD_THEME } from "./colors.js";

// Load Prism core and only the explicitly supported grammars. Consume token
// streams, never the DOM/HTML APIs, plugins, or automatic language loader.
const require = createRequire(import.meta.url);
const Prism = require("prismjs/components/prism-core.js") as typeof import("prismjs");
require("prismjs/components/prism-markup.js");
require("prismjs/components/prism-css.js");
require("prismjs/components/prism-clike.js");
require("prismjs/components/prism-javascript.js");
require("prismjs/components/prism-typescript.js");
require("prismjs/components/prism-jsx.js");
require("prismjs/components/prism-tsx.js");
require("prismjs/components/prism-json.js");
require("prismjs/components/prism-python.js");
require("prismjs/components/prism-bash.js");
require("prismjs/components/prism-yaml.js");
require("prismjs/components/prism-go.js");
require("prismjs/components/prism-rust.js");
require("prismjs/components/prism-sql.js");
require("prismjs/components/prism-markdown.js");

export type SyntaxRole = keyof typeof DASHBOARD_THEME.semantic.syntax;
export type SyntaxSpan = { text: string; role?: SyntaxRole };
export type SyntaxLine = SyntaxSpan[];

type Language = "markdown" | "javascript" | "jsx" | "typescript" | "tsx"
  | "json" | "python" | "bash" | "yaml" | "markup" | "css" | "go" | "rust" | "sql";

const LANGUAGE_ALIASES: Readonly<Record<string, Language>> = {
  md: "markdown", markdown: "markdown",
  js: "javascript", javascript: "javascript", jsx: "jsx",
  ts: "typescript", typescript: "typescript", tsx: "tsx",
  json: "json", jsonc: "json",
  py: "python", python: "python",
  sh: "bash", shell: "bash", bash: "bash", zsh: "bash", ksh: "bash",
  yaml: "yaml", yml: "yaml",
  html: "markup", markup: "markup", xml: "markup", svg: "markup", mathml: "markup",
  css: "css", go: "go", golang: "go", rs: "rust", rust: "rust", sql: "sql",
};

const EXTENSION_LANGUAGES: Readonly<Record<string, Language>> = {
  ".md": "markdown", ".markdown": "markdown", ".mdown": "markdown", ".mkd": "markdown",
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".jsx": "jsx",
  ".ts": "typescript", ".mts": "typescript", ".cts": "typescript", ".tsx": "tsx",
  ".json": "json", ".jsonc": "json", ".py": "python", ".pyw": "python",
  ".sh": "bash", ".bash": "bash", ".zsh": "bash", ".ksh": "bash",
  ".yaml": "yaml", ".yml": "yaml",
  ".html": "markup", ".htm": "markup", ".xml": "markup", ".svg": "markup",
  ".css": "css", ".go": "go", ".rs": "rust", ".sql": "sql",
};

const SHELL_FILENAMES = new Set([
  ".bashrc", ".bash_profile", ".bash_login", ".profile",
  ".zshrc", ".zprofile", ".zshenv", ".zlogin",
]);

const TOKEN_ROLES: Readonly<Partial<Record<string, SyntaxRole>>> = {
  comment: "comment", prolog: "comment", doctype: "comment",
  keyword: "keyword", boolean: "keyword", atrule: "keyword",
  string: "string", char: "string", "attr-value": "string", cdata: "string",
  regex: "string", "regex-source": "string", "template-punctuation": "string",
  number: "number", constant: "number",
  function: "function", "function-variable": "function", method: "function", macro: "function",
  "class-name": "type", builtin: "type", tag: "type", selector: "type",
  property: "property", "attr-name": "property", variable: "property", parameter: "property",
  operator: "operator", punctuation: "punctuation", entity: "punctuation",
  title: "heading", bold: "emphasis", italic: "emphasis", strike: "emphasis", important: "emphasis",
  url: "link", "url-reference": "link",
  code: "code", "code-snippet": "code", "code-block": "code", "code-language": "code",
};

function plainLines(lines: readonly string[]): SyntaxLine[] {
  return lines.map((text) => text ? [{ text }] : []);
}

function roleForToken(token: Token): SyntaxRole | undefined {
  if (Object.hasOwn(TOKEN_ROLES, token.type)) return TOKEN_ROLES[token.type];
  const aliases = typeof token.alias === "string" ? [token.alias] : token.alias || [];
  for (const alias of aliases) {
    if (Object.hasOwn(TOKEN_ROLES, alias)) return TOKEN_ROLES[alias];
  }
  return undefined;
}

function tokenizeLines(lines: readonly string[], language: Language): SyntaxLine[] {
  if (lines.length === 0) return [];
  const environment = {
    code: lines.join("\n"),
    grammar: Prism.languages[language] as Grammar,
    language,
    tokens: [] as Array<string | Token>,
  };
  Prism.hooks.run("before-tokenize", environment);
  environment.tokens = Prism.tokenize(environment.code, environment.grammar);
  // JSX/TSX use this hook to distinguish literal tag text from expressions.
  Prism.hooks.run("after-tokenize", environment);

  const result: SyntaxLine[] = lines.map(() => []);
  let lineIndex = 0;
  let column = 0;
  function appendText(text: string, role?: SyntaxRole): void {
    let offset = 0;
    while (offset < text.length) {
      if (column === lines[lineIndex].length && lineIndex < lines.length - 1) {
        // Only the separator added by join is consumed. Original CRs, tabs,
        // empty lines, and even embedded newlines in an input entry stay intact.
        offset += 1;
        lineIndex += 1;
        column = 0;
        continue;
      }
      const length = Math.min(text.length - offset, lines[lineIndex].length - column);
      const part = text.slice(offset, offset + length);
      const row = result[lineIndex];
      const previous = row[row.length - 1];
      if (previous && previous.role === role) previous.text += part;
      else row.push(role ? { text: part, role } : { text: part });
      offset += length;
      column += length;
    }
  }
  function visit(stream: TokenStream, inheritedRole?: SyntaxRole): void {
    if (typeof stream === "string") {
      appendText(stream, inheritedRole);
    } else if (Array.isArray(stream)) {
      for (const token of stream) visit(token, inheritedRole);
    } else {
      const role = stream.type === "interpolation" ? undefined : roleForToken(stream) ?? inheritedRole;
      visit(stream.content, role);
    }
  }
  visit(environment.tokens);
  return result;
}

type Fence = { marker: string; length: number; language?: Language };

function openingFence(line: string): Fence | undefined {
  const match = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)\r?$/.exec(line);
  if (!match || (match[1][0] === "`" && match[2].includes("`"))) return undefined;
  const alias = match[2].trim().split(/[\t ]+/, 1)[0].toLowerCase();
  return {
    marker: match[1][0],
    length: match[1].length,
    language: Object.hasOwn(LANGUAGE_ALIASES, alias) ? LANGUAGE_ALIASES[alias] : undefined,
  };
}

function highlightMarkdown(lines: readonly string[]): SyntaxLine[] {
  const result: SyntaxLine[] = [];
  function append(rows: SyntaxLine[]): void {
    for (const row of rows) result.push(row);
  }
  let proseStart = 0;
  let index = 0;
  while (index < lines.length) {
    const fence = openingFence(lines[index]);
    if (!fence) {
      index += 1;
      continue;
    }
    append(tokenizeLines(lines.slice(proseStart, index), "markdown"));
    result.push([{ text: lines[index], role: "code" }]);
    const bodyStart = index + 1;
    const closing = new RegExp(`^ {0,3}${fence.marker}{${fence.length},}[\\t ]*\\r?$`);
    index = bodyStart;
    while (index < lines.length && !closing.test(lines[index])) index += 1;
    const body = lines.slice(bodyStart, index);
    append(fence.language ? highlightLanguage(body, fence.language) : plainLines(body));
    if (index < lines.length) {
      result.push([{ text: lines[index], role: "code" }]);
      index += 1;
    }
    proseStart = index;
  }
  append(tokenizeLines(lines.slice(proseStart), "markdown"));
  return result;
}

function highlightLanguage(lines: readonly string[], language: Language): SyntaxLine[] {
  return language === "markdown" ? highlightMarkdown(lines) : tokenizeLines(lines, language);
}

/**
 * Tokenize complete logical files before display wrapping/pagination. Prism is a
 * lexical highlighter, not a compiler or Markdown renderer. Markdown fences use
 * up to three leading spaces; quoted/list-container fences and MDX are not parsed.
 * Shell aliases use the Bash grammar and SQL uses Prism's generic SQL grammar.
 * Unknown filenames and fence languages stay plain; no language is guessed.
 * Spans contain only original text, never HTML or terminal escape sequences.
 */
export function highlightSource(path: string, lines: readonly string[]): SyntaxLine[] {
  const filename = basename(path).toLowerCase();
  const extension = extname(filename);
  const language = SHELL_FILENAMES.has(filename) ? "bash"
    : Object.hasOwn(EXTENSION_LANGUAGES, extension) ? EXTENSION_LANGUAGES[extension] : undefined;
  return language ? highlightLanguage(lines, language) : plainLines(lines);
}
