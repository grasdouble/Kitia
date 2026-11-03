# Changelog

## Unreleased
- Show custom catalog source folders as `Catalog[folder]` in catalog browsing and details, using the saved custom path mappings.
- Allocate wider Source and Kind columns in the catalog browser while preserving ID space at narrow widths.
- Show catalog-browsing Installed, Source, Kind, ID columns and keep descriptions in selected-resource details.
- Show inventory Status, Scope, Kind, ID, Catalog columns in that order and allocate remaining table width to Catalog.
- Remove descriptions from inventory rows and show them in selected-resource details.
- Reshape the interactive Ink dashboard with resource, managed, and review summary cards above the inventory.
- Clarify confirmation modal choices with distinct selected and destructive-action styling.
- Unify selection markers across install, catalog setup, removal, and refresh dialogs; show more install-description text.
- Render modal choices and selectable catalog rows through shared Ink components.
- Keep unmanaged artifact descriptions from Markdown frontmatter available in selected-resource details; retain paths when metadata is absent.
- Keep catalog add/remove shortcuts in catalog management; open it from inventory with `M`.
- Add a dedicated catalog-management screen with `A` add, `Delete` remove, `R` refresh, and remote freshness indicators.
- Rename the product and CLI to Kitia; preserve existing `~/.config/kiti` catalogs on first use.

- Preserve configured external catalog names in installation inventories and refresh dashboard catalog data after actions.
- Preserve source-repository metadata on tracked inventory rows so external catalog associations remain visible; keep `-` for unassociated artifacts.
- List unmanaged skills, agents, and instructions in the dashboard with a `-` catalog label.
- Allow explicit dashboard removal of detected unmanaged artifacts after confirmation; remove skill folders completely while preserving files outside them.
- Remove managed skill directories and their contents when uninstalling locally managed or external skills.
- Show selected resource details in `TYPE - Name`, Catalog, Scope, Version, Locations, Details order, beside the inventory list on wide terminals and below it on narrow terminals.
- Add dashboard onboarding for multiple user catalogs, with Basic discovery of skills, agents, and instructions plus Custom user-defined paths.
- Show repository URLs while selecting a user catalog for dashboard removal; require confirmation and leave installed artifacts untouched.
- Refresh one or all user catalog metadata indexes from the dashboard or CLI.
- Treat instructions without scope metadata as global and report source-relative paths for metadata errors.
- Open the dashboard when Kitia is invoked without a command.
- Install and manage pinned external skills, agents, and instructions while keeping artifact bodies upstream.
- Keep AI resource bodies upstream; catalogs are configured by users and stored locally.
- Add catalog browsing, lifecycle management, configurable external skill indexes, MCP, and bundle support.
- Reset the installation inventory to a Kitia-owned version 1 format.
  Keep the adjacent-version migration runner for future format changes; no
  historical migrations are shipped.
