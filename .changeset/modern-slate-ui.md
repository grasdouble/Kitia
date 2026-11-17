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
    - Manage connected catalogs through selectable cards with contextual Add, Edit, Refresh, and Remove actions.
    - Restore the original animated cat and gradient KITIA wordmark while retaining the redesigned section tabs.