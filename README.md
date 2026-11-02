# Kiti

Your AI toolkit, in good hands.

Kiti is a CLI for connecting AI-resource catalogs to Claude Code and GitHub
Copilot. Kiti stores no skill, agent, or instruction bodies: resources stay in
their source repositories, while Kiti keeps user-managed catalog metadata.

**[Browse Kiti's catalog index](catalogs/CATALOG.md)** ·
**[CLI contract](docs/cli-contract.md)**

## Browse

Add external catalogs, then search and inspect their resources:

```sh
npx --yes github:grasdouble/Kiti catalog add ai-kit https://github.com/grasdouble/AI-Kit
npx --yes github:grasdouble/Kiti catalog add matt-skills https://github.com/mattpocock/skills
npx --yes github:grasdouble/Kiti catalog list
npx --yes github:grasdouble/Kiti search "documentation" --catalog ai-kit
npx --yes github:grasdouble/Kiti show skill create-readme --catalog ai-kit
npx --yes github:grasdouble/Kiti preview skill create-readme --catalog ai-kit
```


Use `--json` for machine-readable discovery. User catalogs are independent of
Kiti's published site index; their metadata is read from the local registry.

## Install and maintain resources

Install a catalog resource without copying its source into Kiti:

```sh
npx --yes github:grasdouble/Kiti install skill create-readme --catalog ai-kit --tool both --dry-run
npx --yes github:grasdouble/Kiti install skill create-readme --catalog ai-kit --tool both
npx --yes github:grasdouble/Kiti check
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
must declare `apply_to` in their frontmatter.

The CLI also supports `catalog add <name> <https-github-url>` for Basic setup.
Catalog definitions and metadata-only indexes live under `~/.config/kiti/`
(override with `KITI_CONFIG_DIR`); artifact bodies stay in their upstream
repositories. Multiple catalogs can be managed independently with
`catalog list` and `catalog remove <name>`.

## Develop

```sh
npm ci
npm run catalog:build
npm run validate
npm test
npm run test:package
npm run site:build
```

Kiti does not maintain AI resource bodies. The checked-in catalog manifest is
empty by design; connect external repositories from the dashboard or with
`catalog add`.
See [contribution guidance](CONTRIBUTING.md), the [CLI contract](docs/cli-contract.md),
and [catalog setup](docs/bundles.md).
