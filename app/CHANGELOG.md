# Changelog

## 4.0.1

### Patch Changes

- 83d511e: Explain skill installation failures caused by an existing destination
  - **User-Facing**
    - When GitHub CLI refuses to overwrite a skill folder, identify the local conflict and explain how to preserve the existing files before retrying.
- 83d511e: Clarify the dashboard's Install Options buttons
  - **User-Facing**
    - Review an installation with Validate or a revision replacement with Replace. Both buttons sit next to Cancel on the right.

## 4.0.0

### Major Changes

- f71b48a: Choose one or more installation destinations in the CLI and dashboard
  - **User-Facing**
    - Skills default to the shared `.agents/skills/` directory, with dedicated GitHub Copilot, Claude Code, and Mistral Vibe locations available in project and user scope.
    - Replace `--tool` and `both` with repeatable `--destination` options. Use `--destination standard` to keep the location previously selected by `--tool copilot` for skills.
    - Select multiple destinations in a dropdown styled like the Inventory filters, add copies without replacing existing ones, and review full paths before installing, updating, or uninstalling.
    - The dashboard lists User first and selects it by default for skills and agents. Scope and Destinations use the same dropdown style. The CLI continues to default to project scope.
    - Use Review install to check selected paths before confirming, or Cancel to return to the catalog without installing.
    - Stay on the dashboard section that started a resource action, including after a Browse installation or update finishes.
    - Keep the dashboard section tabs visible during resource dialogs and progress popups when terminal space allows.
    - See the underlying inventory error directly in Install Options when a scope is unavailable.
    - See the selected artifact's installation destinations under Installed for in Inventory.
    - Existing tracked skills stay in place and require no inventory migration. Agents and instructions keep their native formats; instructions remain project-only.

### Patch Changes

- f71b48a: Improve resource audit accuracy and failure details
  - **User-Facing**
    - Do not flag references to existing ignore rules or explicit prohibitions against disclosing secrets as requests to override instructions or expose secrets.
    - Audited installs still block when rules detect a finding or coverage is incomplete.
    - Read coverage details and findings in the dashboard's installation failure popup, with paging for longer reports.

## 3.0.0

### Major Changes

- 909f895: Redesign the terminal dashboard, add self-update, and make catalog installs more reliable.
  - **User-Facing**
    - Replace direct calls to `cli/bin/kitia.js` and `cli/migrations/run.js` with `kitia` and `kitia migrate`. For direct execution, the new entry point is `dist/kitia.js` in the npm package and `terminal/dist/kitia.js` in a built checkout.
    - Kitia no longer reads or copies `~/.config/kiti` automatically. Set `KITIA_CONFIG_DIR` to the old directory or copy it to `~/.config/kitia` if that destination does not exist.
    - A human-readable source-skill install now reports a failed GitHub CLI command as `GH_INSTALL_FAILED` and exits with status `1` instead of forwarding the delegated status. Preview may still forward it.
    - From any dashboard section, use `I` for Inventory, `B` for Browse resources, and `M` for Manage Catalogs. Use `B` instead of `A` to browse installable resources from Inventory, and `Shift+I` instead of `I` to import catalog configuration.
    - Use `Q` to quit and `I` to return to Inventory. `Esc` still dismisses menus and dialogs, but no longer switches sections or quits.
    - Find keyboard shortcuts under Actions, Filters, Display, and Navigation, with `?` for the guide under Display. Section tabs show unfiltered counts.
    - Use the mouse wheel over resource lists, catalog cards, selection details, or the active preview pane. Clicking a visible row preserves the current scroll position, and reaching a list boundary or clicking the active tab no longer interrupts pointer input.
    - Search and filter with the keyboard or mouse. Filter menus open below their fields, and keyboard focus follows the visible control order.
    - Page through long Inventory and Browse details with PageUp/PageDown, including immediately after resizing the terminal. Long catalog labels wrap inside the details pane, and Browse shows the pinned source even on compact layouts.
    - See only the actions that apply to the selected resource, including Update only when available. Browse actions remain within the details pane at 120×24.
    - Manage connected catalogs from a card list with Add and Presets above the list and Edit, Refresh, and Remove on the selected card.
    - See the installed Kitia version in the dashboard header.
    - Update global npm or pnpm installations with `kitia self-update` or **Update** in the dashboard version notice. Use `--yes` to skip confirmation in non-interactive sessions. Local dependencies, launcher caches, linked checkouts, and installations of unknown origin are left untouched.
    - Audit selected-revision replacements before writing when an audit is requested. Restore agent and instruction files if inventory publication fails; use `--tool both` or `kitia update` to advance shared revisions without leaving a tracked client behind.
    - Apply instructions without frontmatter to all project paths and use the chosen revision's path patterns when installing or updating. Accept Windows line endings in resource frontmatter without changing the Markdown body.
    - Keep healthy catalogs visible when another index is missing or invalid, preserve indexes during case-only renames, and reject reserved names for new catalogs without invalidating existing inventories.
    - Keep installed skills tracked when other resource kinds share their IDs. Allow `uninstall --catalog` for removed catalogs and preserve the recovery backup if a collection import cannot restore a file.
    - Keep update results and retry details consistent with or without progress output. Dashboard failures retain warnings, audit details, and the actual inventory after partial failure.
    - Make top-level `--help` and `doctor --network` work as documented.
  - **Technical**
    - Reuse pinned checkouts for agent and instruction previews, installs, and bulk updates. Unaudited dry runs do not fetch source content, and asynchronous GitHub CLI operations remain non-interactive by default.

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
