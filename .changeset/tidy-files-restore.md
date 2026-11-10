---
"@grasdouble/kitia": minor
---

Restore pre-existing managed files if a multi-file install or update fails partway through. Add opt-in deterministic text checks for pinned resources with per-file findings, explicit coverage, and install blocking when findings or skipped content are reported.

Add versioned resource-collection export/import for selected pinned GitHub resources, with prevalidated staged publication and rollback on I/O failure. Collections reference upstream content rather than bundling it.

Search results prioritize exact identifier matches, and catalog-browser details expose license and available pinned-source provenance. Detail panels wrap complete locations, descriptions, and pinned sources without truncation; wrapped inventory URLs retain a hyperlink target to the complete URL. Update-available details preserve full resource paths at narrow terminal widths and short heights. All dashboard screens and active modal flows render context-specific SHORTCUTS frames; side-by-side detail frames align and fill the column above bottom-anchored shortcuts, with every active shortcut wrapped without truncation and management panels filling the terminal height. Inventory list height remains independent of the selected detail. Pressing U opens an update confirmation with Update selected by default; cancel remains available.
Failed dashboard updates now show a contextual, dismissible error modal; recognized GitHub CLI failures explain the likely cause and action without exposing raw process output. Recoverable local update conflicts offer an explicit force-and-retry confirmation with affected paths; cancelling performs no retry. The initial update confirmation states that GH is called without --force. Only GH's explicit "skill already installed; use --force to overwrite" response opens a separate yes/no retry prompt; local safeguards still apply on that retry. Bundled skills are identified as offline and do not invoke gh.

Add optional Ed25519 signatures for resource collections with explicitly supplied trusted keys. Preserve SPDX license expressions as normalized metadata and add `--license` filtering to `list` and `search`. Add signed content bundles with verified local caches and managed offline installation for skills, agents, and instructions, rejecting cross-filesystem path aliases and unsafe Windows names without rewriting paths. Support explicit, atomic replacement of matching bundle catalog pins for subsequent offline updates.

Non-interactive delegated GitHub CLI update failures retain bounded, sanitized diagnostics for CLI users. TUI errors show only curated causes/actions, resource, agent, status, and any confirmed partial updates. Managed source-skill updates first call gh without --force; only GH's explicit already-installed/force-required response can trigger a TUI-confirmed retry with gh --force, while Kitia's local-modification and untracked-content guards remain active.
List up to 500 GitHub commit revisions for source skills with abbreviated SHA, committer date and subject in a readable table. Query the GitHub commits endpoint with GET so path and pagination fields remain query parameters. Allow installs and targeted updates to resolve unique SHA prefixes against the selected skill's listed history, without changing the catalog pin; record the selected full revision in the managed installation inventory.
Dashboard and check freshness compare the latest commits affecting each source resource's file at the installed and catalog pins, avoiding false updates from unrelated repository commits for skills, agents, and instructions.

Catalog dashboard search now matches the same resource metadata fields used by
CLI discovery, including tags, status, SPDX license data, source provenance,
and descriptive metadata. Document the intentional CLI-only validation,
diagnostic, and JSON automation interfaces.
The catalog dashboard now previews pinned source content and reports audit
findings and coverage. Dashboard installs always audit first and block when
findings exist or coverage is incomplete; preview and audit are available with
`P` and `A` in the catalog browser.
The catalog browser exposes tag, status, and license filters alongside expanded
metadata search. Skills can browse commit history and select a full revision
for catalog installs or inventory updates without changing the catalog pin.
Signed bundles and resource collections remain CLI-only because their file
paths and signing/trust inputs need explicit handling; catalog configuration
transfer remains available in the dashboard. Preview modals now bound wrapped
source output to the terminal height and clearly mark truncated content.
Dashboard loading operations show a centered blocking popup with an animated
spinner and progress label. Skill revision history loads asynchronously so the
spinner remains responsive while GitHub CLI requests are running.
