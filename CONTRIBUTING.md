# Contributing

Contributions improve Kitia's CLI, catalog integrations, documentation, and resource lifecycle. Kitia does not maintain AI resource bodies or a built-in catalog; resource content remains in upstream repositories.

## Development

Kitia requires Node.js 22 or newer and pnpm 12.17.0. Install dependencies and run the standard checks:

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm run cli:validate
pnpm test
pnpm run cli:test:package-smoke
```

`pnpm test` runs documentation and CLI tests. For CLI or machine-readable output changes, preserve the [CLI compatibility contract](docs/cli-contract.md) and run `pnpm run cli:test:contract`.


Use synthetic repositories and fixtures for catalog tests; do not rely on live repositories. External catalog and lifecycle behavior is covered by `cli/test/source-catalogs.test.js`; inventory migration behavior is covered by `cli/test/migrations.test.js`. When changing migrations, verify files dropped from an older inventory remain discoverable as unmanaged artifacts.

The optional Termless dashboard test and screenshot generator require Node.js 23.6 or newer:

```sh
pnpm run web:test:termless
pnpm run web:screenshots:update:termless
```

The CLI lives in `cli/`, the website in `web/`, and shared documentation in `docs/`. The root package builds both; CLI output goes to `cli/dist/` and website output to `web/dist/`.

## Versioning and releases

Use [Changesets](https://github.com/changesets/changesets) for user-facing changes. Run:

```sh
pnpm run changeset
```

Select `@grasdouble/kitia` and the appropriate `patch`, `minor`, or `major` bump, then commit the generated Markdown file under `.changeset/`. Do not edit package versions or the changelog manually for routine releases. On pushes to `main`, the pinned Changesets release action opens or updates a version PR; merging that PR updates the version and changelog, then publishes the package to npm with provenance, pushes the matching version tag, and creates a GitHub Release. Use pnpm for repository dependencies and scripts; publishing remains through npm.

For repository-only changes such as CI, documentation, or tests that do not need a package release, run `pnpm exec changeset add --empty` (optionally with `--message "..."`). The PR check uses Lufa's `check-changesets` action in `simple` mode for Kitia's root package: a non-empty Changeset must name the package, while an empty Changeset explicitly marks the PR as no-bump and covers its changed package files. The job fails when package changes have no covering Changeset.

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
