# CLI compatibility contract

This document defines the public command-line contract, independently of the
catalog's resource content and the CLI's internal JavaScript organization.
Report version 1 identifies the JSON wire format and is independent of the
package version.

## Public surface and defaults

The public surface consists of command syntax, documented options and defaults,
JSON output, exit codes, and the supported installation-inventory formats.
`src/**/*.ts` and `src/**/*.mts` compile into the matching directory structure
under `dist/`; these modules are implementation details, not a supported
JavaScript SDK. The `bin/` entry point is the supported executable.
Human-readable messages, terminal colors, spacing and interactive layouts are
not machine interfaces.

| Command family | Contract |
|---|---|
| no command | Opens the dashboard by default; equivalent to `dashboard` |
| `list`, `search` | Discover resources; `--json` retains its existing array format |
| `show`, `preview` | Human-readable inspection; an omitted kind uses the normal ambiguity rules |
| `install`, `update`, `uninstall` | Mutate only when requested; `--dry-run --json` returns a plan, not an executed operation |
| `dashboard` | Interactive project/user inventory; `N` adds external catalogs, A/U/Delete request confirmed install/update/uninstall actions |
| `check` | Report installation state; `--json` returns a versioned report |
| `doctor` | Read-only diagnostics; network probes require `--network` |
| `validate` | Strict validation of all catalog sources |

Installation defaults to Copilot and the target defaults to the current
directory. Updates preserve registered runtimes; they do not silently remove
resources absent from the current catalog. `--force` remains explicit and does
not bypass path safety, operation locks or unsupported inventory formats.
JSON maintenance previews imply non-interactive behavior.

`--scope project|user` is an additive option for `install`, `update`,
`uninstall`, `check`, and `doctor`. Source skill lifecycle commands use the
generic commands with `--catalog <source-name>`.
Omitting it preserves all project defaults. User scope supports skills, agents,
MCPs and bundles without instructions,
resolves the target with Node.js `os.homedir()`, and rejects `--target`.
Locally managed and source user skills use `.agents/skills` (Copilot) and
`.claude/skills` (Claude), relative to that home. Source delegation specifies
`--dir` explicitly so upstream defaults cannot change the managed location.
User agents use `.copilot/agents/<id>.agent.md` for Copilot CLI and
`.claude/agents/<id>.md` for Claude Code. Personal Copilot agent discovery in
IDEs is not guaranteed. Instructions and tracked project-style agents with
`.github/agents` files are excluded from user-scope checks and maintenance.
Installing a personal agent cannot silently replace such a project-style
record, even with `--force`; explicit cleanup with `--target` is required.
Inventories and operation locks are target-local, so the two scopes are
managed independently. Inventory format upgrades are explicit; see the
[inventory migration guide](inventory-migrations.md).
Read-only commands and previews do not create home configuration directories.
`dashboard` reads both scopes; if one inventory is unsupported, it displays the
other scope and reports the failing scope explicitly instead of rewriting it.
Dashboard actions require confirmation and use the normal lifecycle checks,
operation locks, and conflict protections; they never imply `--force`.
New installations can choose project/user scope and Copilot/Claude/both
clients; instructions remain project-scoped. Press `F` to enter filter mode and
`D` to toggle the selected resource's details panel in inventory and catalog
browsing or catalog management.
The inventory's Catalog column shows the configured source-catalog name for a
tracked artifact with source-repository metadata. For a custom user catalog, it
adds the folder selected by the saved path mapping, such as
`MattPucock[engineering]`. Untracked artifacts and managed records without a
source association display `-`.

From inventory, uppercase `A`/`U` install or update resources, and `Delete`
uninstalls the selection. Press `M` for catalog management; there, `A` adds a
catalog, `Delete` removes the selected catalog, `E` edits its name, repository,
setup mode and custom paths, and `R` refreshes catalogs.
The management screen compares each local index's commit with its repository's
default-branch HEAD; unreachable repositories show `UNKNOWN`. Refresh updates
metadata indexes only; use `U` in inventory to update installed resources.

The edit dialog is prefilled from the selected catalog. In custom mode, use
`↑`/`↓` to select a path, `Delete` to remove it, `A` to add a file or directory,
then `Enter` to save and rebuild its index. Editing does not change installed
resources; use `U` in inventory to update an installed resource.

Custom user catalogs accept repository-relative files or directories. A skill
mapping can point to one skill directory containing `SKILL.md` or to a parent
directory containing multiple nested skills. Agent and instruction mappings can
point to a Markdown file or a directory of Markdown artifacts. Resource IDs are
derived from skill directory names or Markdown filenames.

Inventory labels use the saved mapping path, not the resource ID. A directory
mapping uses its basename when it directly contains resource folders; if a
mapping covers skills nested at least two folders below it, each resource is
grouped by the first folder below the mapped directory (so a `skills` mapping
labels `skills/engineering/review` as `Catalog[engineering]`). A skill
directory mapping uses that directory's name; a mapping ending in `SKILL.md`
uses the containing category folder for a nested skill, falling back to the
skill folder when there is no category level. An agent or instruction file
mapping uses the file's containing directory. The most-specific path mapping
for the resource kind wins. An explicit mapping ID matches only resources with
that ID, even when other resources share its source path; it does not rename
the folder label. If configured folders share a basename, the shortest
trailing path that distinguishes them is shown inside the brackets within the
same resource kind. Basic catalogs, custom resources without a matching saved
mapping, and catalogs whose saved custom configuration is unavailable retain
the plain catalog name.


For automation, specify the kind and source catalog when selecting a user-managed
catalog resource: `install skill <id> --catalog <source-name>`. Adding catalog
content can make an unqualified ID ambiguous. Unknown kinds are never reinterpreted
as another kind.

Uninstalling a locally managed resource required by one or more installed bundles
offers a cascade in an interactive terminal and lists the bundles and additional
dependencies before asking for confirmation. Non-interactive removal requires
`uninstall <kind> <id> --cascade`; without it, the CLI refuses and names the
dependent bundles. `--dry-run --json` shows the cascade plan without changing
files or inventory, and does not require `--cascade`. The cascade removes the
selected resource and dependent bundles in one planned operation, while
preserving dependencies still used elsewhere or installed independently.
`--force` is still required to remove locally modified resource files and does
not override MCP configuration conflicts.


## User-registered catalogs

The interactive dashboard adds a user catalog with `N`, then asks for a name,
HTTPS GitHub URL, and setup mode. Press `R` to choose a user catalog to remove;
its repository URL appears beside its name. Confirm before Kitia deletes its
local definition and index. Installed artifacts from that source stay in place.

- **Basic** discovers nested `skills/**/SKILL.md` entries and Markdown resources
  in `agents/`, `.agents/agents/`, `.claude/agents/`, `.github/agents/`,
  `.copilot/agents/`, `instructions/`, `.agents/instructions/`, `.claude/rules/`,
  and `.github/instructions/`. Agent and instruction IDs come from the basename.
  Basic and Custom instructions without scope frontmatter apply globally
  (`["**"]`); `apply_to`, `applyTo`, or `paths` narrows that scope. **Custom**
  indexes only user-added entries with an explicit kind and repository-relative
  path. Skills use the directory containing `SKILL.md`; agents and instructions
  use a Markdown file. IDs come from the basename.

The dashboard inventory also scans known project and user install locations:
`.agents/skills`, `.claude/skills`, `.agents/agents`, `.claude/agents`,
`.github/agents`, `.copilot/agents`, `.agents/instructions`, `.claude/rules`,
and `.github/instructions`. Files without a Kitia installation record appear
with catalog `-` and status `unmanaged`; Kitia does not update or uninstall
them. Their detected paths appear in the description.

`kitia catalog add <name> <https-github-url>` performs Basic setup without the
dashboard. Both paths clone the repository temporarily, pin the index to its
current commit, then store only metadata and user path mappings under
`~/.config/kitia/` (or `$KITIA_CONFIG_DIR`). Artifact bodies remain upstream.
Each source is independent; `catalog list` displays user-managed sources, and
`catalog remove <name>` removes only a user source definition/index. It does
not remove already-installed artifacts; tracked installations can still be
removed with `uninstall <kind> <id> --catalog <name>`.

Use `G` in the dashboard to choose a single catalog or all user catalogs to
refresh. `kitia catalog refresh <name>` refreshes one source, and
`kitia catalog refresh --all` refreshes every user source. A refresh fetches the
current upstream commit and replaces that source's metadata index; configuration
and already-installed artifacts remain unchanged. Bulk refresh continues after
individual failures and exits nonzero if any source failed.

Discovery reads user indexes locally. Skills install through `gh skill` at the
refreshed pin; agents and instructions are fetched from that pinned commit and
installed through Kitia's normal managed-file inventory.
Offline preview and source installation/update execution are refused; registry indexes remain local and require no network fetch.


## JSON formats

Machine-readable schemas ship with the package:

- [Discovery arrays](../schemas/cli-discovery-v1.schema.json)
- [Reports, version 1](../schemas/cli-report-v1.schema.json)
- [Installation inventory formats and migrations](inventory-migrations.md)

Discovery schema versions are identified by the schema filename; the public
discovery payload remains an unwrapped JSON array. Report envelopes include
their schema version in `schema_version`.

### MCP and bundle setup

`bundle` and `mcp` are local resource kinds for discovery, show/preview and the
generic install/update/uninstall commands. Bundle recipes reference local
skills/agents/instructions/MCPs. MCPs can be installed independently, for example
`install mcp <mcp-id> --scope user --tool both`.
MCP and bundle targets are exclusively Copilot CLI (`--tool copilot`) and Claude Code
CLI (`--tool claude`), or both CLI clients (`--tool both`). Bundle compatibility
keys refer only to these CLIs, not their desktop applications or IDE integrations.
Other applications may discover the same files; that does not extend bundle
support or imply an additional runtime target.
See [bundle setup](bundles.md) for configuration paths, ownership and limitations.

`--input <mcp-id>.<input>=<value>` supplies non-secret parameters to an MCP/bundle
install/update; secret inputs are rejected without echoing their values.
`--yes` confirms the setup plan for non-interactive execution. Both options
require MCP/bundle installation/update; previews need neither confirmation nor
secret variables. A missing required ordinary input is an execution error,
or a warning in a dry-run plan. Stdio MCP entries invoke the declared executable
directly, with `${VARIABLE}` secret references (or `${VARIABLE:-}` for optional
secrets) resolved by the CLI at startup, never by the installer. No JavaScript
launcher is generated. Missing-variable diagnostics depend on the client/server;
the catalog no longer enforces an early runtime check through a launcher.
HTTP entries register their HTTPS URL without executable checks. Installation
never starts servers, downloads packages, probes endpoints or completes OAuth.

MCP/bundle setup tracks dependency ownership and native MCP entries. Native MCP
records have an empty `files` map because only server entries are managed.
Modified or untracked launchers are never removed. Unknown inventory versions
and resource kinds fail before any delegation.
MCP JSON files are shared containers: the CLI owns only its recorded server
entries, not other servers or client settings. Direct dependency removal is
blocked while bundles reference it. `--force` never takes over a pre-existing
MCP or replaces a locally modified MCP entry.

Independent MCP records set `standalone: true` and retain their `tool` and
`scope`. Bundled-only MCPs set `standalone: false`. Removing a bundle preserves an
independently installed MCP. Updating a dependency does not promote ownership;
explicit installation does. Standalone MCP removal is refused while any bundle
still references it. MCP setup adds requested runtimes to existing registrations,
without silently pruning the other client. Narrowing that set requires explicit
uninstall/reinstall after dependent bundles are removed.

MCP resource IDs are stable across metadata updates. Bundle recipes reference
resources available to the local resource machinery.

Reports and discovery keep their version-1 envelopes and arrays. Source-backed
resource identities include their configured catalog; local resource identities
omit a catalog. Configured-resource previews add MCP, bundle, and local dependency
identities; shared client configuration actions may have a null resource identity.
Additional error codes include `MISSING_CONFIGURATION` and `MISSING_PREREQUISITE`.

`list --json` and `search --json` emit a single JSON array on stdout, including
an empty array when there are no results. Aggregate discovery entries include
`catalog`; use `--catalog <source-name>` to discover and search entries in a
configured source. The default `community` source retains its upstream-reference
fields. Machine-specific
`source` paths are not emitted in machine-readable output.

`check --json`, `doctor --json`, and `install/update/uninstall --dry-run --json`
emit one object with these required fields:

| Field | Meaning |
|---|---|
| `schema_version` | `1` |
| `command` | Requested operation; a delegated source plan uses `install` or `uninstall` |
| `dry_run` | Whether this is an operation preview |
| `status` | `ok`, `attention`, or `error` |
| `resources` | Identities (`kind`, `id`, and `catalog` when source-backed), with `current`, `attention`, or `planned` status |
| `actions` | Planned action, target-relative `path` (or null), and resource identity (or null for shared inventory work) |
| `warnings` | Diagnostics containing a `code` and human-readable `message` |
| `messages` | Human-readable context; never parse this to determine behavior |
| `errors` | Diagnostics containing a `code` and human-readable `message` |

Check resource records include `issues` with `code` and affected `paths`.
Current issue codes are `LEGACY_INSTALLATION`, `MISSING_FILES`,
`LOCAL_MODIFICATIONS`, `REMOVED_FROM_CATALOG`, `DEPRECATED`,
`UNSUPPORTED_RUNTIME` and `UPDATE_AVAILABLE`.
Doctor reports additionally include `checks` with `id`, `status`
(`ok`, `warning`, `error`, `skipped`) and `message`.
Reports for an explicit `--scope` additionally include `scope` and the absolute
`target` root. Action paths remain relative to that root on every platform.
Delegation actions include `command.program` and `command.args`; source previews
do not claim to enumerate auxiliary files managed by `gh skill`.
Current planned actions are `install`, `overwrite`, `unchanged`, `remove`,
`forget` and `delegate_install`. `forget` removes tracking for an already
missing entry point and has a null path.

Argument and execution errors in JSON mode also use the versioned report
envelope. Partial discovery is different by design: stdout remains an array,
stderr contains JSON warning records, and the command exits with `1`.
Ordinary report diagnostics are inside the report; child-process/runtime
diagnostics may still appear on stderr.

Resource, issue and action array order is not an execution contract. Match
records by identity, code or path rather than by position. A plan is not a
transaction or permission to manipulate files directly; run the CLI operation
so its ownership, conflict and path checks remain in force.

## Exit codes and errors

| Operation | Success | Attention required | Execution/argument failure |
|---|---|---|---|
| Human-readable `check` and `doctor` | `0` | `1` | `1` |
| JSON `check` and `doctor` | `0` | `2` | `1` |
| JSON lifecycle preview | `0` | N/A | `1` |
| Discovery | `0` | `1` for incomplete sources | `1` |
| Other commands | `0` | N/A | Nonzero; delegated `gh` failures may retain its exit code |

A doctor finding such as an unavailable executable is a diagnostic result
requiring attention, not necessarily a failure to execute doctor itself.

Defined codes include `INVALID_ARGUMENT`, `RESOURCE_NOT_FOUND`,
`AMBIGUOUS_RESOURCE`, `LOCAL_CONFLICT`, `UNSUPPORTED_RUNTIME`,
`CATALOG_UNAVAILABLE`, `OPERATION_LOCKED`, `STALE_OPERATION_LOCK`,
`OPERATION_LOCK_CHANGED`, `UNSUPPORTED_INVENTORY_VERSION`,
`INVENTORY_MIGRATION_REQUIRED`, `UNSUPPORTED_CATALOG_VERSION` and
`UNSUPPORTED_RESOURCE_KIND`.
Other catalog failures use `CATALOG_ERROR`; system failures can retain their
system code. Consumers must handle unknown error codes as errors, without
depending on the wording of `message`.

## Compatibility rules

Within report version 1:

- Do not remove a required field, change its type or meaning, or change the
  defined status/exit-code meanings.
- New optional fields are additive. Readers ignore fields they do not use.
- Kind, catalog, action, issue-code and diagnostic-code strings are extensible.
  Consumers must handle an unknown value explicitly rather than assuming a
  fixed exhaustive list.
- Resource content, metadata text and the number of discovery results are not
  frozen API data.
- A breaking JSON format requires a new schema version and an explicitly
  selected new format or a documented major CLI migration. There is currently
  no second report format. Never silently wrap existing discovery arrays.
- Removing commands/options, changing defaults, or changing existing option
  semantics requires a documented major CLI migration. Adding an opt-in
  command or option is additive.

The schema version covers the wire format; the package version covers the
implementation. Pin a full Git commit when callers need a reproducible CLI version.
## Catalog and inventory compatibility

Inventory schema and migration details are documented in the
[inventory migration guide](inventory-migrations.md). This contract only
defines the CLI-visible behavior: unsupported inventory versions require
explicit migration; unsupported resource kinds fail before delegation.
Unsupported catalog versions are reported explicitly.
Discovery can preserve other available sources with a nonzero exit status;
operations requiring an unsupported source fail. Use a compatible CLI instead
of treating a newer format as corrupt.

Filesystem safety rules still apply after migration: legacy skill discovery
reads only `<skill>/SKILL.md` directly below each recognized skill directory,
does not recursively inspect skill auxiliary content or `node_modules`, and
checks symlinks at entry points, managed destinations and inventory-tracked
paths. These protections cannot retroactively change older binaries already
distributed.

## Regression gate

`npm run test:contract` exercises the CLI executable in isolated synthetic
catalogs, validates complete JSON reports against the schemas and compares
stable fields against committed version-1 expectations. Human-readable text
and object/array ordering are deliberately not frozen.

Historical version-1 inventories are read from committed fixtures rather than
created by the current writer. Future-version and unsupported-kind scenarios
verify that files remain byte-for-byte unchanged even when `--force` is used.
The suite is included in `npm test` and therefore in the existing Node.js 22/24,
Linux/macOS/Windows CI matrix.

Do not update a baseline merely to make a regression green. Explain whether a
change is additive or breaking, preserve old behavior where promised, and
update the contract/version/migration deliberately when a break is necessary.
