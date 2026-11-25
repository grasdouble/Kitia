# Release notes

- Before creating a changeset, check whether this branch already contains one for the current work. If it does, update that file; create a new changeset only when none exists. Keep iterations on the same work in one changeset, not one changeset per iteration.
- Never edit `CHANGELOG.md` manually. For every package change that should appear in release notes, add or update a `.changeset/<name>.md` file with the correct package and semver bump. Changesets generates the changelog during versioning.
- For every feature, verify its applicability to both the CLI and TUI; implement it in every applicable interface and document any intentional interface-specific exception.
- For any change that can affect catalog artifact behavior, verify its applicability across all applicable combinations of skills, agents, and instructions; update all applicable code paths and regression tests, and document any intentional type-specific exception.

## Formatting

- After editing files, run `pnpm exec oxfmt <file>...` before handing off or committing. Pass only the files you modified that are covered by the repository's `format` script; do not run the workspace-wide formatter.

## Dashboard colors

- Source dashboard colors from `terminal/src/tui/colors.ts`; screens and components MUST use theme tokens instead of defining color literals locally.
- Add or change semantic color roles in `DASHBOARD_THEME.semantic`, preserving their meaning; keep renderer-specific ANSI mappings in `terminalAnsi` and title-gradient stops in `titleGradientStops`.
- Selected rows MUST use the theme's selected color, overriding the row's semantic or fallback color.
