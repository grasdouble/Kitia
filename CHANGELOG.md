# Changelog

## 1.1.0

### Minor Changes

- c4aa7ea: Add versioned catalog configuration import/export commands; imports merge validated definitions, skip conflicting names or repositories, refresh newly added catalogs, and summarize additions, ignored entries, and refresh failures. The dashboard imports pasted JSON, lets users review and select individual catalogs before importing, copies exports to the system clipboard, and provides presets for Matt Pocock and Anthropics.
  - Refresh the dashboard header with a pixel-style KITIA wordmark and a seated ASCII cat. Both share an animated cyan/violet/pink gradient; the cat occasionally licks its paw, scratches its ear, or winks. Show the version before the screen name and use a compact text title on narrow terminals.
  - Fix overlapping panel headings and counters, account for the taller header when sizing lists, and label the NEEDS REVIEW summary count as "warning(s)" instead of "attention".
  - Notify users when a newer npm release is available, with a popup showing installed and available versions and a changelog link.
  - Add an interactive first-run dashboard tour that can be reopened with `kitia onboarding` or `?`. Ensure onboarding scans the current project directory and restore the dashboard as the default when running `kitia` without arguments.

## 1.0.1

### Patch Changes

- 02a46d9: Include the MIT license metadata and license file in the published npm package.

## 1.0.0

### Major Changes

- be99455: Release Kitia 1.0.0, a CLI and dashboard for managing external AI-resource catalogs and installing their skills, agents, and instructions into Claude Code and GitHub Copilot. Kitia keeps catalog metadata locally, leaves resource content in upstream repositories, and supports discovery, search, preview, install, update, uninstall, inventory checks, and machine-readable reports with protection for locally modified files. Includes the public npm package, documented CLI contract, and project website.

