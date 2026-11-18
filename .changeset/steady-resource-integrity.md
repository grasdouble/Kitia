---
"@grasdouble/kitia": major
---

Stop automatically migrating legacy Kiti settings and improve resource and catalog reliability.
  - **User-Facing**
    - Kitia no longer reads or copies `~/.config/kiti` by default and leaves the old files untouched.
    - To keep using the old settings, copy `~/.config/kiti` to `~/.config/kitia` only if the destination does not exist, or point `KITIA_CONFIG_DIR` at the old directory instead.
    - Audit selected-revision replacements of installed skills, agents, and instructions before writing when an audit is requested.
    - Roll back agent and instruction files if inventory publication fails, and refuse to advance a shared revision while leaving a tracked client unchanged.
    - Install instructions without frontmatter globally and use the selected commit's instruction scope when installing or updating an older revision.
    - Keep healthy catalogs visible when another index is missing or invalid, preserve indexes during case-only renames, and reject reserved registry names.
    - Allow `uninstall --catalog` for resources from a removed catalog.
    - Make top-level `--help` and `doctor --network` work as documented.
    - Validate v1 inventories with mixed-case catalog names, names containing spaces, and previously valid names now reserved for new catalogs.
    - Preserve and report the recovery backup if a collection import cannot restore a file during rollback.
  - **Technical**
    - Reuse one verified checkout per repository and commit for bulk agent and instruction updates.
