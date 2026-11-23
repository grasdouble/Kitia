# Changelog

## 2.0.0

### Major Changes

- 47cd156: Raise the minimum supported Node.js version to 26
    - **User-Facing**
      - Require Node.js 26 or newer; Node.js 22 and 24 are no longer supported.
    - **Technical**
      - Align continuous integration with Node.js 26.

### Minor Changes

- 47cd156: Improve source catalog workflows and dashboard usability
    - **User-Facing**
      - Restore pre-existing managed files when a multi-file install or update fails partway through.
      - Audit pinned resources with per-file findings and explicit coverage; block installs when findings or skipped content are reported.
      - Export and import versioned resource collections with staged publication and rollback, optional Ed25519 signatures, and trusted-key verification.
      - Preserve normalized SPDX license expressions and filter `list` and `search` by license.
      - Search dashboard catalogs across metadata, tags, status, license, source provenance, and descriptions.
      - Filter Catalog by kind and license, and filter Inventory by license using source catalog metadata.
      - View complete locations, descriptions, pinned sources, and wrapped inventory URLs in dashboard detail panels.
      - Get contextual update errors and explicit confirmation before retrying GitHub CLI updates with `--force`, while retaining local-modification safeguards.
      - Replace a tracked source resource with a selected commit through existing update safeguards in the CLI and dashboard.
      - Avoid false update notifications from unrelated repository commits by comparing commits that affect each resource file.
      - See audit results and the source tree together in TUI Preview, replacing the separate Audit action.
      - Keep resource-collection import and export CLI-only when file paths, signing, or trust inputs are needed; dashboard transfer remains limited to catalog configuration.
      - Navigate source previews file by file with complete metadata, consistent label and value colors, and a distinct source, page, and filename header.
      - Paginate Preview by source file without treating Markdown table separators as filenames.
      - Read Markdown and code in TUI source Preview with syntax highlighting that prevents emphasis colors from bleeding across content, without changing source text or pagination.
      - Preview and audit current local files for managed and unmanaged Inventory resources, including multiple installations with navigable paths; missing or unsafe paths fail Preview. Catalog and CLI previews remain pinned-source based.
      - Use themed content headers and dividers across Inventory, Catalog, Catalog Management, and Preview panels, with table metadata and filters above the divider and shortcut category headings above their shortcuts.
      - Show a centered loader and factual GitHub CLI/file-update phases in the dashboard, relay sanitized GitHub output, and stop hung GitHub CLI installs or updates with an actionable timeout error.
      - Use dashboard tables that expand to available width and prioritize catalog names, IDs, and repositories over padding; terminal tables adapt while piped output retains complete values.
      - Keep confirmation modal borders intact on narrow terminals and render them in the warning accent color.
      - Keep known dashboard kind colors, show selected rows in blue, and retain inventory-status or proprietary-license fallbacks for unknown kinds.
      - Identify selected rows consistently with `›` across inventory, catalog browsing, and catalog management.
      - Exit the interactive dashboard when its input stream closes.
      - Skip the npm update lookup when the installed version is unknown.
      - See compact inline details and shortcuts on short stacked inventory screens so panel borders and complete issue paths remain visible.
      - Search Inventory on small terminals with a visible prompt and apply/clear hints.
      - Load packaged CLI dashboards successfully with the shared table-layout module included in the published package.
      - Keep dashboard semantic colors, modal RGB values, the title gradient, and terminal ANSI codes together in one editable theme module.
    - **Technical**
      - Keep all source catalog, file-resource, and dashboard flows on shared lifecycle and update safeguards.

## 1.1.1

### Patch Changes

- a87cce3: Track key interactions on the Kitia website.
  - Measure site visits and navigation actions with Google Analytics.
- d42f086: Publish a versioned changelog on the website.
  - Show release details beneath a concise summary.
  - Add a direct link to each release and its source commit.
  - Parse release notes correctly with Windows-style line endings.
  - Serve the changelog as a static HTML entry so GitHub Pages resolves `/changelog` directly.
- 3e186c6: Add ready-to-use catalogs for Anthropic and GitHub Awesome Copilot.
  - Discover skills, agents, and instructions from the dashboard or CLI.
  - Support Copilot agent display names and filenames.
  - Keep refreshes scoped to the selected catalog.

## 1.1.0

### Minor Changes

- c4aa7ea: Expand catalog workflows and improve the dashboard experience.
  - Import and export versioned catalog configurations from the CLI or dashboard. Validate imports, skip conflicting names or repositories, refresh new catalogs, and report the results.
  - Review and select catalogs from pasted JSON in the dashboard; copy exports to the clipboard and use the Matt Pocock or Anthropic presets.
  - Refresh the dashboard header with a pixel-style KITIA wordmark and animated mascot. Use a compact title on narrow terminals.
  - Fix overlapping dashboard headings and counters, adjust list sizing for the taller header, and label review counts as warnings.
  - Notify users when a new npm version is available, with installed and available versions and a link to the changelog.
  - Add an interactive first-run tour, reopenable with `kitia onboarding` or `?`. Scan the current project and open the dashboard by default when running `kitia`.

## 1.0.1

### Patch Changes

- 02a46d9: Include the MIT license in the published npm package.
  - Add MIT license metadata.
  - Include the license file in the package.

## 1.0.0

### Major Changes

- be99455: Release Kitia, an interactive terminal UI and CLI for managing AI resource catalogs.
  - Browse external catalogs of skills, agents, and instructions for Claude Code and GitHub Copilot.
  - Search, preview, install, update, and uninstall resources.
  - Keep catalog metadata local while resource content stays in its upstream repository.
  - Check inventories with machine-readable reports and protect locally modified files.
  - Publish the npm package, CLI contract, and project website.