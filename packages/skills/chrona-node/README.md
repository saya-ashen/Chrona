# chrona-node

Chrona execution-node skill for Claude Code. Spec 018.

## What it is

A single Claude Code skill (`SKILL.md`) plus a thin launcher script
(`bin/chrona`) that delegates to the `@chrona/agent-cli` binary on the agent's
`PATH`. It replaces the wall of MCP tool schemas a node execution used to
discover with:

1. One skill frontmatter in the agent's context.
2. The bundled `chrona` CLI (already on the agent's `PATH`; never read ids
   from the model).

## Layout

```
packages/skills/chrona-node/
  SKILL.md     # frontmatter + body (the only file Claude Code opens)
  bin/chrona   # 12-line launcher: exec `chrona "$@"` from PATH
  README.md    # this file
```

## How the provider mounts it

`packages/providers/claude-code` writes the skill's `CHRONA_BASE_URL` and
`CHRONA_RUN_TOKEN` into the spawned process env when
`controlPlane === "skill"`, and passes `--add-dir <skillDir>` so the agent's
`Bash` tool can resolve `chrona` (it finds `bin/chrona` via PATH or
`--add-dir`).

## How the CLI is resolved

The launcher is a thin shim, not the implementation. The real binary is
`@chrona/agent-cli` (see `packages/agent-cli/`). The skill ships only the
launcher so the skill bundle stays tiny and the agent-cli can be installed /
upgraded independently of the skill.

## When the agent runs the skill

Chrona mounts this skill per run when the configured `controlPlane` is
`"skill"` and the client type is `claude_code`. Hermes stays on MCP in this
milestone and does not load this skill.
