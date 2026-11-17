---
"@grasdouble/kitia": patch
---

Keep catalog resource identities and source-operation results reliable
  - **User-Facing**
    - Keep installed skills tracked when same-catalog agents or instructions share their IDs, so checks and updates identify the skill correctly.
    - Reuse one pinned acquisition for each agent or instruction preview/install; unaudited dry runs do not fetch source content.
    - Keep update summaries, actions, agent-specific force details, and partial-failure results consistent with or without progress output.
    - Preserve warnings, audit details, and actual partial inventory in typed TUI failure results; async GitHub CLI operations remain non-interactive by default.
    - Report nonzero GitHub CLI status during human-readable skill installation as `GH_INSTALL_FAILED` with Kitia exit status `1`; the source-skill `preview` command may retain delegated status.
