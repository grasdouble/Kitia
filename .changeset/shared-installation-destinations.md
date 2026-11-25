---
"@grasdouble/kitia": major
---

Choose one or more installation destinations in the CLI and dashboard
  - **User-Facing**
    - Skills default to the shared `.agents/skills/` directory, with dedicated GitHub Copilot, Claude Code, and Mistral Vibe locations available in project and user scope.
    - Replace `--tool` and `both` with repeatable `--destination` options. Use `--destination standard` to keep the location previously selected by `--tool copilot` for skills.
    - Select multiple destinations in a dropdown styled like the Inventory filters, add copies without replacing existing ones, and review full paths before installing, updating, or uninstalling.
    - The dashboard lists User first and selects it by default for skills and agents. Scope and Destinations use the same dropdown style. The CLI continues to default to project scope.
    - Use Review install to check selected paths before confirming, or Cancel to return to the catalog without installing.
    - See the underlying inventory error directly in Install Options when a scope is unavailable.
    - See the selected artifact's installation destinations under Installed for in Inventory.
    - Existing tracked skills stay in place and require no inventory migration. Agents and instructions keep their native formats; instructions remain project-only.
