# Kitia local web: implementation plan

**Worktree:** `kitia-web` · **Branch:** `noofreuuuh/kitia-web`

`kitia web` is a native browser interface for people who do not want to use the terminal dashboard. A single command starts a private session; the first screen is the inventory for the project that launched it. Parity means the same supported actions, results, and safety guarantees as the TUI, not a recreation of its keyboard shortcuts or layout.

## Lots and current status

| Lot | Status | Scope |
| --- | --- | --- |
| 1. Package layout | Committed · `6fda049` | Rename `terminal/` to `app/` without changing `@grasdouble/kitia`, the `kitia` executable, or user data formats. |
| 2. Shared operations | Committed · `93405f3` | Move interactive operations and worker contracts into `app/src/application/`; keep presentation separate. |
| 3. Local web session | Committed · `7fa5caa` | Package and launch the browser client, pin the targets, and authenticate the loopback API. |
| 4. Inventory | Committed · `0b896d6` | Project/User views, counts, search, filters, details, installed-file preview and audit, per-scope errors. |
| 5. Browse resources | Committed · `1816661` | Search and filter catalog entries, inspect provenance, preview and audit pinned source, and browse commit history. |
| 6. Install | Committed · `e6f9be5` | Review scope, destinations, and pin; run the shared audited install and report partial results. |
| 7. Inventory maintenance | Committed · `e3b032a` | Update, uninstall, and remove unmanaged artifacts; separate confirmation for destination-specific GitHub CLI overwrite retries. |
| 8. Choose a revision | Committed · `397c003` | Select a commit from resource history for a new installation or a replacement that preserves existing destinations. |
| 9. Catalog management | Committed · `4717746` | Basic/Custom mappings and presets, edit and remove, freshness and refresh (one/all), selective JSON import and JSON export. Removal leaves installed files in place. |
| 10. Getting started and maintenance | Implemented; not committed | Reopenable welcome guide, version and release notices, eligible self-update after server shutdown, and scoped inventory migration guidance. |
| 11. Parity and package acceptance | Pending final pass | Close the known UI parity gaps and verify the installed package end to end on Linux, macOS, and Windows. |

## Resume here

1. Commit the getting-started and maintenance lot.
2. Finish lot 11 before calling the browser interface TUI-equivalent:
   - Add the second explicit confirmation for unmanaged removal. The current browser flow has one confirmation after reviewing the paths.
   - Add the TUI-style retry for recoverable local update conflicts, with affected paths and separate consent. The current browser supports only destination-specific GitHub CLI overwrite retries; local overrides remain in the CLI/TUI. Never force a provenance conflict or silently overwrite another owner's files.
   - Check whether long operations need to surface worker progress beyond the current working indicator and final/partial result. Keep all failures visible and preserve the selected resource and filters where applicable.
   - Exercise startup, browser opening or `--no-open` fallback, a real scoped installation, and `Ctrl+C` shutdown from the installed tarball on **Linux, macOS, and Windows**. Browser checks to date used WebKit on macOS; they are not cross-platform acceptance.

Lot 9 verification: `pnpm app:test:package-smoke` (three passing session tests), eight targeted core/TUI tests, and WebKit checks of Custom add, rename, refresh, selective import, and export download using isolated Git fixtures.

## Architecture and acceptance constraints

- `app/src/web/client/` is React; `app/src/web/server/` serves the packaged client and API. Share operations through `app/src/application/` and rules through `app/src/core/`, not through a CLI subprocess or by embedding Ink. Root `web/` remains the public site; `/demo` and `/demo-keep` stay simulated and never connect to the local server.
- The [CLI contract](cli-contract.md) is the reference for current behavior. Serve on `127.0.0.1` with a system-assigned port; require the per-launch session token, validate Host and mutation Origin, and accept no browser-supplied filesystem destinations or shell commands. Keep project/user targets fixed and retain the core operation locks and safety checks.
- Check skills and agents in Project and User scope, and instructions in Project scope only. Test all applicable destinations and multi-destination operations: Standard, Copilot, Claude Code, and Mistral Vibe for skills; Copilot and Claude Code for agents and instructions. Keep the current TUI defaults: User for skills and agents, Project for instructions; Standard for skills, Copilot for agents and instructions.
- Keep the pinned-source and installed-file inspections distinct. Check audit coverage, blocked installs, selected revisions, partial operations, tracked paths, unavailable catalogs/scopes, and failures that must leave existing files untouched. Keep CLI and TUI behavior intact.
- Use `pnpm app:test:package-smoke` for the packaged server/client and add or run the narrow native tests for shared changes. Use `pnpm docs:test` and update [the existing Changeset](../.changeset/thin-pens-hear.md) for release notes. Do not edit the generated changelog.
- Out of scope for TUI parity: `doctor`, `validate`, JSON automation output, and resource collection transfer. Catalog configuration JSON transfer is in scope and implemented.
