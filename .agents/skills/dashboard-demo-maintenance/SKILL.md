---
name: dashboard-demo-maintenance
description: Maintain Kitia's browser terminal demo at /demo and keep it aligned with the real Ink TUI. Use when updating the demo or changing dashboard screens, keyboard controls, action contracts, resource lifecycle, catalog management, previews, or terminal rendering that can affect it. Preserve the earlier web-style demo at /demo-keep.
---

# Maintaining the dashboard demo

Keep `/demo` faithful to the local dashboard by running the shared Ink components and keyboard handlers. Only operation handlers are simulated. The deployed site is static GitHub Pages; it must not require a backend or a local CLI process.

## Source map

Inspect the relevant current files before editing; follow their imports if the structure has changed.

- `cli/src/dashboard/dashboard.mts`: shared Dashboard component, state transitions, action contracts, confirmations, and keyboard handlers.
- `cli/src/dashboard/screens/`, `modals.mts`, `helpers.mts`, and `source-highlighting.mts`: shared layout, panels, filters, and syntax highlighting. Do not copy these implementations into the website.
- `cli/src/dashboard/colors.ts`: shared TUI semantic roles and renderer-specific ANSI codes/palette under `terminalAnsi`. Do not add browser-specific semantic roles or component-local color literals; selected rows override kind/status colors.
- `web/src/components/demo/TuiDemo.tsx` and its CSS module: page wrapper, terminal lifecycle, reset/quit states, and on-screen key buttons.
- `web/src/components/demo/browserTerminal.ts`, `terminalRuntime/`, and `web/browserInkPlugin.ts`: xterm/Ink bridge and scoped browser compatibility.
- `web/src/components/demo/terminalTheme.ts`: ANSI-to-CSS resolution and xterm theme. Reuse the shared ANSI palette used by the TUI screenshots; page surfaces and borders use website CSS tokens, not another dashboard palette.
- `web/src/components/demo/tuiDemoSession.ts`, `demoData.ts`, and `tuiDemoSession.test.mjs`: isolated operation handlers, sample content, and behavioral coverage.
- `web/src/router.tsx`, `main.tsx`, `App.tsx`, `web/pages/demo/index.html`, and `web/vite.config.ts`: typed client-side routes, persistent layout, lazy demos, route metadata, and static deep-link entrypoints.
- `web/src/components/demo/DashboardDemo.tsx` and its CSS module, plus `web/pages/demo-keep/index.html`: preserved web-style demo. Its fixture data is shared; changes to `demoData.ts` can affect both demos.

## Maintenance workflow

1. Identify the changed TUI behavior and its applicable interfaces. Read the shared Dashboard action contract and existing demo handlers before inventing a new API.
2. Reuse the shared renderer. A screen/layout/shortcut change should normally flow into `/demo` through the existing imports, not a second implementation. Keep the actual installed Ink renderer; do not replace it with screenshots, prerecorded output, HTML imitations, or a different Ink version.
3. Update the in-memory handler when the operation contract changes. Return complete results in the shape consumed by Dashboard and apply real changes to the private fixture store. Do not report success for an unimplemented operation.
4. Update the wrapper's on-screen keys and guidance when shortcuts change. Buttons send the same input sequences as a terminal; do not bypass the shared state machine or confirmation dialogs. Keep ordinary browser navigation usable outside the terminal.
5. Check both routes. Preserve `/demo-keep` and its behavior unless explicitly asked to change it. Keep home/navigation links pointing to `/demo`; retain a discoverable link to the preserved version.
6. Use TanStack Router links for internal navigation. Preserve static HTML entrypoints for direct visits, keep the terminal lazy, and verify that route exits dispose its renderer without reloading the document. Route titles and analytics page views must follow committed routes; section hash changes must not create extra page views.

## Fixture invariants

Check every applicable combination, not only a skill in project scope:

- Skills and agents: project and user scope; Copilot, Claude, and both clients.
- Instructions: project scope only; unsupported user scope must fail explicitly.
- Install/update/uninstall: independent scope ownership, destination conflicts, selected revisions, and registered client paths. Updating preserves clients; force must not silently overwrite another resource owner.
- Preview: show the bundled source corresponding to the selected catalog or installed revision, with truthful source tree and audit text. Unmanaged resources keep their own preview/removal behavior and confirmations.
- Catalog refresh: change catalog metadata without rewriting installed content. Rename/removal retain installed ownership and content according to the CLI contract; retained resources remain previewable/removable.
- Catalog import/export: parse and produce real configuration data. Export succeeds only if the actual clipboard operation succeeds; explain unavailable browser capabilities instead of fabricating success.
- Sessions: stores are private, returned snapshots cannot mutate them, and reset/reload restores the starting fixtures.

No handler may access GitHub, host files, real installations, or authentication credentials. Arbitrary repository inputs must be identified as bundled-fixture simulations. Never claim that a security audit or filesystem safeguard ran. Keep this exception explicit around the terminal and in preview audit output, including when unchanged TUI wording describes real CLI safeguards.

## Browser runtime invariants

- Keep compatibility adapters scoped to the terminal module graph. Do not patch global `process`, `Buffer`, timers, or the page's React runtime.
- Keep semantic roles shared with the TUI. Resolve them for CSS in `terminalTheme.ts`; keep ANSI palette values centralized under `DASHBOARD_THEME.terminalAnsi` and never duplicate them in the browser or screenshot generator.
- Supply real xterm dimensions and resize events. Preserve line-feed/carriage-return behavior so Ink frames do not drift or wrap incorrectly.
- A mount owns its terminal host and listeners. Reset, quit, navigation, initialization failure, and cancellation of a pending mount must release streams, Ink effects, observers, and terminal resources without removing a newer session.
- Keep initialization errors visible. Unsupported host facilities fail clearly; they must not return fake empty filesystem/process results.
- Preserve lazy loading, static deployment, screen-reader output, and focus-owned keyboard input. Verify development dependency optimization as well as production bundling after bridge/plugin changes.
- Check narrow layouts visually. Keep terminal text readable, all relevant panels/shortcuts reachable, and page controls usable without horizontal page overflow.

## Verification

Run the narrowest relevant checks once after editing:

```sh
node --test web/src/components/demo/tuiDemoSession.test.mjs
pnpm run web:build
```

The first exercises fixture semantics; the second checks static routes and the browser bundle. Use `pnpm run web:test:components` instead of the individual test when navigation or other web components also changed. Add focused regression coverage for uncovered consumer-visible edge cases, not source-text assertions or wiring checks. If shared CLI behavior changed, run its relevant CLI/TUI tests too; browser simulation is not proof of real filesystem safety.

Launch `pnpm run web:dev` and open the actual page. After a build, use `pnpm exec vite preview --config web/vite.config.ts` to inspect the production output. Use the displayed URL/port.

Exercise the affected native TUI paths, including search/filter, selection, install options and confirmation, revision replacement, preview panes, update/uninstall, catalog actions, and guide when applicable. Verify on-screen key buttons, keyboard focus, reset during initialization, quit/restart, desktop-to-mobile resizing, and `/demo-keep` preservation when the change can affect them.

Wait for a complete destination frame and the dismissed modal's absence before sending another key. Background headings and increasing output length are not readiness signals. Standalone Escape needs decoding time; wait for its visible effect rather than sending the next key immediately or inserting fixed sleeps. Browser automation may read xterm's accessibility rows and capture screenshots, but must not alter application state to manufacture a passing scenario.

## Documentation and delivery

Update `CONTRIBUTING.md` when maintenance steps or intentional browser limitations change. Follow the changeset-management and changeset-authoring skills: update an existing Changeset for the same work, use a no-bump Changeset for website/skill-only changes, and never edit `CHANGELOG.md` manually. Validate Changesets when changed.

Report the affected routes, maintained TUI parity, explicit simulation limits, and only the checks and browser scenarios actually observed. Do not describe the demo as a real GitHub/filesystem execution environment.
