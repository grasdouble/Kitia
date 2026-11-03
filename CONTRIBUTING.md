# Contributing

Contributions improve Kitia's CLI, user-managed catalog adapters, documentation, and resource lifecycle.
Kitia does not maintain AI resource bodies or a repository-owned catalog; resources remain in their upstream repositories.

External skill catalogs can be tested with synthetic repositories in
`tests/source-catalogs.test.js`. Do not make tests depend on live repositories.

## Validate changes

```sh
npm ci
npm run validate
npm test
npm run test:package
```

For a change to the CLI or its machine-readable output, preserve the
[compatibility contract](docs/cli-contract.md) and run `npm run test:contract`.
Use synthetic fixtures for external catalogs and do not rely on live repositories in tests.

## User-managed external catalogs

From the interactive dashboard, press `N`, enter a GitHub repository, and
choose Basic or Custom setup. Basic discovers nested `skills/**/SKILL.md`
resources. Custom entries can be skills, agents, or instructions at
user-selected repository-relative paths. External instructions without scope
frontmatter apply globally; `apply_to`, `applyTo`, or `paths` can narrow the
scope.

The CLI's `catalog add <name> <https-github-url>` command performs Basic setup:

```sh
kitia catalog add ai-kit https://github.com/grasdouble/AI-Kit
kitia catalog add matt-skills https://github.com/mattpocock/skills
kitia catalog list
```

The CLI stores each source, path mapping, and metadata-only index under
`~/.config/kitia/` (override with `KITIA_CONFIG_DIR`). It keeps artifact bodies
out of Kitia and pins each entry to a source commit.
