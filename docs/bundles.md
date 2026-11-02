# MCP servers and bundles

The catalog engine can manage MCP server configurations on behalf of Copilot
CLI and Claude Code CLI. A bundle is a declared set of internal resources and
MCP servers installed as one operation. The catalog currently contains no MCP
or bundle entries; use these commands with IDs that appear in your configured
catalog.

## Preview and install

```sh
npx --yes github:grasdouble/Kitia list --kind mcp --catalog internal
npx --yes github:grasdouble/Kitia show mcp <server-id>
npx --yes github:grasdouble/Kitia install mcp <server-id> --scope user --tool both --dry-run
npx --yes github:grasdouble/Kitia install mcp <server-id> --scope user --tool both

npx --yes github:grasdouble/Kitia list --kind bundle --catalog internal
npx --yes github:grasdouble/Kitia show bundle <bundle-id>
npx --yes github:grasdouble/Kitia install bundle <bundle-id> --tool both --dry-run
```

MCP and bundle setup targets the supported CLI clients, not their desktop apps
or IDE integrations. A setup writes native client configuration; it does not
install packages, start a server, probe an endpoint, or complete OAuth.
Confirm executable names, network access, permissions, licensing, and data
handling before installation.

## Inputs and secrets

MCP catalog entries declare typed inputs and map them to environment variables.
Provide non-secret values explicitly:

```sh
npx --yes github:grasdouble/Kitia install mcp <server-id> \
  --input <server-id>.endpoint=https://api.example.com/mcp \
  --yes
```

Secret values are never accepted on the command line or stored in the
installation inventory. Instead, configure required secret variables in the
client's environment. The server configuration can refer to them using
`${VARIABLE}`; optional secrets may use `${VARIABLE:-}`. The client resolves
these references when it starts the server.

## Ownership and removal

The inventory records which MCP entries were installed independently and
which are dependencies of bundles. Removing a bundle preserves MCP servers
that were also installed on their own or are still required elsewhere.

Interactive uninstall of a required MCP offers a dependency cascade with a
list of affected resources. Automation must pass `--cascade`; use
`--dry-run --json` to inspect the complete plan first. `--force` does not take
ownership of pre-existing configuration or bypass MCP conflicts.

MCP configuration files can contain other servers and client settings. The
CLI manages only the entries recorded in its inventory, preserves unrelated
configuration, and refuses to overwrite an unmanaged server with the same
name.

For the stable JSON plan fields, error behavior, and exit codes, see the
[CLI compatibility contract](cli-contract.md).
