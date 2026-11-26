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
| 10. Getting started and maintenance | Committed · `38eb0a4` | Reopenable welcome guide, version and release notices, eligible self-update after server shutdown, and scoped inventory migration guidance. |
| 11. Parity and package acceptance | Implemented; Linux and Windows runs pending | Two-step unmanaged removal, recoverable local conflicts with scoped consent, live operation progress, and packaged startup and shutdown checks. |

## Package acceptance

- The browser uses the same artifact and scope rules as the CLI and TUI. The separate browser consent is backed by one-use tokens; local overwrite approval is limited to the reviewed file contents and never permits replacing a different owner's files.
- The packaged smoke tests exercise real scoped filesystem changes from fixture catalogs for skills, agents, and instructions; they do not contact GitHub. The existing CI job runs those tests on Linux, macOS, and Windows.
- The browser-launch smoke test checks the platform command and manual fallback using an intercepted launcher, without opening a real desktop browser. Shutdown uses an OS `SIGINT` on Unix and exercises the same handler through IPC on Windows; a physical Windows console `Ctrl+C` and real default-browser launch still need a desktop acceptance run.
- Verified on macOS: five packaged web-session tests and eight native installation lifecycle tests. WebKit confirmed a project-scoped agent install, the second unmanaged removal dialog, and a local conflict that preserved the edited file until explicit retry.

Lot 9 verification: `pnpm app:test:package-smoke` (three passing session tests), eight targeted core/TUI tests, and WebKit checks of Custom add, rename, refresh, selective import, and export download using isolated Git fixtures.

## Architecture and acceptance constraints

- `app/src/web/client/` is React; `app/src/web/server/` serves the packaged client and API. Share operations through `app/src/application/` and rules through `app/src/core/`, not through a CLI subprocess or by embedding Ink. Root `web/` remains the public site; `/demo` and `/demo-keep` stay simulated and never connect to the local server.
- The [CLI contract](cli-contract.md) is the reference for current behavior. Serve on `127.0.0.1` with a system-assigned port; require the per-launch session token, validate Host and mutation Origin, and accept no browser-supplied filesystem destinations or shell commands. Keep project/user targets fixed and retain the core operation locks and safety checks.
- Check skills and agents in Project and User scope, and instructions in Project scope only. Test all applicable destinations and multi-destination operations: Standard, Copilot, Claude Code, and Mistral Vibe for skills; Copilot and Claude Code for agents and instructions. Keep the current TUI defaults: User for skills and agents, Project for instructions; Standard for skills, Copilot for agents and instructions.
- Keep the pinned-source and installed-file inspections distinct. Check audit coverage, blocked installs, selected revisions, partial operations, tracked paths, unavailable catalogs/scopes, and failures that must leave existing files untouched. Keep CLI and TUI behavior intact.
- Use `pnpm app:test:package-smoke` for the packaged server/client and add or run the narrow native tests for shared changes. Use `pnpm docs:test` and update [the existing Changeset](../.changeset/thin-pens-hear.md) for release notes. Do not edit the generated changelog.
- Out of scope for TUI parity: `doctor`, `validate`, JSON automation output, and resource collection transfer. Catalog configuration JSON transfer is in scope and implemented.
