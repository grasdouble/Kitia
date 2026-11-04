# Kitia

Your AI toolkit, in good hands.

Kitia is a CLI for connecting AI-resource catalogs to Claude Code and GitHub
Copilot. Kitia stores no skill, agent, or instruction bodies: resources stay in
their source repositories, while Kitia keeps user-managed catalog metadata.

**[Project website](https://grasdouble.github.io/Kitia/)** · **[CLI contract](docs/cli-contract.md)**

## Browse

Add external catalogs, then search and inspect their resources:

```sh
npx --yes @grasdouble/kitia catalog add ai-kit https://github.com/grasdouble/AI-Kit
npx --yes @grasdouble/kitia catalog add matt-skills https://github.com/mattpocock/skills
npx --yes @grasdouble/kitia catalog list
npx --yes @grasdouble/kitia search "documentation" --catalog ai-kit
npx --yes @grasdouble/kitia show skill create-readme --catalog ai-kit
npx --yes @grasdouble/kitia preview skill create-readme --catalog ai-kit
```


## Install and maintain resources

Install a catalog resource without copying its source into Kitia:

```sh
npx --yes @grasdouble/kitia install skill create-readme --catalog ai-kit --tool both --dry-run
npx --yes @grasdouble/kitia install skill create-readme --catalog ai-kit --tool both
npx --yes @grasdouble/kitia check
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
npm run build                 # Build CLI and web
npm run cli:validate          # Build and validate the CLI
npm test                      # Docs and CLI tests
npm run cli:test:package-smoke
npm run web:build             # Build only the website
```

## Publish

The package is `@grasdouble/kitia`; releases are managed with
[Changesets](https://github.com/changesets/changesets). Each user-facing change
should include a changeset file. On `main`, the release workflow opens or
updates a version PR from pending changesets. Merge that PR to update the
version and changelog; the same workflow then publishes the package to npm with
provenance.

Before configuring trusted publishing, bootstrap the package once: it does not
yet exist on npm. From a trusted local checkout, use an npm account authorized
to publish to the `grasdouble` organization:

```sh
npm login --registry=https://registry.npmjs.org
npm publish
```

The package's `publishConfig` pins publication to the public npm registry even
if local npm configuration maps `@grasdouble` to another registry.

Then open `https://www.npmjs.com/package/@grasdouble/kitia` → **Settings** →
**Trusted Publisher** → **GitHub Actions**, and enter:

- Organization or user: `grasdouble`
- Repository: `Kitia`
- Workflow filename: `npm-publish.yml` (filename only)
- Environment: leave unset
- Allowed action: enable direct `npm publish`

Save the publisher. The package then uses GitHub Actions OIDC; no npm access
token is stored in GitHub. The release workflow installs npm CLI 11.5.1+,
required for npm trusted publishing.

### Project layout

`cli/` contains the CLI source, tests, scripts, executable, migration code, and
schemas. `web/` contains the website source, tests, screenshot assets, and
website-specific scripts. `docs/` contains shared documentation and its link
checks. The root `package.json` orchestrates both projects; the CLI compiles to
`dist/` and the site builds independently to `web/dist/`.

### Updating website screenshots

The website gallery uses Termless' xterm.js renderer for the real Ink dashboard
with deterministic demo data. The screenshot generator promotes both images
only after checking the complete inventory, catalog, and selected details.

```sh
npm run web:test:termless
npm run web:screenshots:update:termless
```
The Termless command builds before launching its in-process dashboard and
requires Node.js >=23.6 for the pinned Termless development tools.

`web:test:termless` is opt-in and requires Node.js **23.6 or newer**, as required
by the pinned `@termless/core` 0.10.2 and `@termless/xtermjs` 0.10.2 packages.
It uses Node's built-in `node:test` and `assert` (no Vitest) and tests the real
`runDashboard()` component, production catalog/inventory discovery, key
transitions, colors, and selected details. Kitia's runtime requirement remains
Node.js 22 or newer; the normal `npm test` suite remains independent of this
opt-in Termless suite. The in-process xterm.js path feeds the original Ink ANSI
bytes through xterm after applying PTY-style LF-to-CRLF line discipline; the
raw stream remains available for semantic test assertions.

`web:screenshots:update:termless` uses Termless' pinned xterm.js backend and
`@resvg/resvg-js` to render a 1036×788 pair from a 120×45 terminal grid. Each
image adds 12px of background padding around the unchanged 1012×764 terminal
area. It uses Menlo at 14px, with cell dimensions 8.4333×16.9778px and no outer
margin or scaling. The Termless feed remaps indexed ANSI colors to the
reference palette (including background `#282c34`) without changing the
captured Ink bytes. The generator verifies expected inventory/catalog rows in
the parsed xterm grid before promoting the completed screenshots to
`web/assets/workspace-inventory-termless.png` and
`web/assets/catalog-browser-termless.png`. The deterministic fixture keeps the
catalog ID, repository URL, and dummy source ref fully visible; completeness
checks verify the complete values. If the parser omits required cells, it writes
only `*-termless-draft.png` review artifacts instead. The complete Termless pair
is displayed directly in the website gallery.

The showcase wires the production action handler to temporary project and home
directories, so update and uninstall shortcuts appear without targeting the
real workspace.

The generated Termless captures are maintained as website source assets in
`web/assets/`. The site build bundles them into `dist/site/assets/`.

Kitia does not maintain AI resource bodies or a built-in catalog. Connect
external repositories from the dashboard or with `catalog add`; catalog
metadata is stored in your local user registry.
See [contribution guidance](CONTRIBUTING.md), the [CLI contract](docs/cli-contract.md),
and [inventory migration guide](docs/inventory-migrations.md).
