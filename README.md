# Kitia

Your AI toolkit, in good hands.

Kitia is a CLI for discovering and managing skills, agents, and instructions from external GitHub repositories, then installing them for Claude Code and GitHub Copilot. Catalog metadata stays on your machine; resource content remains in its upstream repository.

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

For Basic discovery, the CLI also supports `catalog add <name> <https-github-url>`. Use `catalog list` and `catalog remove <name>` to manage sources. Instructions without scope frontmatter apply globally; `apply_to`, `applyTo`, or `paths` can narrow their scope.

Kitia tracks managed files and protects untracked or locally modified content. Use `update`, `uninstall`, `check`, and read-only `doctor` to maintain installations. Add `--dry-run --json` to inspect a planned change without modifying files. The CLI stores catalog definitions and metadata-only indexes under `~/.config/kitia/` (override with `KITIA_CONFIG_DIR`); resource bodies remain upstream and catalog entries are pinned to source commits.

See the [CLI contract](docs/cli-contract.md) for commands and machine-readable output, and the [inventory migration guide](docs/inventory-migrations.md) for inventory format upgrades.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development, testing, and release instructions.
