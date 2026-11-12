"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { DASHBOARD_THEME } = require("../dist/dashboard/colors.js");
const { highlightSource } = require("../dist/dashboard/source-highlighting.mjs");

function highlightExact(filename, input) {
  const lines = Object.freeze([...input]);
  const result = highlightSource(filename, lines);
  assert.equal(result.length, lines.length, `${filename} retains every logical line`);
  assert.deepEqual(result.map((line) => line.map(({ text }) => text).join("")), lines,
    `${filename} retains source text exactly`);
  for (const line of result) {
    assert.ok(Array.isArray(line));
    for (const span of line) {
      assert.equal(typeof span.text, "string");
      if (span.role !== undefined) {
        assert.ok(Object.hasOwn(DASHBOARD_THEME.semantic.syntax, span.role),
          `${span.role} is a semantic syntax role`);
      }
      assert.doesNotMatch(span.text, /\u001b|\u009b/, "tokens do not inject terminal control sequences");
    }
  }
  return result;
}

function assertRole(line, text, role) {
  const source = line.map((span) => span.text).join("");
  const start = source.indexOf(text);
  assert.notEqual(start, -1, `${JSON.stringify(text)} is present in ${JSON.stringify(source)}`);
  let offset = 0;
  const matching = line.filter((span) => {
    const end = offset + span.text.length;
    const overlaps = offset < start + text.length && end > start;
    offset = end;
    return overlaps;
  });
  assert.ok(matching.some((span) => span.role === role),
    `${JSON.stringify(text)} has semantic ${role} highlighting: ${JSON.stringify(matching)}`);
}

function assertPlain(line) {
  assert.ok(line.every((span) => span.role === undefined),
    `unsupported source remains plain: ${JSON.stringify(line)}`);
}

test("Markdown syntax gives headings, emphasis, links and inline code meaningful roles", () => {
  const lines = highlightExact("references/REVIEW.md", [
    "# Review checklist",
    "Use **careful review** and *emphasis* before approval.",
    "Read [the guide](https://example.com/review?a=1&b=2).",
    "Run `npm test` without rendering the Markdown.",
  ]);
  assertRole(lines[0], "Review checklist", "heading");
  assertRole(lines[1], "careful review", "emphasis");
  assertRole(lines[1], "emphasis", "emphasis");
  assertRole(lines[2], "the guide", "link");
  assertRole(lines[3], "npm test", "code");
});
test("adjacent Markdown emphasis delimiters do not bleed into later paragraphs, headings, or tables", () => {
  const lines = highlightExact("SKILL.md", [
    "then collect the four preferences below **before initializing a new**** presentation",
    "****or writing its narrative**.",
    "Version 1 supports **English text and captions**, **1080p at 30 fps**, and",
    "**macOS **say** narration** with any installed voice. A French voice can read",
    "English text but may pronounce it unnaturally. There is no emotional-style",
    "parameter; express delivery through the writing, punctuation, and speech rate.",
    "There is **no fixed maximum presentation duration**. The chosen duration range",
    "is still enforced; available disk space, render time, and platform resources",
    "remain practical constraints.",
    "### Invocation-time questions",
    "",
    "Column A | Column B",
    "--- | ---",
    "ordinary | table cells",
  ]);
  assertRole(lines[0], "before initializing a new", "emphasis");
  assertRole(lines[0], "presentation", undefined);
  assertRole(lines[1], "or writing its narrative", undefined);
  assertRole(lines[2], "English text and captions", "emphasis");
  assertRole(lines[2], "1080p at 30 fps", "emphasis");
  assertRole(lines[3], "macOS ", "emphasis");
  assertRole(lines[3], "say", "emphasis");
  assertRole(lines[3], "narration", "emphasis");
  assertRole(lines[3], "with any installed voice.", undefined);
  assertRole(lines[4], "English text but may pronounce it unnaturally.", undefined);
  assertRole(lines[5], "parameter; express delivery", undefined);
  assertRole(lines[6], "no fixed maximum presentation duration", "emphasis");
  assertRole(lines[7], "available disk space", undefined);
  assertRole(lines[9], "Invocation-time questions", "heading");
  assertRole(lines[11], "Column A", "emphasis");
  assertRole(lines[13], "ordinary", undefined);
});
test("valid nested, adjacent, escaped and multiline emphasis stays bounded to its Markdown block", () => {
  const lines = highlightExact("SKILL.md", [
    "**one****two** and ***bold italic***.",
    "**bold *italic* bold**.",
    "**multiline emphasis",
    "continues on this line** and then plain.",
    "**unmatched opener",
    "",
    "Plain paragraph after unmatched delimiter.",
    "\\*\\*escaped markers\\*\\* remain literal.",
    "### Heading after malformed syntax",
  ]);
  assertRole(lines[0], "one", "emphasis");
  assertRole(lines[0], "two", "emphasis");
  assertRole(lines[0], "bold italic", "emphasis");
  assertRole(lines[1], "bold ", "emphasis");
  assertRole(lines[1], "italic", "emphasis");
  assertRole(lines[1], " bold", "emphasis");
  assertRole(lines[2], "multiline emphasis", "emphasis");
  assertRole(lines[3], "continues on this line", "emphasis");
  assertRole(lines[3], "and then plain.", undefined);
  assertRole(lines[4], "unmatched opener", undefined);
  assertRole(lines[6], "Plain paragraph after unmatched delimiter.", undefined);
  assertRole(lines[7], "escaped markers", undefined);
  assertRole(lines[8], "Heading after malformed syntax", "heading");
});



for (const [filename, source, text, role] of [
  ["scripts/review.js", "const verdict = 'ready';", "const", "keyword"],
  ["scripts/review.mjs", "const verdict = 'ready';", "'ready'", "string"],
  ["scripts/review.ts", "const count: number = 42;", "42", "number"],
  ["scripts/review.tsx", "const view = <Review title=\"ready\" />;", "const", "keyword"],
  ["scripts/review.jsx", "const view = <Review title=\"ready\" />;", "const", "keyword"],
  ["config/settings.json", '{"status": "ready", "count": 42}', '"status"', "property"],
  ["config/settings.jsonc", '// review\n{"count": 42}', "// review", "comment"],
  ["scripts/review.py", "def review(): return 'ready'", "def", "keyword"],
  ["scripts/review.sh", "printf '%s' 'ready'", "'ready'", "string"],
  [".zshrc", "export REVIEW='ready'", "'ready'", "string"],
  ["config/review.yaml", 'status: "ready"', '"ready"', "string"],
  ["templates/review.html", '<article title="ready">Review</article>', '"ready"', "string"],
  ["templates/review.xml", '<review status="ready" />', '"ready"', "string"],
  ["styles/review.css", "/* review */ .review { color: red; }", "/* review */", "comment"],
  ["scripts/review.go", 'package main\nfunc main() { println("ready") }', "package", "keyword"],
  ["scripts/review.rs", 'fn main() { println!("ready"); }', "fn", "keyword"],
  ["queries/review.sql", "SELECT status FROM reviews;", "SELECT", "keyword"],
]) {
  test(`known grammar highlights ${filename}`, () => {
    const input = source.split("\n");
    const lines = highlightExact(filename, input);
    const index = input.findIndex((line) => line.includes(text));
    assertRole(lines[index], text, role);
  });
}

test("file-wide JavaScript comments and template strings retain state across logical lines", () => {
  const lines = highlightExact("scripts/review.js", [
    "/* review begins",
    "const notCode = 'inside a comment';",
    "review ends */",
    "const message = `first line",
    "template continuation with café 漢字 🙂 <>&",
    "last line`;",
    "const after = 42;",
  ]);
  assertRole(lines[1], "notCode", "comment");
  assertRole(lines[2], "review ends", "comment");
  assertRole(lines[4], "template continuation", "string");
  assertRole(lines[5], "last line", "string");
  assertRole(lines[6], "const", "keyword");
  assertRole(lines[6], "42", "number");
});

test("file-wide Python triple-quoted strings retain state and then resume code", () => {
  const lines = highlightExact("scripts/review.py", [
    'message = """first line',
    "def this_is_string_not_code():",
    'last line"""',
    "def review(): return 42",
  ]);
  assertRole(lines[1], "this_is_string_not_code", "string");
  assertRole(lines[2], "last line", "string");
  assertRole(lines[3], "def", "keyword");
});

for (const [marker, language, source, text, role] of [
  ["```", "javascript", "const ready = 42;", "const", "keyword"],
  ["~~~", "ts", "const ready: number = 42;", "42", "number"],
  ["```", "python", "def review(): return 'ready'", "def", "keyword"],
  ["~~~", "bash", "printf '%s' 'ready'", "'ready'", "string"],
  ["```", "json", '{"status": "ready"}', '"status"', "property"],
]) {
  test(`Markdown ${marker} ${language} fences use the selected grammar`, () => {
    const lines = highlightExact("SKILL.md", [
      `${marker}${language}`, source, marker, "# Markdown resumes",
    ]);
    assertRole(lines[1], text, role);
    assertRole(lines[3], "Markdown resumes", "heading");
  });
}

test("known fenced code preserves multiline state without bleeding into subsequent blocks", () => {
  const lines = highlightExact("SKILL.md", [
    "````javascript",
    "/* start",
    "```",
    "const stillComment = 42;",
    "end */",
    "````",
    "~~~python",
    'message = """first',
    "def still_string():",
    'last"""',
    "~~~",
    "```javascript",
    "const fresh = 42;",
    "```",
    "# Back to Markdown",
  ]);
  assertRole(lines[2], "```", "comment");
  assertRole(lines[3], "stillComment", "comment");
  assertRole(lines[8], "still_string", "string");
  assertRole(lines[12], "const", "keyword");
  assertRole(lines[14], "Back to Markdown", "heading");
});

test("unknown and unlabeled fenced languages stay plain without guessing code or Markdown", () => {
  const input = [
    "```unsupported-preview-language",
    "const ready = '<>&';",
    "# not a Markdown heading",
    "```",
    "~~~",
    "**not Markdown emphasis** and `not inline code`",
    "def not_python(): return 42",
    "~~~",
    "# Markdown resumes",
  ];
  const lines = highlightExact("SKILL.md", input);
  for (const index of [1, 2, 5, 6]) assertPlain(lines[index]);
  assertRole(lines[8], "Markdown resumes", "heading");
});

test("unsupported filenames stay plain even when their contents resemble a known language", () => {
  for (const filename of ["README", "notes.txt", "scripts/review.unknown", "config/Makefile"]) {
    const lines = highlightExact(filename, ["# Heading", "const ready = '<>&';", "```js", "const n = 42;", "```"]);
    for (const line of lines) assertPlain(line);
  }
});

test("source spans retain empty lines, whitespace, Unicode and special characters without HTML or ANSI pollution", () => {
  const input = [
    "", "", "\t  ", "  # café 漢字 🙂 e\u0301  ",
    "\t**bold** [link](https://example.com/?a=1&b=2) `<>&`  ",
    "<tag attr=\"literal\"> &amp; &#39; & < > \\",
    "```javascript", "const unicode = 'café 漢字 🙂 e\u0301 <>&';  ", "```", "", "",
  ];
  for (const filename of ["SKILL.md", "scripts/review.js", "plain.unknown"]) {
    highlightExact(filename, input);
  }
  assert.deepEqual(highlightExact("empty.md", []), []);
  assert.equal(highlightExact("empty.md", [""]).length, 1);
});
