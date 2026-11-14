# CLI compatibility contract

This document defines the public command-line contract, independently of the
catalog's resource content and the CLI's internal JavaScript organization.
Report version 1 identifies the JSON wire format and is independent of the
package version.

## Public surface and defaults

The public surface consists of command syntax, documented options and defaults,
JSON output, exit codes, and the supported installation-inventory formats.
`cli/src/**/*.ts` and `cli/src/**/*.mts` compile into the matching directory
under `dist/`; these modules are implementation details, not a supported
JavaScript SDK. The `cli/bin/` entry point is the supported executable.
Human-readable messages, terminal colors, spacing and interactive layouts are
not machine interfaces.

On interactive dashboard launch, Kitia checks npm for a newer stable release.
Every dashboard screen uses a compact three-row header: a three-line cat at left
and `KITIA`, the version/screen name, and screen-specific metadata at right.
The cat and title use semantic theme colors, not an animated gradient. After a
randomized 10–20-second rest, the cat randomly shows a lick or scratch for 2–4
seconds or a wink for 180 ms; it stays in place. While the version check is
pending, the version slot reads `Checking version update`; afterward it shows
the installed version or `<installed> - New version available`. Check failures
are silent. Other commands and non-interactive launches skip the check.

| Command family | Contract |
|---|---|
| `list`, `search` | Discover resources; support `--catalog`, `--kind`, `--tag`, `--status`, and `--license`; `--json` retains its existing array format |
| `show`, `preview` | Human-readable inspection; an omitted kind uses the normal ambiguity rules |
| `install`, `update`, `uninstall` | Mutate only when requested; `--dry-run --json` returns a plan, not an executed operation |
| `versions <kind> <id>` | List up to 500 newest GitHub commits affecting a skill entrypoint or an agent/instruction Markdown file, with abbreviated SHA, committer date and commit subject; supports `--catalog` |
| `dashboard` | Interactive project/user inventory; `N` adds external catalogs, A/U/Delete request confirmed install/update/uninstall actions |
| `check` | Report installation state; `--json` returns a versioned report |
| `doctor` | Read-only diagnostics; network probes require `--network` |
| `validate` | Strict validation of all catalog sources |
| `collection export`, `collection import` | Share versioned pinned references to selected resources; collections contain no resource content and do not install resources |


Installation defaults to Copilot and the target defaults to the current
directory. Updates preserve registered runtimes; they do not silently remove
resources absent from the current catalog. `--force` remains explicit and does
not bypass path safety, operation locks or unsupported inventory formats.
JSON maintenance previews imply non-interactive behavior.

`kitia versions <kind> <id> [--catalog <name>]` supports skills, agents, and
instructions. It uses `gh api` against the GitHub commits endpoint, filtered
to `<source_path>/SKILL.md` for skills and the exact Markdown file path for
agents and instructions. History covers commits affecting that file only;
supporting files are not listed. Results are newest first and bounded to five
pages of 100 commits; displayed dates are commit committer dates. GitHub CLI
authentication and network access are required.
`kitia install <kind> <id> --ref <sha-or-prefix>` and the corresponding
targeted `kitia update <kind> <id> --ref <sha-or-prefix>` use that commit for
this operation without changing the catalog index pin. The installed inventory
records the chosen full SHA, so a later ordinary update returns the installation
to the catalog pin. A hexadecimal prefix must be at least 7 characters and is
resolved only against the selected resource's listed history; ambiguous or
unknown prefixes are rejected. Full 40-character commit SHAs remain accepted.
`--ref` is supported only for GitHub source skills, agents, and instructions.
When an installed GitHub source resource ref differs from its catalog pin,
`check` and dashboard inventory compare the latest commit affecting its source
file at each ref. For skills, `source_path` is a directory and the history path
is `<source_path>/SKILL.md` (supporting files are not covered by this
entrypoint history); for agents and instructions, `source_path` is the exact
Markdown file path. Thus unrelated repository commits do not imply a resource
update. Resources without a supported GitHub repository/file path retain exact
pin comparison. Path-history checks require GitHub CLI authentication and
network access. If either lookup fails or is invalid, `check` reports an error
(dashboard inventory reports a scope scan error); it must not report the
resource as current.
`--audit` is opt-in and applies only to `preview` and `install` of pinned
source-catalog resources; it is not an update check. It is rejected for other
commands and for resources without pinned source metadata. Preview reports
findings and coverage but continues. An audited install is blocked if any rule
matches or coverage is incomplete, including skipped files. The deterministic
checks are intentionally limited and are not an exhaustive security analysis:
neither a complete scan nor an empty findings list guarantees that a resource
is safe. See the [resource audit guide](resource-audit.md) for the rules and
coverage limits.

`--scope project|user` is an additive option for `install`, `update`,
`uninstall`, `check`, and `doctor`. External source lifecycle commands use the
generic commands with `--catalog <source-name>`.
Omitting scope preserves project defaults. User scope supports skills and
agents, resolves the target with Node.js `os.homedir()`, and rejects `--target`.
Source delegation specifies `--dir` explicitly so upstream defaults cannot
change the managed location. User agents use `.copilot/agents/<id>.agent.md`
for Copilot CLI and `.claude/agents/<id>.md` for Claude Code. Instructions are
project-only. Inventories and operation locks are target-local, so the two
scopes are managed independently. Inventory format upgrades are explicit; see
the [inventory migration guide](inventory-migrations.md).
Read-only commands and previews do not create home configuration directories.
`dashboard` reads both scopes; if one inventory is unsupported, it displays the
other scope and reports the failing scope explicitly instead of rewriting it.
Dashboard actions require confirmation and use normal lifecycle checks,
operation locks, and conflict protections; they never imply `--force`.
Long-running dashboard operations show a centered blocking popup with an
animated spinner and progress label. Input is ignored until the operation ends.
Operations that can block run in a worker thread so rendering and animation
continue during the work.
When Inventory or Browse selection details are clipped, PageUp/PageDown moves the
detail viewport without changing the selected resource. Paging is available
while list or contextual-action focus is active; Search, filter menus, and modals
retain their own keyboard input. The footer and panel hint show the paging
shortcut only while the details pager can receive it.
Preview uses a dedicated screen below the dashboard header and opens directly
on source-file content, not an initial tree page. With enough terminal width
and height, source files occupy the main pane on the left; the right sidebar
stacks `AUDIT REPORT` above `SOURCE TREE`. On narrow or short terminals, one
focused pane fills the available content area instead. Press `S`, `A`, or `T`
to focus source, audit, or tree; `Tab` cycles those panes and `Shift+Tab` cycles
backward. Left/Right or PageUp/PageDown navigate only the focused pane. Each
pane retains its own page when focus changes, and pagination adapts to the
available pane width and height. Enter or Esc closes Preview.
The source pane groups its title, page counter, and filename into a distinct
header above a theme-colored divider. The audit and tree panes likewise separate
their existing title and page counter from the body with one divider row; they
do not gain filename rows. Header rows are reserved separately from each pane's
body pagination, including in narrow and short-terminal layouts.
Preview preserves Markdown source bodies, including tables, rules, frontmatter,
and fenced examples. Source-only syntax colors distinguish Markdown headings,
emphasis, links and code, plus comments, keywords, strings and other supported
code tokens. Colors do not render Markdown or alter source characters, whitespace,
line wrapping, page boundaries, filenames, audit text or tree text. Tokenization
covers each complete logical file before wrapping and pagination, so multiline
comments, strings and fenced blocks retain their syntax state across pages.
Unmatched Markdown emphasis delimiters remain literal and do not carry syntax
color into a later paragraph, heading, or table; valid nested and multiline
emphasis within a paragraph remains highlighted without changing source text.
Catalog Preview uses upstream file boundaries: the `SKILL.md` entrypoint
followed by files declared in the source tree. Catalog agent and instruction
previews remain single source files with their provenance metadata.
In Inventory, `P` previews the bytes currently installed in the selected local
skill, agent, or instruction and audits those same local files using the
deterministic audit rules. Findings retain their local path and line attribution;
coverage lists every detected file and any skipped path/reason. Binary,
unreadable, oversized, invalid-UTF-8, or otherwise unsupported content is
explicitly skipped rather than audited as a display placeholder. Missing or
unsafe paths still fail Preview. A clean result is not a safety guarantee.
Catalog Resources `P` and the `kitia preview` command continue to use pinned
source content and retain their existing audit behavior.

Supported filename extensions are Markdown (`md`, `markdown`, `mdown`, `mkd`),
JavaScript (`js`, `mjs`, `cjs`, `jsx`), TypeScript (`ts`, `mts`, `cts`, `tsx`),
JSON/JSONC (`json`, `jsonc`), Python (`py`, `pyw`), shell (`sh`, `bash`, `zsh`,
`ksh`), YAML (`yaml`, `yml`), markup (`html`, `htm`, `xml`, `svg`), CSS (`css`),
Go (`go`), Rust (`rs`) and SQL (`sql`). Shell startup filenames `.bashrc`,
`.bash_profile`, `.bash_login`, `.profile`, `.zshrc`, `.zprofile`, `.zshenv` and
`.zlogin` also select the shell grammar.
Markdown backtick and tilde fences select a grammar only for an explicit
supported language: `md`/`markdown`, `js`/`javascript`/`jsx`,
`ts`/`typescript`/`tsx`, `json`/`jsonc`, `py`/`python`,
`sh`/`shell`/`bash`/`zsh`/`ksh`, `yaml`/`yml`,
`html`/`markup`/`xml`/`svg`/`mathml`, `css`, `go`/`golang`, `rs`/`rust` or
`sql`. Unknown filenames and unknown or unlabeled fenced languages remain plain
source; content is never used to guess a language. Fence recognition covers
top-level fences with up to three leading spaces, not fences nested inside
blockquote or list containers. Shell aliases use the Bash grammar, and SQL uses
a generic SQL grammar rather than dialect-specific parsing. These lexical source
colors are not a rendered CommonMark or MDX view.
This presentation does not change CLI output, JSON output or command syntax.
The compact header is followed by section tabs, summary cards, and a responsive
controls row. The terminal-rendered tabs are `Inventory`, `Browse resources`,
and `Catalogs`, with live counts of installed resources, available candidates,
and connected catalogs respectively; the counts are unfiltered. The selected
tab has a thin underline. Project and User cards report resource totals with
managed and unmanaged counts; Updates reports its count plus current and warning
totals.
Inventory and Browse combine a bordered Search field with outlined Kind,
Catalog, and License selectors, in that visual order. Rounded outlined action
buttons use semantic primary, danger, and neutral emphasis. Keyboard navigation
follows the visible control order. Below 40 terminal rows, these controls use
compact single-row fields with side borders and no top or bottom borders; at
shorter heights, dashboard summaries also switch to a compact presentation.
These are terminal-rendering conventions, not pixel-identical browser controls.

Inventory and Browse use joined list/details workspaces. Inventory columns are
`RESOURCE`, `KIND`, `SCOPE`, and `STATUS`; Browse columns are `RESOURCE`, `KIND`,
`CATALOG`, and `INSTALLED`. On wide terminals, the list and selection details
share a divider; on narrow terminals, they stack. Inventory details include the
catalog label, license, status, full revision, paths, source location, and
resource metadata. Browse details include description, catalog, license,
installed scopes, and pinned source. Long values wrap instead of being silently
truncated; PageUp/PageDown paginate clipped details without changing selection.

Catalogs is a selectable card list, not a table. Cards show repository, resource
and installed counts, and freshness. The selected card contains its details and
Edit, Refresh, and Remove actions; Add and Presets remain above the card list.

Rows use semantic theme colors: skills are yellow, agents cyan, and instructions
green. Selected rows use the blue selection surface and `›` marker in Inventory
and Browse; the selected Catalogs card uses the same blue surface with a white
foreground. Unknown kinds use the status-based Inventory fallback or the
proprietary-license Browse warning color. CLI text tables retain their existing
format.

The normal dashboard uses a compact, wrapping horizontal shortcut footer rather
than a separate sidebar. Its hints follow control focus, so active search and
filter controls, open menus, and modals retain their own keyboard input. Preview
and modal surfaces keep their context-specific framed `SHORTCUTS` panels.
Preview uses the same framed `SHORTCUTS` panel: `Display` lists source, audit,
and tree controls; `Navigation` lists pane focus, pagination, and close
controls. The panel reserves its full height before pane pagination is sized.
Below 12 terminal rows, the shortcut frame temporarily occupies the screen;
pane contents and independent page state return when the terminal is resized.
These presentation changes do not change CLI command syntax, options, output
contracts, or audit semantics.
Human-readable CLI tables also adapt to terminal width; piped output retains
complete values.
The dashboard is the interactive resource-management interface. CLI-only
`validate` and `doctor` provide strict catalog validation and environment/
installation diagnostics for terminal automation; `--json` provides stable
machine-readable discovery and maintenance reports. These automation and
diagnostic commands intentionally have no dashboard equivalents.
Collection import/export remain CLI-only because they require explicit file
paths and optional signing keys or trust decisions; dashboard catalog transfer
is intentionally limited to catalog configuration, not resource collections.



Dashboard inventory includes known install locations for skills, agents, and
instructions. Files without a Kitia installation record appear as unmanaged
artifacts and can be explicitly removed after confirmation; they are not
updated or uninstalled as managed resources.
New installations can choose project/user scope and Copilot/Claude/both
clients; instructions remain project-scoped. In the catalog browser, `F` enters
search mode; while searching, all typed characters—including `T`, `S`, and `L`—
are query text, and `Enter` applies the query. Outside search mode, `F` starts
search, `C`/`K` cycle catalog/kind, and `L` cycles license within the active
Catalog/Kind scope. Search and all three filters intersect when selecting visible
resources. A stale license value advances to the first available value rather
than appearing unchanged. Changing catalog or kind resets License to `ALL`.
`Esc` while searching clears the query and License filter while preserving
Catalog and Kind; opening Catalog Resources with `A` likewise clears query and
License while preserving Catalog and Kind. Tag and status remain resource
metadata, but do not have Catalog browser filter controls.
In Inventory, `L` cycles license within the active Catalog/Kind scope; license
and text filters intersect, while `C`/`K` retain their paired cycling behavior.
`Esc` from Inventory search clears only the text query; it preserves Catalog,
Kind, and License filters. While search is active, `L` is query text.
`V` on a skill opens its pinned commit history.
Choosing a commit in the catalog browser applies that full SHA to this install
only; choosing one in inventory applies it to the confirmed update. Neither
changes the catalog pin. `D` toggles the selected resource's details panel.
Catalog Resources `P` previews the selected pinned source and reports
deterministic audit findings and coverage in the same screen's audit pane,
replacing the separate Audit action. Catalog skills, agents, and instructions
use the same source-first layout and independent pane navigation. If no audit
result was returned, the audit pane explicitly says
`Audit report unavailable; no result was returned.`; an absent report is not a
clean audit. Dashboard installations always audit pinned source content first
and are blocked on findings or incomplete coverage; audit results
are warnings, not a safety guarantee. These interactive presentation changes do
not change CLI command syntax, options, output contracts, or audit semantics.
Selected-resource details expose license status and, when source provenance is
available, the pinned repository/path/commit. Missing license metadata is shown
as undeclared; incomplete pin metadata may show as unknown.
Inventory selection details show a `CATALOG` label for tracked artifacts with
source-repository metadata. Custom user catalogs include the folder selected by
the saved path mapping, such as `MattPucock[engineering]`. Browse keeps catalog
identity in both its `CATALOG` column and selection details. Untracked artifacts
and managed records without a source association display `-`.

From inventory, uppercase `A`/`U` install or update resources, and `Delete`
uninstalls the selection. Press `M` for catalog management; there, `A` adds a
catalog, `P` opens the preset picker for Matt Pocock, Anthropics, or GitHub
Awesome Copilot, `Delete`
removes the selected catalog, `E` edits its name, repository, setup mode and
custom paths, `R` refreshes catalogs, `I` opens a multi-line JSON text area for
import, and `X` copies the current configuration to the system clipboard.
In the preset picker, use `↑`/`↓` to choose a catalog, `Enter` to add it, and
`Esc` to cancel.
Paste a complete JSON object and press `Ctrl+S` to review its catalog list.
Use `↑`/`↓` to navigate, `Space` or `Enter` to toggle a catalog, then press
`Ctrl+S` again to import the selected entries. Existing names or repositories
are marked and excluded from the selection; use `Esc` to return to the pasted
configuration or cancel.
Clipboard export requires the platform clipboard utility (`pbcopy`, `clip`,
`wl-copy`, or `xclip`).
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


For automation, specify the kind and source catalog when selecting a
user-managed resource: `install skill <id> --catalog <source-name>`. Adding
catalog content can make an unqualified ID ambiguous. Unknown kinds are never
reinterpreted as another kind.



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

`kitia catalog export <file>` writes the version-1 catalog registry, including
Basic/Custom modes and path mappings, without repository contents.
`kitia catalog import <file>` validates the complete file and merges its
definitions into the current registry. Entries that conflict with an existing
catalog name or repository are skipped individually; non-conflicting entries
are imported. CLI output and the dashboard import summary identify added and
ignored catalogs, including the reason each entry was skipped. The import
refreshes newly added sources automatically. Refresh failures do not roll back
the saved definitions; they appear in the CLI/dashboard summary, and the CLI
exits nonzero if any new index could not be fetched. Retry with
`kitia catalog refresh --all`. Invalid catalog definitions reject the import
before registry changes.

### Resource collections

`kitia collection export <file> <catalog:kind:id...> [--signing-key <private-pem>]`
writes a version-1 resource-selection manifest for explicitly selected resources.
Each catalog reference includes its configured HTTPS GitHub repository and
mapping, full commit SHA, and each resource's kind, ID, repository-relative path,
and metadata. The manifest contains no upstream resource content. The optional
`--signing-key` reads an Ed25519 private PEM file and signs the canonical
version-1 manifest before writing it.

`kitia collection import <file> [--trusted-key <public-pem>]` validates the
entire manifest and all catalog conflicts before publishing any files. The
optional public PEM file is the importer's out-of-band approved key; the
manifest's `key_id` is its `sha256:` fingerprint (SHA-256 of DER/SPKI public
key bytes), not a key or trust assertion. Signed imports fail closed without
that key, on fingerprint mismatch, or after any signed-content alteration.
Supplying `--trusted-key` requires a signature; unsigned imports remain
compatible when the option is absent.

Signatures use Ed25519 over recursively key-sorted canonical JSON with a
versioned Kitia domain separator. Verification authenticates the approved
signer and manifest integrity; it does not establish resource safety or
independently prove upstream provenance. Import registers the referenced
catalogs and stages minimal pinned indexes for selected resources; publication
uses same-directory staging and rolls back published files on an I/O failure.
Collections contain references only, not offline content. Installation still
retrieves the pinned commit from GitHub; the commit may become unavailable, and
later refresh may advance the index. Import does not fetch or install resources.
[resource collections guide](resource-collections.md).


Use `G` in the dashboard to choose a single catalog or all user catalogs to
refresh. `kitia catalog refresh <name>` refreshes one source, and
`kitia catalog refresh --all` refreshes every user source. A refresh fetches the
current upstream commit and replaces that source's metadata index; configuration
and already-installed artifacts remain unchanged. Bulk refresh continues after
individual failures and exits nonzero if any source failed.

Discovery reads user indexes locally. Source resources resolve to the pinned
upstream commit: skills delegate to `gh skill`, while agents and instructions
are fetched and installed through Kitia's managed-file inventory. Multi-file
installs and updates stage all replacements before publication and roll back on
a write failure.


## JSON formats

Machine-readable schemas ship with the package:

- [Discovery arrays](../cli/schemas/cli-discovery-v1.schema.json)
- [Reports, version 1](../cli/schemas/cli-report-v1.schema.json)
- [Installation inventory formats and migrations](inventory-migrations.md)

Discovery schema versions are identified by the schema filename; the public
discovery payload remains an unwrapped JSON array. New optional discovery
properties are additive within version 1. Report envelopes include their schema
version in `schema_version`.

Reports and discovery keep their version-1 envelopes and arrays. Source-backed
resource identities include their configured catalog. External-resource
previews include source identity; unknown inventory versions and resource kinds
fail before any delegation.

`list --json` and `search --json` emit a single JSON array on stdout, including
an empty array when there are no results. Aggregate discovery entries include
the configured catalog name and source metadata where available.

`search` orders matches by relevance, prioritizing exact resource-identifier
matches. The relative ranking is part of the user-facing behavior, but score
weights and other internal ranking details are not a CLI contract.

`--license <value>` combines with other `list`/`search` filters. A single valid
SPDX license identifier matches when that identifier occurs anywhere in the
resource's recognized SPDX expression (for example, `MIT` matches
`MIT OR Apache-2.0`). A valid compound SPDX expression matches only the same
stored normalized expression; the filter is trimmed at its ends but is not
internally whitespace-normalized. A value that is not a valid single SPDX
identifier or expression matches the upstream `license_status` exactly against
the trimmed filter. Indexing preserves non-empty upstream `license_status`,
uses `not-declared` when the upstream value is missing or blank, and adds
normalized `license_spdx` only for a valid SPDX expression. Kitia never infers
a missing license.


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

`pnpm run cli:test:contract` exercises the CLI executable in isolated synthetic
catalogs, validates complete JSON reports against the schemas and compares
stable fields against committed version-1 expectations. Human-readable text
and object/array ordering are deliberately not frozen.

Historical version-1 inventories are read from committed fixtures rather than
created by the current writer. Future-version and unsupported-kind scenarios
verify that files remain byte-for-byte unchanged even when `--force` is used.
The suite is included in `npm test` and therefore in the existing Node.js 26
Linux/macOS/Windows CI matrix.

Do not update a baseline merely to make a regression green. Explain whether a
change is additive or breaking, preserve old behavior where promised, and
update the contract/version/migration deliberately when a break is necessary.
