---
"@grasdouble/kitia": major
---

Redesign the terminal dashboard, add self-update, and make catalog installs more reliable.
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