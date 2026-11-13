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

Use one concise, user-facing sentence as the summary, followed by grouped details. Keep each detail specific, understandable without knowledge of internal code, and written in English. Describe outcomes, not implementation steps.

Group details under bold bullet labels. Use two spaces before each group label and four spaces before its detail bullets:
- **User-Facing**
- **Technical**

The User-Facing group MUST always come first. Keep each group together; never interleave them. Omit a group when it has no relevant details. Include technical changes only when they have a meaningful release impact; omit internal refactors with no user-relevant impact.

```md
---
"@grasdouble/kitia": patch
---

Improve catalog discovery and update reliability
  - **User-Facing**
    - Search catalogs by license, source, and description.
    - Replace a resource with a selected commit through the existing update workflow.
  - **Technical**
    - Prevent partial installs from leaving managed files in an inconsistent state.
```

The first sentence becomes the release-note headline. Group labels and their nested bullets form the details in the generated changelog. Avoid blank lines between the summary and details, ungrouped detail bullets, commit links, and vague statements such as "Various improvements".


## Release-note constraints

- Do not edit `CHANGELOG.md` or package versions manually for routine releases; Changesets generates them during versioning.
- Do not add commit links to the Changeset summary. The website handles commit links when rendering generated changelog entries.
- Keep all details relevant to the summary, specific, and understandable without knowledge of internal code.
- Update the existing Changeset for the same work rather than adding one per iteration.
