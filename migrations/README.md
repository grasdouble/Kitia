# Kiti inventory migrations

User-facing format details and runner instructions live in
[`docs/inventory-migrations.md`](../docs/inventory-migrations.md).

Only inventory version 1 exists today; `run.js` intentionally starts with an
empty `MIGRATIONS` registry. When a future version is needed, add an adjacent
`vN-to-vN+1.js` pure transformation and register it in `MIGRATIONS`. The
runner enforces consecutive versions, previews by default, validates the
result, and creates a backup before applying it. Cover each new step in
`tests/migrations.test.js`.
