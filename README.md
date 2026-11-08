# Kitia

Your AI toolkit, in good hands.

Kitia is a terminal user interface (TUI) for discovering and managing skills, agents, and instructions from external GitHub repositories, then installing them for Claude Code and GitHub Copilot. Its interactive dashboard is the primary interface; the CLI supports automation and scripted workflows. Catalog metadata stays on your machine; resource content remains in its upstream repository.

**[Project website](https://grasdouble.github.io/Kitia/)** · **[CLI contract](docs/cli-contract.md)**

## Quick start

Requires Node.js 22 or newer. For regular use, install Kitia globally:

```sh
npm install --global @grasdouble/kitia
kitia catalog add ai-kit https://github.com/grasdouble/AI-Kit
kitia search "documentation" --catalog ai-kit
kitia preview skill create-readme --catalog ai-kit
kitia install skill create-readme --catalog ai-kit --tool both --dry-run
```

After the dry run, remove `--dry-run` to install. Global installation adds the `kitia` command; if your shell cannot find it, add npm's global executable directory to `PATH`. To run Kitia without a global install, use `npx --yes @grasdouble/kitia <command>` instead.

By default, Kitia installs to the current project for Copilot. Choose `--tool claude`, `--tool copilot`, or `--tool both`; skills can also be installed for your user account with `--scope user`.

## Manage catalogs and resources

Run `kitia dashboard` to browse project and user inventories, inspect resources, and manage catalogs. Press `N` in the dashboard to add a repository. Without a global install, run `npx --yes @grasdouble/kitia dashboard` instead.

- **Basic** discovers skills recursively under `skills/**/SKILL.md`.
- **Custom** maps selected repository-relative paths for skills, agents, and instructions. Multiple paths can be registered in one catalog.

For Basic discovery, the CLI also supports `catalog add <name> <https-github-url>` and the built-in `catalog add matt-pocock` preset for [Matt Pocock’s skills](https://github.com/mattpocock/skills), `catalog add anthropics` for [Anthropics](https://github.com/anthropics/skills), or `catalog add github-awesome-copilot` for [GitHub Awesome Copilot](https://github.com/github/awesome-copilot). Use `catalog list` and `catalog remove <name>` to manage sources. Instructions without scope frontmatter apply globally; `apply_to`, `applyTo`, or `paths` can narrow their scope.
Use `kitia catalog export catalogs.json` and `kitia catalog import catalogs.json` to transfer catalog definitions via a file. In dashboard catalog management, `P` opens the preset picker for Matt Pocock, Anthropics, or [GitHub Awesome Copilot](https://github.com/github/awesome-copilot), `X` copies the configuration to the clipboard, and `I` opens a text area for pasted JSON. Press `Ctrl+S` to review the catalogs, use `Space` or `Enter` to choose which to import, then press `Ctrl+S` again. Imports merge non-conflicting definitions, skip existing names or repositories with a summary, then refresh newly added catalogs automatically; failed refreshes leave definitions configured and can be retried with `kitia catalog refresh --all`.

Kitia tracks managed files and protects untracked or locally modified content. Use `update`, `uninstall`, `check`, and read-only `doctor` to maintain installations. Add `--dry-run --json` to inspect a planned change without modifying files. The CLI stores catalog definitions and metadata-only indexes under `~/.config/kitia/` (override with `KITIA_CONFIG_DIR`); resource bodies remain upstream and catalog entries are pinned to source commits.

See the [CLI contract](docs/cli-contract.md) for commands and machine-readable output, and the [inventory migration guide](docs/inventory-migrations.md) for inventory format upgrades.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development, testing, and release instructions.
