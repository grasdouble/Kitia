---
"@grasdouble/kitia": minor
---

Restore pre-existing managed files if a multi-file install or update fails partway through. Add opt-in deterministic text checks for pinned resources with per-file findings, explicit coverage, and install blocking when findings or skipped content are reported.

Add versioned resource-collection export/import for selected pinned GitHub resources, with prevalidated staged publication and rollback on I/O failure. Collections reference upstream content rather than bundling it.

Search results prioritize exact identifier matches, and catalog-browser details expose license and available pinned-source provenance.

Add optional Ed25519 signatures for resource collections with explicitly supplied trusted keys. Preserve SPDX license expressions as normalized metadata and add `--license` filtering to `list` and `search`. Add signed content bundles with verified local caches and managed offline installation for skills, agents, and instructions, rejecting cross-filesystem path aliases and unsafe Windows names without rewriting paths. Support explicit, atomic replacement of matching bundle catalog pins for subsequent offline updates.
