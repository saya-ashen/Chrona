# Chrona Hermes Plugin

Hermes plugin that dynamically registers tools exposed by a running Chrona
server through Chrona's MCP HTTP endpoint.

## Install

From the Chrona repository root, run:

```sh
bun run install:hermes-plugin
```

Or from the packaged Chrona CLI:

```sh
chrona hermes plugin install
```

By default this installs to `~/.hermes/plugins/chrona` and runs
`hermes plugins enable chrona` if the Hermes CLI is available. It also writes
`chrona_config.json` with the Chrona MCP URL and bundled plugin version used by
the plugin.

To install to a different Hermes home or plugin directory:

```sh
HERMES_HOME=/path/to/.hermes bun run install:hermes-plugin
CHRONA_HERMES_PLUGIN_DIR=/path/to/.hermes/plugins/chrona bun run install:hermes-plugin
chrona hermes plugin install --hermes-home /path/to/.hermes
chrona hermes plugin install --plugin-dir /path/to/.hermes/plugins/chrona
```

To point the plugin at a non-default Chrona MCP endpoint:

```sh
chrona hermes plugin install --mcp-url http://192.168.1.1:3101/api/mcp
```

To copy the plugin without enabling it immediately:

```sh
CHRONA_HERMES_SKIP_ENABLE=1 bun run install:hermes-plugin
chrona hermes plugin install --skip-enable
```

Manual install:

```sh
mkdir -p ~/.hermes/plugins/chrona
cp -R external-plugins/hermes/. ~/.hermes/plugins/chrona/
```

Enable the plugin in Hermes:

```sh
hermes plugins enable chrona
```

Point the plugin at Chrona if it is not using the default endpoint:

```sh
export CHRONA_MCP_URL="http://127.0.0.1:3101/api/mcp"
```

`CHRONA_MCP_URL` overrides the installed `chrona_config.json` value. Without the
environment variable, the plugin reads `chrona_config.json`, then falls back to
`http://127.0.0.1:3101/api/mcp`.

When `chrona start` runs locally, Chrona checks local integrations before the
server starts. If Hermes is installed locally and the Chrona plugin is missing,
outdated, or points at the wrong MCP URL, interactive terminals can install or
update it from the startup prompt. Non-interactive terminals print the command to
run later. If Hermes is not installed locally, Chrona prints the MCP URL for
manual remote Hermes configuration.

## Tools

At Hermes plugin startup, the plugin calls Chrona MCP `tools/list` and registers
each returned Chrona tool in Hermes with a Hermes-safe name and the original
parameter schema. Dots in Chrona tool names are converted to underscores for
Hermes, while tool calls are forwarded to Chrona MCP `tools/call` with the
original Chrona name.

This means Hermes sees real Chrona tools such as `chrona_task_read`, not wrapper
tools like `chrona_tool_call`.

## Notes

- Requires Chrona server to be running.
- Uses Python standard library only.
- Does not implement Chrona tool logic locally; Chrona remains the source of
  truth for tool schemas and execution.
- Startup fails if Chrona cannot be reached, because Hermes needs the live tool
  schemas before registration.
