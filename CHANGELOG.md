# Changelog

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