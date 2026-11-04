# Kitia inventory migrations

User-facing format details and runner instructions live in
[`docs/inventory-migrations.md`](../docs/inventory-migrations.md).

Inventory version 1 is the current source-only format. No historical migrations
are shipped; `run.js` starts with an empty `MIGRATIONS` registry. For a future
format change, add an adjacent `vN-to-vN+1.js` pure transformation, register it
in `MIGRATIONS`, and add deterministic tests. The runner enforces consecutive
versions, previews by default, validates the result, and creates a backup before
applying it.