import assert from "node:assert/strict";
import test from "node:test";
import { validateChangesetContent } from "./check-changeset-format.mjs";

const frontmatter = "---\n\"@grasdouble/kitia\": minor\n---\n\n";

test("accepts a summary with grouped user-facing and technical details", () => {
  assert.deepEqual(validateChangesetContent(
    `${frontmatter}Improve catalog search\n  - **User-Facing**\n    - Match tags and license data.\n  - **Technical**\n    - Preserve source provenance.\n`,
  ), []);
});

test("accepts a Changeset with only user-facing details", () => {
  assert.deepEqual(validateChangesetContent(
    `${frontmatter}Improve catalog search\n  - **User-Facing**\n    - Match tags and license data.\n`,
  ), []);
});

test("accepts empty no-bump frontmatter with adjacent delimiters or blank lines", () => {
  for (const newline of ["\n", "\r\n"]) {
    for (const yaml of ["", newline, ` \t${newline}`]) {
      for (const body of ["", `${newline}${newline}Explain a repository-only change.${newline}`]) {
        assert.deepEqual(
          validateChangesetContent(`---${newline}${yaml}---${body}`),
          [],
        );
      }
    }
  }
});

test("rejects unterminated frontmatter and delimiters outside their own lines", () => {
  for (const content of ["---\n", "---\n---invalid\n", "---\n\"@grasdouble/kitia\": minor---\n", "Summary\n---\n---\n"]) {
    assert.match(validateChangesetContent(content)[0], /frontmatter/);
  }
});

test("rejects ungrouped details, empty groups, and user-facing groups after technical", () => {
  assert.match(
    validateChangesetContent(`${frontmatter}Summary\n    - Detail.`)[0],
    /inside a User-Facing or Technical group/,
  );
  assert.match(
    validateChangesetContent(`${frontmatter}Summary\n  - **User-Facing**\n  - **Technical**\n    - Detail.`)[0],
    /User-Facing group must contain at least one detail/,
  );
  assert.match(
    validateChangesetContent(`${frontmatter}Summary\n  - **Technical**\n    - Detail.\n  - **User-Facing**\n    - Detail.\n`)[0],
    /User-Facing group must come before Technical/,
  );
});

test("rejects missing grouped details", () => {
  assert.match(validateChangesetContent(`${frontmatter}Summary`)[0], /add grouped details/);
});

test("rejects missing YAML frontmatter", () => {
  assert.match(validateChangesetContent("Summary\n  - Detail.")[0], /frontmatter/);
});
