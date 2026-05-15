# Chrona Hermes Plugin

Hermes plugin that dynamically registers tools exposed by a running Chrona
server through Chrona's MCP HTTP endpoint.

## Install

From the Chrona repository root, run:

```sh
bun run install:hermes-plugin
```

By default this installs to `~/.hermes/plugins/chrona` and runs
`hermes plugins enable chrona` if the Hermes CLI is available.

To install to a different Hermes home or plugin directory:

```sh
HERMES_HOME=/path/to/.hermes bun run install:hermes-plugin
CHRONA_HERMES_PLUGIN_DIR=/path/to/.hermes/plugins/chrona bun run install:hermes-plugin
```

To copy the plugin without enabling it immediately:

```sh
CHRONA_HERMES_SKIP_ENABLE=1 bun run install:hermes-plugin
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
