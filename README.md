# Kitia

Your AI toolkit, in good hands.

Kitia is a CLI for connecting AI-resource catalogs to Claude Code and GitHub
Copilot. Kitia stores no skill, agent, or instruction bodies: resources stay in
their source repositories, while Kitia keeps user-managed catalog metadata.

**[Project website](https://grasdouble.github.io/Kitia/)** · **[CLI contract](docs/cli-contract.md)**

## Browse

Add external catalogs, then search and inspect their resources:

```sh
npx --yes github:grasdouble/Kitia catalog add ai-kit https://github.com/grasdouble/AI-Kit
npx --yes github:grasdouble/Kitia catalog add matt-skills https://github.com/mattpocock/skills
npx --yes github:grasdouble/Kitia catalog list
npx --yes github:grasdouble/Kitia search "documentation" --catalog ai-kit
npx --yes github:grasdouble/Kitia show skill create-readme --catalog ai-kit
npx --yes github:grasdouble/Kitia preview skill create-readme --catalog ai-kit
```


## Install and maintain resources

Install a catalog resource without copying its source into Kitia:

```sh
npx --yes github:grasdouble/Kitia install skill create-readme --catalog ai-kit --tool both --dry-run
npx --yes github:grasdouble/Kitia install skill create-readme --catalog ai-kit --tool both
npx --yes github:grasdouble/Kitia check
```

Installations default to project scope and Copilot. Select `--tool claude`,
`--tool copilot`, or `--tool both`; skills can also be installed to the user
scope with `--scope user`. The CLI tracks managed files, protects untracked or
locally modified content, and supports `update`, `uninstall`, `dashboard`, and
read-only `doctor` diagnostics. Use `--dry-run --json` to inspect a lifecycle
plan without changing files.

## Manage external catalogs

Use `dashboard` and press `N` to add a catalog. Choose **Basic** to discover
skills recursively under `skills/**/SKILL.md`, or **Custom** to register only
the paths you choose: skills, agents, and instructions can live in any
repository-relative location. Add multiple paths in one catalog. Instructions
without scope frontmatter apply globally; `apply_to`, `applyTo`, or `paths` can
narrow their scope.

The CLI also supports `catalog add <name> <https-github-url>` for Basic setup.
Catalog definitions and metadata-only indexes live under `~/.config/kitia/`
(override with `KITIA_CONFIG_DIR`); artifact bodies stay in their upstream
repositories. Multiple catalogs can be managed independently with
`catalog list` and `catalog remove <name>`.

## Develop

```sh
npm ci
npm run validate
npm test
npm run test:package
```

Kitia does not maintain AI resource bodies. Connect external repositories from the dashboard or with `catalog add`; catalog metadata is stored in your local user registry.
See [contribution guidance](CONTRIBUTING.md), the [CLI contract](docs/cli-contract.md),
and [catalog setup](docs/bundles.md).
