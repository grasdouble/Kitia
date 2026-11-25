---
"@grasdouble/kitia": major
---

Choose one or more installation destinations in the CLI and dashboard
  - **User-Facing**
    - Skills default to the shared `.agents/skills/` directory, with dedicated GitHub Copilot, Claude Code, and Mistral Vibe locations available in project and user scope.
    - Replace `--tool` and `both` with repeatable `--destination` options. Use `--destination standard` to keep the location previously selected by `--tool copilot` for skills.
    - Select multiple destinations in a dropdown styled like the Inventory filters, add copies without replacing existing ones, and review full paths before installing, updating, or uninstalling.
    - Existing tracked skills stay in place and require no inventory migration. Agents and instructions keep their native formats; instructions remain project-only.
