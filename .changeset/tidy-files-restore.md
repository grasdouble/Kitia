---
"@grasdouble/kitia": minor
---

Improve source catalog safety and dashboard parity
  - Restore pre-existing managed files when a multi-file install or update fails partway through.
  - Add deterministic audits for pinned resources, with per-file findings, explicit coverage, and install blocking when findings or skipped content are reported.
  - Support versioned resource-collection export/import with staged publication and rollback; add optional Ed25519 signatures and trusted-key verification.
  - Preserve normalized SPDX license expressions and add `--license` filtering to `list` and `search`.
  - Expand dashboard search and filters across metadata, tags, status, license, source provenance, and descriptions.
  - Improve dashboard detail panels so locations, descriptions, pinned sources, and wrapped inventory URLs remain complete and usable.
  - Add contextual update errors and explicit confirmation before retrying GitHub CLI updates with `--force`; retain local-modification safeguards.
  - List GitHub commit history for source skills, agents, and instructions and allow a selected full SHA for installs and targeted updates without changing catalog pins.
  - Compare freshness using commits affecting each resource file, avoiding false updates from unrelated repository commits.
  - Add source preview and audit screens; audit installs first and block when findings exist or coverage is incomplete.
  - Add tag, status, and license filters to the catalog browser and allow selecting a revision for catalog installs or inventory updates of skills, agents, and instructions.
  - Keep resource-collection import/export CLI-only because file paths and optional signing/trust inputs need explicit handling; dashboard transfer remains limited to catalog configuration.
  - Paginate source preview from a tree-only first page through each file in order, retain complete metadata, and color labels and values consistently.
  - Show a centered animated loader during blocking dashboard work and load revision history asynchronously while GitHub CLI requests run.
  - Expand dashboard tables to available list width and prioritize catalog names, IDs, and repositories over padding in short status and count columns; terminal tables adapt while piped output retains complete values.
  - Centralize dashboard row-color resolution: known kinds keep their palette, selection overrides with blue, and unknown kinds retain inventory-status or proprietary-license fallbacks.
  - Mark the selected row with a consistent `›` across inventory, catalog browsing, and catalog management.
  - Centralize dashboard semantic colors, modal RGB values, the title gradient, and terminal ANSI codes in one editable theme module.
