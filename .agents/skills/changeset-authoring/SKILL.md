---
name: changeset-authoring
description: Create or update Kitia Changesets for user-facing changes, using the repository's concise summary and nested-details format. Use when a change needs a Changeset or when reviewing one.
---

# Authoring Kitia Changesets

Create a Changeset for user-facing package changes. Follow the repository's versioning instructions in `CONTRIBUTING.md` and any applicable `AGENTS.md` files.

## Before writing

1. Inspect the current branch's changes and identify the user-visible behavior that changed.
2. Check `.changeset/` for an existing Changeset covering this work. Update it instead of creating a second Changeset for another iteration of the same work.
3. Choose the `@grasdouble/kitia` bump:
   - `patch` for compatible fixes and small improvements.
   - `minor` for backwards-compatible functionality.
   - `major` for breaking changes to the public CLI, package, or documented contract.
4. For repository-only changes that do not need a package release, use the repository's empty no-bump Changeset process instead of inventing a package summary.

## Required format

Use one concise, user-facing sentence as the summary, followed by a short list of concrete details. Keep each detail on its own line. Write in English and describe outcomes, not implementation steps.

```md
---
"@grasdouble/kitia": patch
---

Add ready-to-use catalogs for Anthropic and GitHub Awesome Copilot.
- Discover skills, agents, and instructions from the dashboard or CLI.
- Support Copilot agent display names and filenames.
- Keep refreshes scoped to the selected catalog.
```

The first sentence becomes the release-note headline. The following `- ` lines become nested details in the generated changelog. Avoid blank lines between the summary and its detail bullets, extra top-level bullets, commit links, and vague statements such as "Various improvements".

## Release-note constraints

- Do not edit `CHANGELOG.md` or package versions manually for routine releases; Changesets generates them during versioning.
- Do not add commit links to the Changeset summary. The website handles commit links when rendering generated changelog entries.
- Keep all details relevant to the summary, specific, and understandable without knowledge of internal code.
- Update the existing Changeset for the same work rather than adding one per iteration.
