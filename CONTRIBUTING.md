# Contributing

Contributions improve Kitia's CLI, catalog integrations, documentation, and resource lifecycle. Kitia does not maintain AI resource bodies or a built-in catalog; resource content remains in upstream repositories.

## Development

Kitia requires Node.js 26 or newer and pnpm 12.17.0. Install dependencies and run the standard checks:

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm run cli:validate
pnpm test
pnpm run cli:test:package-smoke
```

`pnpm test` runs documentation and CLI tests. For CLI or machine-readable output changes, preserve the [CLI compatibility contract](docs/cli-contract.md) and run `pnpm run cli:test:contract`.

Use synthetic repositories and fixtures for catalog tests; do not rely on live repositories. External catalog and lifecycle behavior is covered by `cli/test/source-catalogs.test.js`; source-history behavior and prefix handling lives in `cli/test/source-history.test.js`. Catalog discovery and dashboard filtering has focused coverage in `cli/test/dashboard-filters.test.js`. Inventory migration behavior is covered by `cli/test/migrations.test.js`; when changing migrations, verify files dropped from an older inventory remain discoverable as unmanaged artifacts. `pnpm test` also runs the strict TypeScript boundary configured in `tsconfig.strict.json`.

Dashboard interaction tests must wait for a complete synchronized frame showing the destination screen and the dismissed modal's absence before sending the next key. A background heading, output-length increase, or negative-only predicate can match an animation repaint or an incomplete frame while a standalone Escape is still being decoded.

The Termless dashboard test runs in CI on Ubuntu with Node.js 26. Run it locally with Node.js 26 or newer:

```sh
pnpm run web:test:termless
pnpm run web:screenshots:update:termless
```

The CLI lives in `cli/`, the website in `web/`, and shared documentation in `docs/`. The root package builds both; CLI output goes to `cli/dist/` and website output to `web/dist/`.

## Versioning and releases

Use [Changesets](https://github.com/changesets/changesets) for user-facing package changes:

```sh
pnpm run changeset
```

Select `@grasdouble/kitia` and the smallest appropriate `patch`, `minor`, or `major` bump. Do not edit package versions or `CHANGELOG.md` manually for routine releases.

Write each non-empty Changeset as one short description followed by detail bullets indented by exactly two spaces:

```md
---
"@grasdouble/kitia": minor
---

Short description
  - Detail 1
  - Detail 2
```

CI checks this writing format, validates Changesets metadata and package references with `pnpm changeset status`, and uses Lufa's `check-changesets` action in `simple` mode to verify pull-request coverage for Kitia's root package. A non-empty Changeset must name the package. For repository-only changes such as CI, tests, or documentation that do not need a package release, create an empty no-bump Changeset with `pnpm exec changeset add --empty`; an optional `--message "..."` is allowed and exempt from the body format. The empty Changeset explicitly covers the changed package files without requesting a release.

On pushes to `main`, the pinned Changesets release workflow opens or updates a version pull request. Merging it updates the package version and changelog, publishes to npm with provenance, pushes the matching version tag, and creates a GitHub Release. Use pnpm for repository dependencies and scripts; publishing remains through npm.

### First npm publication

The first publication is a one-time manual bootstrap from a trusted checkout. Use an npm account authorized to publish for the `grasdouble` organization. The repository `.npmrc` routes `@grasdouble` to the public npm registry:

```sh
npm login --registry=https://registry.npmjs.org
npm publish
```

npm requires account 2FA or a granular token with 2FA bypass for publishing. New TOTP enrollment is not supported; configure a security key (such as Touch ID or a hardware key) in the npm account's **Two-Factor Authentication** settings and keep the recovery codes safe. Set the account to protect writes (`auth-and-writes`). See [npm's 2FA setup guide](https://docs.npmjs.com/configuring-two-factor-authentication/).

After the package exists, configure its npm **Trusted Publisher** under **Settings → Trusted Publisher → GitHub Actions**:

- Organization or user: `grasdouble`
- Repository: `Kitia`
- Workflow filename: `npm-publish.yml` (filename only)
- Environment: leave unset
- Allowed action: enable direct `npm publish`

The workflow publishes through GitHub Actions OIDC; no npm token is stored in GitHub. It installs npm CLI 11.5.1 or newer, which is required for npm trusted publishing.
