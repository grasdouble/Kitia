# Release notes

- Before creating a changeset, check whether this branch already contains one for the current work. If it does, update that file; create a new changeset only when none exists. Keep iterations on the same work in one changeset, not one changeset per iteration.
- Never edit `CHANGELOG.md` manually. For every package change that should appear in release notes, add or update a `.changeset/<name>.md` file with the correct package and semver bump. Changesets generates the changelog during versioning.
- For every feature, verify its applicability to both the CLI and TUI; implement it in every applicable interface and document any intentional interface-specific exception.
- For any change that can affect catalog artifact behavior, verify its applicability across all applicable combinations of skills, agents, and instructions; update all applicable code paths and regression tests, and document any intentional type-specific exception.
