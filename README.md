# Kitia

Your AI toolkit, in good hands.

Kitia is a CLI for discovering and managing skills, agents, and instructions from external GitHub repositories, then installing them for Claude Code and GitHub Copilot. Catalog metadata stays on your machine; resource content remains in its upstream repository.

**[Project website](https://grasdouble.github.io/Kitia/)** · **[CLI contract](docs/cli-contract.md)**

## Quick start

Requires Node.js 22 or newer. Add a catalog, inspect a resource, then preview an installation:

```sh
npx --yes @grasdouble/kitia catalog add ai-kit https://github.com/grasdouble/AI-Kit
npx --yes @grasdouble/kitia search "documentation" --catalog ai-kit
npx --yes @grasdouble/kitia preview skill create-readme --catalog ai-kit
npx --yes @grasdouble/kitia install skill create-readme --catalog ai-kit --tool both --dry-run
```

Remove `--dry-run` to install. By default, Kitia installs to the current project for Copilot. Choose `--tool claude`, `--tool copilot`, or `--tool both`; skills can also be installed for your user account with `--scope user`.

## Manage catalogs and resources

Use `npx --yes @grasdouble/kitia dashboard` to browse project and user inventories, manage catalogs, and inspect resource details. Press `N` in the dashboard to add a catalog:

- **Basic** discovers skills under `skills/**/SKILL.md`.
- **Custom** lets you register repository-relative paths for skills, agents, and instructions.

The CLI also supports `catalog add <name> <https-github-url>` for Basic catalogs. Use `catalog list` and `catalog remove <name>` to manage sources. Instructions without scope frontmatter apply globally; `apply_to`, `applyTo`, or `paths` can limit where they apply.

Kitia tracks the files it manages and protects untracked or locally modified content. Use `update`, `uninstall`, `check`, and read-only `doctor` to maintain installations. Add `--dry-run --json` to inspect a planned change without modifying files. See the [CLI contract](docs/cli-contract.md) for the complete command and output reference.

Catalog definitions and metadata-only indexes are stored locally under `~/.config/kitia/` (override with `KITIA_CONFIG_DIR`). Kitia does not host catalogs or store skill, agent, or instruction bodies; those remain in their source repositories.

## Develop

```sh
npm ci
npm run build
npm run cli:validate
npm test
npm run cli:test:package-smoke
```

`npm test` runs documentation and CLI tests. The optional Termless dashboard test and screenshot generator require Node.js 23.6 or newer:

```sh
npm run web:test:termless
npm run web:screenshots:update:termless
```

The repository contains the CLI in `cli/`, website source in `web/`, and shared documentation in `docs/`. See [contribution guidance](CONTRIBUTING.md) for test and change requirements.

## Releases

Releases use [Changesets](https://github.com/changesets/changesets). Add a changeset for each user-facing change with `npm run changeset`, then commit the generated file under `.changeset/`. On `main`, the release workflow opens or updates a version PR. Merging it updates the package version and changelog, then publishes the package to npm with provenance.

For the initial npm publication, publish the current `0.0.1` version once from a trusted checkout using an npm account authorized for the `grasdouble` organization:

```sh
npm login --registry=https://registry.npmjs.org
npm publish
```

The repository `.npmrc` routes `@grasdouble` packages to the public npm registry. After the package exists, configure its npm **Trusted Publisher** under **Settings → Trusted Publisher → GitHub Actions**:

- Organization or user: `grasdouble`
- Repository: `Kitia`
- Workflow filename: `npm-publish.yml` (filename only)
- Environment: leave unset
- Allowed action: enable direct `npm publish`

The workflow uses GitHub Actions OIDC; no npm access token is stored in GitHub. See [inventory migration guidance](docs/inventory-migrations.md) for migration behavior.
