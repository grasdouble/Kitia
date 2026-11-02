## Summary

<!-- What user need or problem does this change address? -->

## Changes

<!-- Summarize the approach and call out user-visible behavior changes. -->

## Validation

<!-- Check the relevant commands and list any additional checks. -->

- [ ] `npm test`
- [ ] `npm run validate` (catalog or resource changes)
- [ ] `npm run catalog:build` and `npm run catalog:check` (catalog source or generator changes)
- [ ] `npm run test:contract` (CLI or inventory contract changes)
- [ ] `npm run test:package` (package or CLI distribution changes)
- [ ] `npm run site:build` (site or site-build changes)
- [ ] `npm run test:browser` (browser behavior changes)
- [ ] Other or not applicable (explain)

## Compatibility and data safety

- [ ] Public CLI, JSON, or inventory changes are documented and covered by regression tests (or not applicable).
- [ ] Lifecycle changes preserve dry-run, conflict, path-safety, and operation-lock protections (or not applicable).
- [ ] Generated catalog outputs are regenerated and included when required.

<!-- Configured source metadata is generated during the site build and published as an Actions artifact; do not commit snapshots. -->
