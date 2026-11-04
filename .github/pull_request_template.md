## Summary

<!-- What user need or problem does this change address? -->

## Changes

<!-- Summarize the approach and call out user-visible behavior changes. -->

## Validation

<!-- Check the relevant commands and list any additional checks. -->

- [ ] `npm test`
- [ ] `npm run cli:validate` (catalog or resource changes)
- [ ] `npm run cli:test:contract` (CLI or inventory contract changes)
- [ ] `npm run cli:test:package-smoke` (package or CLI distribution changes)
- [ ] Other or not applicable (explain)

## Compatibility and data safety

- [ ] Public CLI, JSON, or inventory changes are documented and covered by regression tests (or not applicable).
- [ ] Lifecycle changes preserve dry-run, conflict, path-safety, and operation-lock protections (or not applicable).
- [ ] Generated catalog outputs are regenerated and included when required.

<!-- User-managed source catalog metadata stays in local configuration; do not commit personal indexes. -->
