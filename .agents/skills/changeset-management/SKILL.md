---
name: changeset-management
description: Use when creating or updating a Changeset for repository work. Enforces the repository's summary-and-bullets format, release bump policy, and no-bump exception.
---

# Changeset management

Use this skill when a user requests a Changeset or when repository work requires one. Do not use it to edit generated changelogs or package versions.

## Determine whether a Changeset is needed

1. Identify the current work and whether it changes the published `@grasdouble/kitia` package.
2. For user-facing package changes, create a release Changeset with the smallest appropriate bump: `patch` for fixes, `minor` for backward-compatible features, or `major` for breaking changes.
3. For repository-only work that does not need a package release (CI, tests, contributor skills, or documentation), create an empty no-bump Changeset using `pnpm exec changeset add --empty` and optionally `--message "..."`.
4. Before creating a file, inspect `.changeset/` for a Changeset already associated with this work. Update that file when continuing the same work; do not create one file per iteration. Do not merge unrelated work into an existing Changeset.

## Write the repository format

A non-empty Changeset has valid YAML frontmatter naming the package and bump, then one short description followed by indented detail bullets:

```md
---
"@grasdouble/kitia": minor
---

Short description
  - Details 1
  - Details 2
```

Use exactly two spaces before each `- ` detail. Keep the summary on one unindented line. Put each detail on its own bullet; do not use free-standing paragraphs, blank lines between details, or nested bullets. Write release notes in English unless the user specifies another language. Empty-frontmatter no-bump Changesets may carry an optional message and do not use this body format.

## Create or update safely

- Preserve facts from the implementation; do not invent behavior or combine unrelated changes.
- Keep the description concise and user-facing. Include only release-worthy behavior in a package Changeset.
- Reuse the existing Changeset for an iteration of the same work. When creating a new one, choose an unused filename under `.changeset/`.
- When updating a non-empty Changeset, review the entire summary and detail list. Merge duplicate or overlapping information, replace superseded claims, and add only genuinely new details; do not append blindly.
- Do not edit `CHANGELOG.md`, package versions, or generated release files manually.

## Verify

Run:

```sh
pnpm run changeset:format
pnpm changeset status
```

The first command checks the repository's summary-and-bullets style and permits empty-frontmatter no-bump Changesets. The second validates Changesets metadata, package references, and the computed release plan. For repository-only work, confirm the new entry has empty frontmatter; another Changeset on the branch may independently plan a package release.
