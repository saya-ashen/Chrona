# Chrona Hermes Plugin

Hermes plugin that dynamically registers tools exposed by a running Chrona
server through Chrona's MCP HTTP endpoint.

## Install

Copy this directory to the Hermes user plugin directory:

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
each returned Chrona tool directly in Hermes using the original tool name and
schema. Tool calls are forwarded to Chrona MCP `tools/call`.

This means Hermes sees real Chrona tools such as `chrona.task.read`, not wrapper
tools like `chrona_tool_call`.

## Notes

- Requires Chrona server to be running.
- Uses Python standard library only.
- Does not implement Chrona tool logic locally; Chrona remains the source of
  truth for tool schemas and execution.
- Startup fails if Chrona cannot be reached, because Hermes needs the live tool
  schemas before registration.
