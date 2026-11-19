# Kitia repository review

## Scope and method

This evidence-first review covers TUI/dashboard implementation and tests, the browser demo and terminal bridge, web behavior and build/test wiring, TypeScript/Oxfmt tooling, CLI/core/catalog/inventory/collection/migration paths, package and CI/release/Pages workflows, schemas, and contributor-facing contracts. Findings were traced from source to existing tests and published documentation where available. Platform risks and proposals are explicitly distinguished from observed command output.

Priority ladder: **P1** release/CI or data-integrity risks; **P2** behavioral/reliability issues; **P3** maintainability and documentation issues. Findings include concrete impact, recommended fix, and focused follow-up verification. The report describes evidence and opportunities; it does not claim that proposed fixes have been implemented.

## P1 — Release, CI, and data-integrity risks

### The CLI test command invokes an undefined TUI test script

**Evidence:** [`package.json:54`](../package.json#L54) invokes `pnpm run tui:test:source`; the scripts block at [`package.json:46–68`](../package.json#L46) defines no such command. CI runs `cli:test` on Ubuntu, macOS, and Windows ([`.github/workflows/ci.yml:20–24, 40`](../.github/workflows/ci.yml#L20)); the release workflow runs `pnpm test` ([`.github/workflows/npm-publish.yml:30`](../.github/workflows/npm-publish.yml#L30)).

**Impact:** The configured CLI test path fails when it reaches the unknown pnpm script, blocking CI and the release test sequence. The TUI test files are not reached through this command.

**Recommendation:** Define `tui:test:source` to run the intended TUI tests; do not treat deleting the invocation as an equivalent fix.

**Focused verification:** Run `pnpm run cli:test` and confirm the TUI tests complete on each CI operating system.

### The existing Oxfmt Changeset format failure blocks the PR changeset check

**Evidence:** The actual `pnpm run changeset:format` output reported `.changeset/bright-oxfmt-format.md`: “add grouped details after the description” and “add a User-Facing or Technical group.” The file has a package bump and a plain description but no grouped details ([`.changeset/bright-oxfmt-format.md:1–5`](../.changeset/bright-oxfmt-format.md#L1)). CI runs `changeset:format` in the PR `changeset-status` job ([`.github/workflows/ci.yml:49–80`](../.github/workflows/ci.yml#L49)).

**Impact:** The checked-in Changeset fails the formatter check, so the PR changeset job fails until the entry is resolved.

**Recommendation:** Have the owner of this Changeset reconcile it with the repository format; do not weaken or bypass the checker.

**Focused verification:** Re-run `pnpm run changeset:format` after the owner resolves the entry.

### Reinstalling a tracked artifact at a selected revision can bypass the requested audit

**Evidence:** The already-installed branch in [`terminal/src/core/installations/lifecycle.ts:217–270`](../terminal/src/core/installations/lifecycle.ts#L217) returns through update handling before the explicit install audit at [`lifecycle.ts:328–342`](../terminal/src/core/installations/lifecycle.ts#L328). Native dashboard install requests auditing ([`terminal/src/tui/native-actions.ts:65–86`](../terminal/src/tui/native-actions.ts#L65)), and the documented contract promises an install audit ([`resource-audit.md:3–5`](resource-audit.md#L3)).

**Impact:** Replacing an already tracked artifact with a selected revision can write new content without the blocking audit promised for install.

**Recommendation:** Share the audit gate across fresh and already-tracked install paths, reusing the prepared content. Preserve the documented distinction that skill audit covers the entrypoint, not auxiliary files; signatures prove signer/integrity, not upstream safety.

**Focused verification:** For applicable skill, agent, and instruction cases, attempt a tracked replacement with a benign over-limit selected revision; assert the audit blocks and both files and inventory remain unchanged.

### Agent and instruction destination files can change without inventory publication

**Evidence:** Resource writes and subsequent inventory publication are separate operations in [`terminal/src/core/installations/mutations.ts:103–145, 310–317`](../terminal/src/core/installations/mutations.ts#L103), [`inventory.ts:324–345`](../terminal/src/core/inventory/inventory.ts#L324), and [`files.ts:224–281`](../terminal/src/core/installations/files.ts#L224). The contract promises staging and rollback on write failure ([`cli-contract.md:406–410`](cli-contract.md#L406)); existing injected rename-failure coverage tests one plan, not failure between the two operations ([`terminal/src/core/catalogs/__tests__/source-indexing.test.js`](../terminal/src/core/catalogs/__tests__/source-indexing.test.js)).

**Impact:** If inventory publication fails, a fresh install can leave untracked destination files; an update can leave new bytes while recorded ownership fingerprints still describe old content.

**Recommendation:** Build one transaction plan containing destination writes and inventory publication, with exact fingerprints for the materialized output, and retain the existing rollback ordering.

**Focused verification:** Inject inventory publication failure during both install and update; assert original files, modes, and inventory ownership/fingerprints are preserved.

### The inspection contract test has Windows-specific execution risks

**Evidence:** The historical [`terminal/src/core/inspection/__tests__/model.test.js:11`](../terminal/src/core/inspection/) test interpolated `path.resolve(...)` directly into TypeScript source; lines 14–35 invoked `execFileSync('pnpm', ...)` without a shell. The test was included by `core:test:source` ([`package.json:55–56`](../package.json#L55)), and CI includes Windows ([`.github/workflows/ci.yml:20–24`](../.github/workflows/ci.yml#L20)). This is a source-based platform risk, not a Windows failure reproduced during this review.
**Impact:** Windows path backslashes can be interpreted as TypeScript string escapes, and direct execution of a `.cmd` shim via `execFileSync` is not portable; the test may fail on Windows CI even when the model contract is valid.
**Recommendation:** Use a checked-in TypeScript fixture with valid assignments and `@ts-expect-error` cases for forbidden shapes, wired into the typecheck command rather than spawning `pnpm` from a test.
**Focused verification:** Run the fixture typecheck on Windows and Unix; confirm valid shapes compile and each forbidden shape is rejected.


## P2 — Behavioral and reliability issues

### A late Ink failure leaves the browser demo in a misleading ready state

**Evidence:** After initial mount, [`web/src/components/demo/browserTerminal.ts:171–181`](../web/src/components/demo/browserTerminal.ts#L171) handles `waitUntilExit()` rejection by marking the session exited, printing an error, and calling optional `onExit`. [`web/src/components/demo/TuiDemo.tsx:73–84`](../web/src/components/demo/TuiDemo.tsx#L73) passes only `{ signal }`; React enters the error phase only when mounting rejects ([`TuiDemo.tsx:94–97`](../web/src/components/demo/TuiDemo.tsx#L94)). Controls remain enabled in the ready phase ([`TuiDemo.tsx:146, 199, 211`](../web/src/components/demo/TuiDemo.tsx#L146)), while session input and focus become no-ops after exit ([`browserTerminal.ts:189–195`](../web/src/components/demo/browserTerminal.ts#L189)).

**Impact:** After a successful first frame, an asynchronous Ink failure can leave the page announcing a ready session with enabled controls that no longer work.

**Recommendation:** Pass an exit/error callback that moves the wrapper out of ready state and disposes the session, distinguishing normal exit from asynchronous failure where useful. Add direct browser-terminal lifecycle coverage for this path, initialization cancellation, reset/unmount cleanup, and resize/listener disposal. `web:test:components` currently covers session behavior but not `mountDashboardTerminal`/`TuiDemo` lifecycle ([`package.json:66`](../package.json#L66)).

**Focused verification:** Make `waitUntilExit()` reject after initial render; assert visible error state, disabled controls, and released terminal resources. Also exercise initialization cancellation and resize followed by disposal. A Chromium-like browser runtime was not exercised in this review.

### A single-runtime agent/instruction install can falsely advance the shared pin of the other runtime

**Evidence:** An ordinary reinstall can write only the selected destination ([`mutations.ts:101–145`](../terminal/src/core/installations/mutations.ts#L101)), while tracking records one `source_ref` for the resource ([`mutations.ts:285–288`](../terminal/src/core/installations/mutations.ts#L285), [`inventory.ts:302–341`](../terminal/src/core/inventory/inventory.ts#L302)). Checks consume that record ([`checks.ts:99–117`](../terminal/src/core/inventory/checks.ts#L99)).

**Impact:** If both runtime destinations exist, installing revision B to one can make the untouched copy appear current at B even though its bytes remain from A.

**Recommendation:** Track provenance per destination with an explicit compatibility policy, or prevent advancing a shared pin unless all tracked destinations are updated.

**Focused verification:** Install both runtime copies at A, reinstall only one at B, then assert the untouched copy is not reported current by check/update.

### A missing or invalid catalog index can hide healthy catalogs, including targeted reads

**Evidence:** Index loading validates the full set ([`terminal/src/core/catalogs/indexes.ts:59–75, 98–133`](../terminal/src/core/catalogs/indexes.ts#L59)); catalog management retains failed definitions and discovery later consumes the aggregate ([`manage.ts:282–307`](../terminal/src/core/catalogs/manage.ts#L282)). The current availability test covers only one source ([`terminal/src/core/catalogs/__tests__/indexes.test.js:6–14`](../terminal/src/core/catalogs/__tests__/indexes.test.js#L6)).

**Impact:** One unavailable or corrupt source can prevent results from healthy sources, even when the caller selects a healthy catalog.

**Recommendation:** Load and validate selected indexes independently, while preserving strict aggregate validation for the explicit validate operation.

**Focused verification:** Pair a healthy catalog with one missing and then one invalid index; assert targeted healthy discovery succeeds and aggregate JSON retains healthy results while naming only the failing source.

### Catalog display names can collide with index infrastructure and case-only renames can remove the new index

**Evidence:** The catalog validator accepts names that can map to the registry filename ([`terminal/src/core/catalogs/model.ts:4–12, 55–57`](../terminal/src/core/catalogs/model.ts#L4)); add writes the index ([`manage.ts:77–84`](../terminal/src/core/catalogs/manage.ts#L77)). Case-only edit writes the new index then removes the old name ([`manage.ts:140–149`](../terminal/src/core/catalogs/manage.ts#L140)); index filenames are derived from catalog names ([`indexes.ts:59–74`](../terminal/src/core/catalogs/indexes.ts#L59)).

**Impact:** A reserved display name can overwrite registry data. On a case-insensitive volume, a case-only rename can remove the file just written because both names identify the same file.

**Recommendation:** Reserve internal names using filesystem-equivalent comparison and use stable, collision-free index filenames independent of display casing.

**Focused verification:** Test reserved-name add/import before publication and a case-only rename on a case-insensitive filesystem.

### Instruction discovery and installation disagree on frontmatter and historical scope

**Evidence:** Discovery accepts Markdown without frontmatter ([`terminal/src/core/catalogs/discovery.ts:229–265`](../terminal/src/core/catalogs/discovery.ts#L229)); install/update later parse and materialize it ([`lifecycle.ts:175–185, 217–225`](../terminal/src/core/installations/lifecycle.ts#L175), [`mutations.ts:148–161`](../terminal/src/core/installations/mutations.ts#L148)). The documented CLI contract describes scope and instruction behavior ([`cli-contract.md:54–61, 329–335`](cli-contract.md#L54)).

**Impact:** Discovery can advertise an instruction that installation rejects. For a historical pin, current catalog `apply_to` can be used instead of the pinned file's scope, deploying historical content to the wrong paths.

**Recommendation:** Use one instruction parser across discovery and materialization; derive historical scope from the pinned bytes.

**Focused verification:** Verify a frontmatter-free instruction uses the documented global default, and test two historical pins with different benign scopes on both runtimes.

### Read-only commands can implicitly copy legacy home configuration

**Evidence:** Legacy configuration resolution creates the new directory and copies the old tree ([`terminal/src/core/catalogs/config.ts:10–32`](../terminal/src/core/catalogs/config.ts#L10)); doctor and CLI loading reach that resolver ([`diagnostics/doctor.ts:9–18`](../terminal/src/core/diagnostics/doctor.ts#L9), [`cli/loading.ts:7–10`](../terminal/src/cli/loading.ts#L7)). This conflicts with the read-only behavior documented in [`README.md:35`](../README.md#L35) and [`cli-contract.md:36, 94`](cli-contract.md#L36).

**Impact:** Doctor, discovery, or a dry-run can write to the user's home directory despite being documented as read-only.

**Recommendation:** Provide a read-only legacy-config fallback and perform migration explicitly before a write operation.

**Focused verification:** With an isolated legacy-only home, run doctor, discovery, and dry-run; assert existing settings remain visible and the new config tree is not created.

### The executable rejects advertised `doctor --network` and top-level `--help`

**Evidence:** The CLI contract advertises `doctor --network` ([`cli-contract.md:36`](cli-contract.md#L36)), but argument parsing routes it through `check` options ([`terminal/src/cli/arguments.ts:100–103, 290–303, 361`](../terminal/src/cli/arguments.ts#L100)); the doctor core has a network branch ([`terminal/src/core/diagnostics/doctor.ts:73–102`](../terminal/src/core/diagnostics/doctor.ts#L73)). The parser advertises top-level help ([`terminal/src/cli/arguments.ts:400`](../terminal/src/cli/arguments.ts#L400)), but the executable command handler routes the parsed command separately ([`terminal/src/cli/commands.ts:139–141`](../terminal/src/cli/commands.ts#L139)); local compiled-output probes for `--help` exited 1.

**Impact:** The advertised network probe is unreachable through the executable, and top-level help is rejected before normal command execution.

**Recommendation:** Parse doctor-specific options and global help before config loading and command dispatch.

**Focused verification:** Exercise the packaged executable with a controlled `gh` runner; assert help works and network probes run only when requested.

### Explicit uninstall cannot select a removed catalog

**Evidence:** `--catalog` is resolved against registered sources before the loader can consult inventory ([`terminal/src/cli/arguments.ts:60–65, 86–96`](../terminal/src/cli/arguments.ts#L60)); loading and inventory code support removed catalog resources ([`terminal/src/cli/loading.ts:11–26`](../terminal/src/cli/loading.ts#L11), [`inventory.ts:546–569`](../terminal/src/core/inventory/inventory.ts#L546)). The contract documents catalog selection ([`docs/cli-contract.md:350–353`](../docs/cli-contract.md#L350)).

**Impact:** Users cannot use the documented explicit selector to uninstall a resource after its catalog has been removed.

**Recommendation:** Resolve uninstall selectors against both registered sources and target inventory after target selection; keep discovery strict.

**Focused verification:** Install a resource, remove its catalog registration, then invoke the packaged CLI with `uninstall --catalog`; assert the selected installed resource is removed.

### The published inventory schema rejects inventories the writer can create

**Evidence:** The schema restricts catalog keys to lowercase kebab case ([`terminal/schemas/catalog-lock-v1.schema.json:12–15`](../terminal/schemas/catalog-lock-v1.schema.json#L12)); the built-in `Anthropics` preset is mixed case ([`terminal/src/core/catalogs/presets.ts:12–19`](../terminal/src/core/catalogs/presets.ts#L12)), and the writer preserves such keys ([`terminal/src/core/inventory/inventory.ts:332–342`](../terminal/src/core/inventory/inventory.ts#L332)).

**Impact:** A valid writer-produced inventory using a supported preset/display name can fail validation against the published schema.

**Recommendation:** Align schema constraints with supported runtime catalog names.

**Focused verification:** Validate writer-produced samples for built-in presets and display names using Ajv; include both the committed fixture and `Anthropics`.

### Collection rollback can delete the only recovery copy

**Evidence:** Import stages and publishes collection files, then attempts rollback and cleanup ([`terminal/src/core/collections/import.ts:15–25, 38–70`](../terminal/src/core/collections/import.ts#L15)); the collection guide promises preservation of prior registries after publication failure ([`resource-collections.md:23`](resource-collections.md#L23)). Existing executable tests cover signature rejection before publication ([`terminal/test/collections.test.js:138–175`](../terminal/test/collections.test.js#L138)).

**Impact:** Rollback can try to restore entries never published; if a restore fails, cleanup may delete the backup that was the remaining recovery copy.

**Recommendation:** Roll back only files that were published, and retain/report any backup whose restore fails.

**Focused verification:** Inject publication failure and then restore failure through the I/O seam; assert the original bytes remain recoverable and the failure is reported.

### Migration should acquire the target lock before the first real migration (dormant proposal)

**Evidence at the time of review:** The runner compared inventory bytes but did not acquire the shared lock around apply. The migration registry was empty and existing inventories were skipped ([`terminal/test/migrations.test.js`](../terminal/test/migrations.test.js#L68)).

**Impact:** Once a real migration is introduced, a concurrent writer could enter after the last comparison and race the migration.

**Recommendation:** Acquire the shared target lock for the full apply operation before enabling the first real migration.

**Focused verification:** Add an injected version transition/concurrent-writer test and assert the migration excludes it. This is a dormant safeguard proposal, not a current migration defect.

**Status:** The [migration runner](../terminal/src/migrations/run.ts#L205) now acquires the shared lock and rereads the inventory before applying a migration. The [concurrency test](../terminal/test/migration-lock.test.js#L28) covers that behavior.

## P3 — Maintainability and documentation

### Contributor guidance lacks its promised executable contract gate and has stale test paths

**Evidence:** [`CONTRIBUTING.md:19`](../CONTRIBUTING.md#L19) recommends `pnpm run cli:test:contract`, but no such script exists ([`package.json:46–68`](../package.json#L46)). The contract explicitly promises that this gate exercises the executable, validates JSON reports, and runs in `npm test`/the OS matrix ([`cli-contract.md:560–571`](cli-contract.md#L560)). `CONTRIBUTING.md:21` also points dashboard-filter coverage to `terminal/test/dashboard-filters.test.js`; the test is [`terminal/src/tui/__tests__/dashboard-filters.test.js`](../terminal/src/tui/__tests__/dashboard-filters.test.js).

**Impact:** Contributors are directed to a nonexistent command and stale test location, while a documented CLI compatibility gate is absent from the actual scripts.

**Recommendation:** Add and wire a focused executable contract suite covering discovery arrays, report envelopes, exit codes, and key errors; correct the filter-test path. Do not merely remove the documented gate.

**Focused verification:** Confirm the command exists, is reached by `pnpm test` and CI, validates report schemas/baselines, and all contributor paths resolve.

### Production TypeScript and type assertions use separate strict projects

**Evidence:** [`tsconfig.json`](../tsconfig.json) applies `strict: true` to production sources. [`tsconfig.type-tests.json`](../tsconfig.type-tests.json) extends that project, sets `noEmit: true`, includes TypeScript test roots, and clears the inherited production-test exclusion.

**Impact:** Production sources are checked strictly in the default project; type-only tests are checked separately without producing output.

**Recommendation:** Keep the type-test project focused on test roots and avoid duplicating production compiler options.

**Focused verification:** Run `pnpm run typecheck:tests` for type assertions and `pnpm run cli:build` for production sources.

### Inventory model test asserts source text rather than type behavior (proposal)

**Evidence:** The historical [`terminal/src/core/inventory/__tests__/model.test.js:8–20`](../terminal/src/core/inventory/) test read `model.ts` and matched interface declarations with regular expressions.

**Impact:** Harmless declaration restructuring can break the test, while equivalent contracts expressed differently can evade it.

**Recommendation:** Replace regex assertions with a checked-in type fixture exercising valid and forbidden shapes, as recommended for the inspection test.

**Focused verification:** Confirm the fixture compiles for valid data and rejects missing required fields and forbidden shapes.

### Bulk updates can reuse pinned Git acquisition (proposal)

**Evidence:** Each stale agent or instruction can independently clone and checkout the same repository/revision ([`terminal/src/core/installations/mutations.ts:280–317, 359–370`](../terminal/src/core/installations/mutations.ts#L280)); acquisition occurs in [`terminal/src/core/resources/content.ts:54–106`](../terminal/src/core/resources/content.ts#L54).

**Impact:** Bulk updates of several resources from one repo/pin repeat clone and checkout work.

**Recommendation:** Reuse one acquisition per repository and SHA within a bulk operation.

**Focused verification:** Extend the Git-trace fixture to assert clone count and exact content at an older pin.

## TUI, web, build, and release observations

The dashboard tests cover rendering, controls, filtering, actions, catalog freshness, and highlighting. The browser demo uses the shared Ink dashboard and states that its operations are simulated in memory ([`web/src/components/demo/TuiDemo.tsx:135–138, 225–227`](../web/src/components/demo/TuiDemo.tsx#L135)); no other confirmed user-visible TUI/web regression was established. The web component test command and web build are wired into CI ([`package.json:64–66`](../package.json#L64), [`.github/workflows/ci.yml:41–47`](../.github/workflows/ci.yml#L41)); Pages deploys a Vite build ([`.github/workflows/pages.yml:33–40`](../.github/workflows/pages.yml#L33)). Browser lifecycle coverage is the P2 gap above. Chromium-like browser behavior was not exercised.

## Suggested implementation order

1. Resolve CI blockers: define and wire the TUI test command, resolve the failing existing Changeset, and make the strict contract test cross-platform.
2. Fix lifecycle correctness: share install audit gating and make resource files plus inventory one transaction; then address shared revision tracking and collection rollback.
3. Improve catalog resilience and correctness: isolate index failures, guard name collisions, unify instruction parsing, and align schema/CLI behavior.
4. Address maintainability and contributor contracts: add the promised CLI contract gate, update stale instructions, expand strict typing, strengthen type tests, and consider bulk acquisition reuse.

## Verification limits and results

Core/CLI probes were performed against local compiled output with `KITIA_CONFIG_DIR=/dev/null`: `--help` and `doctor --network --json` exited 1; `migrate --help` exited 0. An in-memory Ajv probe accepted the committed inventory fixture and rejected the same fixture under `Anthropics`. These probes exercised local compiled output, not a packaged-install environment. The inspection-test Windows concerns are source-inferred, not reproduced on Windows.

The following two Changeset checks were run:

- `pnpm run changeset:format` **failed**. Exact reported errors: `.changeset/bright-oxfmt-format.md: add grouped details after the description`; `.changeset/bright-oxfmt-format.md: add a User-Facing or Technical group`.
- `pnpm changeset status` **passed** and reported a minor bump for `@grasdouble/kitia` from other Changesets on the branch.

No broad test suite, build, or formatter run was performed. `pnpm run docs:test` passed (2 tests, 0 failures) and was the only documentation check run after assembling this report's links. No Chromium-like browser runtime was exercised. Signatures prove signer and integrity, not that a resource or its upstream source is safe; dry-run plans are not transactions.
