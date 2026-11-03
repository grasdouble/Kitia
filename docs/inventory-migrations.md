# Installation inventory formats

The CLI records managed files, ownership, and content fingerprints in
`.agents/kitia-lock.json`. The current and only supported format is version 1,
defined by [`schemas/catalog-lock-v1.schema.json`](../schemas/catalog-lock-v1.schema.json).
It stores locally managed resources, configured source records, bundles, and MCP state.

This repository is not yet in production, so it ships no historical inventory
schemas or migration transformations. `Kitia migrate` remains as the runner for
future upgrades; today, it reports current inventories as skipped.

When a later format is introduced, add only the adjacent transformation
`migrations/v1-to-v2.js`, register it in `MIGRATIONS` in `migrations/run.js`,
and add deterministic tests. The runner previews by default, validates the
converted inventory, creates a timestamped backup before writing, and refuses
to proceed if an active catalog operation lock exists or records conflict.

Preview the project and user inventories:

```sh
npx --yes github:grasdouble/Kitia migrate
```

Apply only after reviewing the preview:

```sh
npx --yes github:grasdouble/Kitia migrate --apply
```

Do not edit `lock_version` by hand or use `--force` as a migration mechanism.
