# Changelog

## Unreleased
- Reorient the public website around Kitia's local dashboard, external catalogs, and metadata-only public index.
- Rename the product and CLI to Kitia; preserve existing `~/.config/kiti` catalogs on first use.
- Keep user-local catalog sources out of the public site build.

- Preserve configured external catalog names in installation inventories and refresh dashboard catalog data after actions.
- List unmanaged skills, agents, and instructions in the dashboard with a `-` catalog label.
- Allow explicit dashboard removal of detected unmanaged artifacts after confirmation; remove skill folders completely while preserving files outside them.
- Remove managed skill directories and their contents when uninstalling internal or external skills.
- Show selected resource details in `TYPE - Name`, Catalog, Scope, Version, Locations, Details order, beside the inventory list on wide terminals and below it on narrow terminals.
- Add dashboard onboarding for multiple user catalogs, with Basic discovery of skills, agents, and instructions plus Custom user-defined paths.
- Show repository URLs while selecting a user catalog for dashboard removal; require confirmation and leave installed artifacts untouched.
- Refresh one or all user catalog metadata indexes from the dashboard or CLI.
- Treat instructions without scope metadata as global and report source-relative paths for metadata errors.
- Open the dashboard when Kitia is invoked without a command.
- Install and manage pinned external skills, agents, and instructions while keeping artifact bodies upstream.
- Leave Kitia's internal catalog empty; ship no first-party AI resource bodies.
- Add catalog browsing, lifecycle management, configurable external skill indexes, MCP and bundle support, and a static catalog website.
- Reset the installation inventory to a Kitia-owned version 1 format.
  Keep the adjacent-version migration runner for future format changes; no
  historical migrations are shipped.
