import assert from "node:assert/strict";
import test from "node:test";
import { validateChangesetContent } from "./check-changeset-format.mjs";

const frontmatter = "---\n\"@grasdouble/kitia\": minor\n---\n\n";

test("accepts a short description followed by two-space detail bullets", () => {
  assert.deepEqual(validateChangesetContent(
    `${frontmatter}Improve catalog search\n  - Match tags and license data.\n  - Preserve source provenance.\n`,
  ), []);
});

test("accepts empty no-bump Changesets with an optional message", () => {
  assert.deepEqual(validateChangesetContent("---\n\n---\n\nRepository-only update.\n"), []);
});

test("rejects paragraphs, malformed indentation, and missing details", () => {
  assert.equal(validateChangesetContent(`${frontmatter}Summary\n\nParagraph.`).length, 2);
  assert.match(validateChangesetContent(`${frontmatter}Summary\n    - Detail.`)[0], /indented detail/);
  assert.match(validateChangesetContent(`${frontmatter}Summary`)[0], /add details/);
});

test("rejects missing YAML frontmatter", () => {
  assert.match(validateChangesetContent("Summary\n  - Detail.")[0], /frontmatter/);
});
