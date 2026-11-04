# Installation inventory formats

The CLI records managed source files and ownership fingerprints in
`.agents/kitia-lock.json`. The current development format is version 1, defined
by [`catalog-lock-v1.schema.json`](../cli/schemas/catalog-lock-v1.schema.json).
It stores configured external source records only: skills, agents, and
instructions.

This development checkout no longer supports internal catalog resources,
bundles, or MCPs. Older local lock files that contain `resources`, `bundles`, or
`mcps` fields are incompatible with this source-only format. Back up and remove
only `.agents/kitia-lock.json` to resume with an empty inventory; installed
files are left untouched and can be rediscovered as unmanaged artifacts.

No historical migrations are shipped. `Kitia migrate` remains the runner for
future inventory format changes; current version 1 inventories are skipped.
The runner validates any converted inventory, creates a timestamped backup
before writing, and refuses to proceed if an operation lock exists or records
conflict.

Do not edit `lock_version` by hand or use `--force` as a migration mechanism.
