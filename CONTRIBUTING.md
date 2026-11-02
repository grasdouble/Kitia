# Contributing

Contributions improve Kiti's CLI, catalog adapters, documentation, and site.
Kiti does not maintain AI resource bodies; resources remain in their upstream
repositories. The generated internal catalog is intentionally empty.

External skill catalogs can be tested with synthetic repositories in
`tests/source-catalogs.test.js`. Do not make tests depend on live repositories.

## Validate changes

```sh
npm ci
npm run catalog:build
npm run catalog:check
npm run validate -- --catalog internal
npm test
npm run test:package
```

The site can be built locally with `npm run site:build` and served with
`npm run site:dev`. Browser tests use `npm run test:browser`; install Chromium
first with `npx playwright install chromium`.

Keep catalog controls compact (32px) for fine pointers and preserve larger
touch targets (48px) for coarse pointers. Installation options share the same
controls as the Install tab; viewing details must not discard pending choices.
Distribution packets are decorative, anchored to their repository rows, and
animate only transform and opacity at a constant speed while travelling.
Hide them in stacked layouts and when reduced motion is requested.

For a change to the CLI or its machine-readable output, preserve the
[compatibility contract](docs/cli-contract.md) and run
`npm run test:contract`. Use synthetic fixtures for external catalogs and do
not rely on live repositories in tests.

## User-managed external catalogs

From the interactive dashboard, press `N`, enter a GitHub repository, and
choose Basic or Custom setup. Basic discovers nested `skills/**/SKILL.md`
resources. Custom entries can be skills, agents, or instructions at
user-selected repository-relative paths; instruction frontmatter must include
`apply_to`.

The CLI's `catalog add <name> <https-github-url>` command performs Basic setup:

```sh
kiti catalog add ai-kit https://github.com/grasdouble/AI-Kit
kiti catalog add matt-skills https://github.com/mattpocock/skills
kiti catalog list
```

The CLI stores each source, path mapping, and metadata-only index under
`~/.config/kiti/` (override with `KITI_CONFIG_DIR`). It keeps artifact bodies
out of Kiti and pins each entry to a source commit.
