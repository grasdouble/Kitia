# Installation inventory formats

The CLI records managed source files and ownership fingerprints in
`.agents/kitia-lock.json`. The current development format is version 1, defined
by [`catalog-lock-v1.schema.json`](../app/schemas/catalog-lock-v1.schema.json).
It stores configured external source records only: skills, agents, and
instructions.

Destination selection does not require an inventory migration. Existing
tracked `.agents/skills/` files are shown as Standard and remain managed at
their recorded paths.

This development checkout no longer supports internal catalog resources,
bundles, or MCPs. Older local lock files that contain `resources`, `bundles`, or
`mcps` fields are incompatible with this source-only format. Back up and remove
only `.agents/kitia-lock.json` to resume with an empty inventory; installed
files are left untouched and can be rediscovered as unmanaged artifacts.

No historical migrations are shipped. `kitia migrate` remains the runner for
future inventory format changes; current version 1 inventories are skipped.
For a real apply, the runner acquires the same target lock as other Kitia
writes, then rereads and validates the inventory under that lock. It creates a
timestamped backup of those original bytes before replacing the inventory.
An active operation prevents apply. A dry run or an already-current target
does not acquire a lock or create a backup.

Do not edit `lock_version` by hand or use `--force` as a migration mechanism.
