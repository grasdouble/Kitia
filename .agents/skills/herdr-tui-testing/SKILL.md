---
name: herdr-tui-testing
description: "Use only when the user explicitly requests a Kitia TUI test. Do not use for routine CLI, unit, or non-interactive tests. Requires HERDR_ENV=1."
---

# Testing Kitia's TUI in Herdr

Activate this skill only for an explicit Kitia TUI test request. Do not activate it for routine CLI, unit, build, or other non-interactive tests.

## Read the control guides first

Before using Herdr, read the official `skill://herdr` skill and the installed Herdr App guide at `~/.config/herdr-app/AGENTS.md` (or `$HERDR_APP_HOME/AGENTS.md` when set). Treat those installed guides and command help as authoritative; do not guess syntax. Herdr App (`herdr-app`) controls what is shown in the window. Herdr Core (`hc`) runs and reads terminals. Do not use the older `herdr` CLI for this workflow.

Before any Herdr control command, require this check to succeed:

```bash
test "${HERDR_ENV:-}" = 1
```

If it fails, explain that you are not running inside a Herdr-managed pane and stop without inspecting or controlling a Herdr session. Never set `HERDR_ENV` or any Herdr ID yourself.

## Find the repository space

Use read-only `herdr-app status` and `herdr-app ls` to inspect the current window and its spaces. Select a space only when exactly one observed space has `folder` exactly equal to `$PWD`. Use its returned space ID; never guess an ID. If no space matches or more than one matches, stop without changing focus or layout and report the result. Do not inspect or act on terminals in other spaces.

Before any focus change, tell the user that `space.select` switches the visible space and `terminal.open --place tab` opens and focuses a new test tab. Perform that switch only when the user explicitly asks to see the dashboard/test running. If they do not ask to see it, preserve the current app focus: use a documented `hc run --bg` flow only when Core background execution is suitable for the requested test; otherwise explain the limitation and do not open a visible tab.

For a requested visible run, tell the user the exact command and expected dashboard/test result, then select the matching repository space and open one visible tab:

```bash
herdr-app do space.select --id <observed-space-id>
herdr-app do terminal.open --folder "$PWD" --place tab --name "Kitia TUI test" --argv '<JSON string array>'
```

`terminal.open` accepts `argv`, `folder`, `place`, and `name`; `place` defaults to `tab`. `herdr-app do` accepts `--key value` arguments, with JSON for arrays and objects. A dashboard argv is a JSON array of the executable and its arguments. For example, launch through a login shell as `--argv '["zsh","-lc","<exact command>"]'`. Parse the command response and retain its returned space, tab, terminal, and any pane IDs. A successful response proves creation only, not that the program started. Never derive IDs or act on another tab/terminal.

## Choose and run the dashboard command

- If Kitia source code changed since the last successful build, use `pnpm run cli:build && node cli/bin/kitia.js dashboard` inside `zsh -lc` in the new terminal. If `pnpm` is unavailable or the build fails, stop and report the actual error. Never silently launch an existing `cli/dist` as a fallback to a failed or missing build.
- For a visual test with no relevant source changes, `node cli/bin/kitia.js dashboard` may be used only when the existing CLI build is known to correspond to the current source. If that is not known, do not assume the built output is current; report the prerequisite instead.

Do not substitute another TUI surface. Perform only the interaction scenario the user requested; do not invent test behavior or keypresses. If no functional interaction was requested, launch and observe the dashboard without a scenario.

## Safe background helper

The helper creates a separate Herdr Core background terminal even though it
does not open a visible tab or change app focus; its start/exit notices may
appear in the user's session. Before invoking it, explain this side effect and
obtain explicit authorization to create that terminal. Approval to add or run a
test is not, by itself, approval to create a Herdr terminal. Without consent,
do not invoke the helper; report that the Termless run requires authorization.

Core may not inherit the current shell's `PATH`. For Node-based tests, resolve
the executable with `node -p 'process.execPath'` and pass that absolute path
after `--` instead of retrying with a login shell if `node` is unavailable.

When the user does not ask to see the TUI, use the repo-local helper to start
the exact requested command without changing visible app focus:

```bash
.agents/skills/herdr-tui-testing/scripts/kitia-tui run -- node cli/bin/kitia.js dashboard
```

Build first when relevant source changed (using the documented build procedure
in the preceding section), and wait for it to succeed before starting the
dashboard. The helper runs `hc run --bg` with argv, does not add `herdr.space`
or `herdr.tab` labels, and prints the returned terminal ID. Keep that ID;
inspect or stop only that terminal:

```bash
.agents/skills/herdr-tui-testing/scripts/kitia-tui read <returned-terminal-id>
.agents/skills/herdr-tui-testing/scripts/kitia-tui kill <returned-terminal-id>
```

It requires `HERDR_ENV=1` to be present already and never sets it. It does not
select a space/tab or open a visible terminal. Use only for background-safe
commands; if the requested interaction requires a visible terminal, follow the
explicit visible-run procedure above instead. For Termless tests, use the
actual test file after building the CLI when needed and confirming Node.js >=23.6:

```bash
.agents/skills/herdr-tui-testing/scripts/kitia-tui run -- node --test web/test/termless-dashboard.test.mjs
```

The helper does not build or fall back to existing `cli/dist`; preserve and
report any command or startup error.

## Verify and report

For a visible run, use `herdr-app status` and `herdr-app ls` to confirm the
selected space and newly created tab/terminal are active and visible. Use only
the terminal ID returned by `terminal.open` to inspect output:

```bash
hc read --lines 80 <returned-terminal-id>
```

For a background run, preserve app focus: inspect only the ID printed by the
helper with its `read` subcommand. Do not use `herdr-app status`/`ls` as a
reason to select or open anything. If output is incomplete or the process is
still running, report the evidence gathered; do not infer a pass. Confirm the
observed Kitia dashboard output (for example, its `INVENTORY` header) and
report the exact command, evidence, any error, and whether the requested
interaction was completed.

## Cleanup and user visibility

After a visible run, including after a failed test, stop only the terminal
returned by this invocation unless the user asked to keep or see the dashboard:

```bash
herdr-app do terminal.kill --terminal <returned-terminal-id>
```

For background runs, use the helper's `kill` subcommand with only the ID it
printed for this invocation.

Close the created tab only if `herdr-app ls` confirms that another tab remains in its workspace:

```bash
herdr-app do tab.close --id <returned-tab-id> --confirmed true
```

If no other tab remains, do not close the tab or workspace. Never close any other terminal, tab, space, or workspace. If the user asks to keep or see the dashboard, leave the created terminal and tab open and visible until the user asks to close them.

Never edit `~/.config/herdr-app`, its guide, layouts, or settings.
