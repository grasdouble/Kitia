---
"@grasdouble/kitia": minor
---

Redesign Inventory, Browse, and Catalogs around compact summaries and focused terminal workspaces
  - **User-Facing**
    - Show Inventory kind, ID, description, and installed catalog, license, revision, and path in that order; keep optional metadata available after the core details, and surface Browse pinned-source details on compact or short screens.
    - Keep Inventory and Browse actions specific to the selected resource and pair them when space allows without a redundant heading; only show Update when eligible, while retaining the direct Inventory install shortcut and Browse install behavior.
    - Search and filter, switch sections, select rows or catalog cards, and activate rounded outlined actions with mouse clicks or keyboard controls; filter selectors open compact menus anchored beneath their fields, and keyboard navigation follows the visible control order.
    - Keep unfiltered counts on the Inventory, Browse resources, and Catalogs tabs in a full-width bordered strip with muted inactive labels and a padded primary-color selected underline; retain bordered search, outlined filters, and semantic action emphasis in the terminal rendering.
    - Adapt controls and summaries for short terminals, using single-row side-bordered fields below 40 rows and compact summaries at short heights.
    - Page through complete Inventory and Browse metadata with PageUp/PageDown when details exceed the terminal viewport, while keeping contextual actions reachable.
    - Use the mouse wheel to navigate resource lists and catalog cards, scroll selection details, or page through the active preview pane.
    - Select a visible resource or catalog card without jumping to a different part of the list.
    - Keep scrolling and clicking available after reaching a list boundary or clicking the active tab again.
    - Show keyboard hints in a bordered Shortcuts panel on Inventory, Browse, and Catalogs.
    - Manage connected catalogs through selectable cards with contextual Add, Edit, Refresh, and Remove actions.
    - Keep the header focused on the animated mascot, a bolder four-line KITIA wordmark, and a labeled installed version (for example, `Version 2.0.0`). Section counts and filters stay in their own controls.