# Built-in module release resources

Only `agent`, `web` and `notify` ship here, under `resources/builtin`.
Agent is release-bound and immutable; Web and Notify support the checked customization pipeline.

`mcp`, `files` and `events` are optional official external packages under `../external`,
shipped as `resources/external`. Their extraction preserves existing module identities and
approved custom versions. Removing them does not cause startup to reinstall them.
An owner can recover MCP without Web/MCP through the stopped-service host command
`chrona admin install mcp --request-key <unique-key>`; acceptance still goes through the
normal checked build and approval pipeline.
